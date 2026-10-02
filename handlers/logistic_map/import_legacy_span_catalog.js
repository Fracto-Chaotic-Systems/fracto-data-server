import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { db_connect, db_disconnect } from "../../mysql.js";
import { initialize_logistic_map_span_catalog } from "./initialize_span_catalog.js";
import {
  parse_legacy_span_catalog,
  summarize_legacy_span_catalog,
} from "./legacy_span_catalog.js";

const query_promise = (connection, sql, values = []) =>
  new Promise((resolve_query, reject) => {
    connection.query(sql, values, (error, result) =>
      error ? reject(error) : resolve_query(result),
    );
  });

export const import_legacy_span_catalog = async ({
  file_path,
  connection_factory = db_connect,
  dry_run = false,
}) => {
  if (!file_path) throw new Error("Supply a source spans.json file path");
  const absolute_path = resolve(file_path);
  const source_text = await readFile(absolute_path, "utf8");
  const catalog = parse_legacy_span_catalog(source_text, absolute_path);
  const summary = summarize_legacy_span_catalog(catalog.records);
  summary.source_version = catalog.source_version;
  summary.source_sha256 = catalog.source_sha256;
  summary.source_file = catalog.source_file;
  summary.dry_run = dry_run;
  if (dry_run) return summary;

  await initialize_logistic_map_span_catalog(connection_factory);
  const connection = connection_factory();
  let lock_acquired = false;
  try {
    const lock = await query_promise(connection,
      "SELECT GET_LOCK('fracto_logistic_span_catalog_import', 30) AS acquired");
    lock_acquired = Number(lock?.[0]?.acquired) === 1;
    if (!lock_acquired) throw new Error("Could not acquire the catalog import lock; retry later");
    const existing = await query_promise(connection,
      "SELECT `source_sha256`, COUNT(*) AS row_count FROM `logistic_map_span_catalog` WHERE `source_version` = ? GROUP BY `source_sha256`",
      [catalog.source_version]);
    if (existing.length) {
      if (existing.length !== 1 || existing[0].source_sha256 !== catalog.source_sha256 || Number(existing[0].row_count) !== catalog.records.length) {
        throw new Error("This source version already exists with different or incomplete content; use a new source version");
      }
      summary.already_imported = true;
      return summary;
    }

    await query_promise(connection, "START TRANSACTION");
    try {
      for (const row of catalog.records) {
        await query_promise(connection,
          "INSERT INTO `logistic_map_span_catalog` (`source_version`, `source_sha256`, `source_file`, `source_order`, `min_r`, `max_r`, `width`, `legacy_regime`, `legacy_count`, `source_record_json`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [catalog.source_version, catalog.source_sha256, catalog.source_file,
            row.source_order, row.min_r, row.max_r, row.width,
            row.legacy_regime, row.legacy_count, row.source_record_json]);
      }
      await query_promise(connection, "COMMIT");
      summary.already_imported = false;
    } catch (error) {
      await query_promise(connection, "ROLLBACK");
      throw error;
    }
    return summary;
  } finally {
    if (lock_acquired) {
      await query_promise(connection, "SELECT RELEASE_LOCK('fracto_logistic_span_catalog_import')").catch(() => {});
    }
    db_disconnect(connection);
  }
};

const is_main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (is_main) {
  const args = process.argv.slice(2);
  const dry_run = args.includes("--dry-run");
  const file_path = args.find((arg) => !arg.startsWith("--"));
  try {
    const summary = await import_legacy_span_catalog({ file_path, dry_run });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(`Legacy logistic-map span import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
