import { db_connect, db_disconnect } from "../../mysql.js";

/** Immutable imported observations from legacy logistic-map span catalogs. */
export const LOGISTIC_MAP_SPAN_CATALOG_TABLE = "logistic_map_span_catalog";

export const LOGISTIC_MAP_SPAN_CATALOG_DEFINITION = {
  table: LOGISTIC_MAP_SPAN_CATALOG_TABLE,
  columns: [
    "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    "`source_version` VARCHAR(64) NOT NULL",
    "`source_sha256` CHAR(64) NOT NULL",
    "`source_file` VARCHAR(255) NOT NULL",
    "`source_order` INT UNSIGNED NOT NULL",
    "`min_r` DOUBLE NOT NULL",
    "`max_r` DOUBLE NOT NULL",
    "`width` DOUBLE NOT NULL",
    "`legacy_regime` INT NOT NULL",
    "`legacy_count` BIGINT UNSIGNED NOT NULL",
    // LONGTEXT preserves the original object's numeric spelling and field order.
    "`source_record_json` LONGTEXT NOT NULL",
    "`imported_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "UNIQUE INDEX `uq_logistic_span_source_order` (`source_version`, `source_order`)",
    "INDEX `idx_logistic_span_source_bounds` (`source_version`, `min_r`, `max_r`)",
  ],
};

/** Mutable, parameter-level calculation records backing exploratory packets. */
export const LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION = {
  table: "logistic_map_span_review_sample",
  columns: [
    "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    "`generation_id` VARCHAR(160) NOT NULL",
    "`source_version` VARCHAR(64) NOT NULL",
    "`source_sha256` CHAR(64) NOT NULL",
    "`source_order` INT UNSIGNED NOT NULL",
    "`packet_sha256` CHAR(64) NOT NULL",
    "`sample_index` INT UNSIGNED NOT NULL",
    "`r_value` DOUBLE NOT NULL",
    "`outcome` VARCHAR(64) NOT NULL",
    "`candidate_period` INT UNSIGNED",
    "`cycle_multiplier` DOUBLE",
    "`review_record_json` LONGTEXT NOT NULL",
    "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "UNIQUE INDEX `uq_logistic_span_review_generation_sample` (`generation_id`, `sample_index`)",
    "INDEX `idx_logistic_span_review_source_range` (`source_version`, `source_order`, `r_value`)",
  ],
};

/** Create the catalog schema only; importing source rows is an explicit operation. */
export const initialize_logistic_map_span_catalog = (
  connection_factory = db_connect,
) => {
  const connection = connection_factory();
  return new Promise((resolve, reject) => {
    const sql = `CREATE TABLE IF NOT EXISTS \`${LOGISTIC_MAP_SPAN_CATALOG_TABLE}\` (${LOGISTIC_MAP_SPAN_CATALOG_DEFINITION.columns.join(", ")})`;
    connection.query(sql, (error) => {
      db_disconnect(connection);
      if (error) reject(error);
      else resolve();
    });
  });
};

/** Create the editable review-sample table without seeding calculated results. */
export const initialize_logistic_map_span_review_sample = (
  connection_factory = db_connect,
) => {
  const connection = connection_factory();
  return new Promise((resolve, reject) => {
    const sql = `CREATE TABLE IF NOT EXISTS \`${LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION.table}\` (${LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION.columns.join(", ")})`;
    connection.query(sql, (create_error) => {
      if (create_error) {
        db_disconnect(connection);
        reject(create_error);
        return;
      }
      connection.query(`SHOW COLUMNS FROM \`${LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION.table}\``, (columns_error, columns) => {
        if (columns_error) {
          db_disconnect(connection);
          reject(columns_error);
          return;
        }
        const outcome = columns.find((column) => column.Field === "outcome");
        if (outcome && /^varchar\(32\)/i.test(outcome.Type)) {
          connection.query(`ALTER TABLE \`${LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION.table}\` MODIFY COLUMN \`outcome\` VARCHAR(64) NOT NULL`, (migration_error) => {
            db_disconnect(connection);
            if (migration_error) reject(migration_error);
            else resolve();
          });
          return;
        }
        db_disconnect(connection);
        resolve();
      });
    });
  });
};
