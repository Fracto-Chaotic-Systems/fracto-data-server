import chalk from "chalk";

import { db_connect, db_disconnect } from "../mysql.js";

/**
 * Database definition for the provider-backed user allowlist.
 * The role column is reserved for a later authorization stage.
 */
export const USERS_TABLE_DEFINITION = {
  table: "users",
  columns: [
    "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    "`provider` VARCHAR(64) NOT NULL",
    "`provider_subject` VARCHAR(255) NOT NULL",
    "`email` VARCHAR(320)",
    "`display_name` VARCHAR(255)",
    "`enabled` TINYINT(1) NOT NULL DEFAULT 0",
    "`role` VARCHAR(64)",
    "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    "`last_login_at` DATETIME",
    "`last_seen_at` DATETIME",
  ],
};

/** Database definition for authentication and access audit events. */
export const LOGIN_EVENTS_TABLE_DEFINITION = {
  table: "login_events",
  columns: [
    "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    "`user_id` BIGINT UNSIGNED",
    "`provider` VARCHAR(64) NOT NULL",
    "`provider_subject` VARCHAR(255) NOT NULL",
    "`event_type` VARCHAR(32) NOT NULL",
    "`success` TINYINT(1) NOT NULL DEFAULT 0",
    "`event_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "`ip_address` VARCHAR(45)",
    "`user_agent` VARCHAR(512)",
    "`details` JSON",
  ],
};

const definition_column_name = (definition) =>
  definition.match(/^`([^`]+)`/)?.[1];

/** Ensure one table and add any columns introduced by a later schema version. */
const ensure_table = async (query, definition) => {
  await query(
    `CREATE TABLE IF NOT EXISTS \`${definition.table}\` (${definition.columns.join(", ")})`,
  );
  const existing_columns = await query(
    `SHOW COLUMNS FROM \`${definition.table}\``,
  );
  const existing_names = new Set(
    existing_columns.map((column) => column.Field),
  );
  const migrations = [];
  for (const column_definition of definition.columns) {
    const name = definition_column_name(column_definition);
    if (name && !existing_names.has(name)) {
      await query(
        `ALTER TABLE \`${definition.table}\` ADD COLUMN ${column_definition}`,
      );
      migrations.push(name);
    }
  }
  return migrations;
};

/** Ensure the indexes required for provider identity and event lookup. */
const ensure_indexes = async (query) => {
  const users_indexes = await query("SHOW INDEX FROM `users`");
  const user_index_names = new Set(
    users_indexes.map((index) => index.Key_name),
  );
  if (!user_index_names.has("uq_users_provider_subject")) {
    await query(
      "ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_provider_subject` (`provider`, `provider_subject`)",
    );
  }

  const event_indexes = await query("SHOW INDEX FROM `login_events`");
  const event_index_names = new Set(
    event_indexes.map((index) => index.Key_name),
  );
  if (!event_index_names.has("idx_login_events_subject_event_at")) {
    await query(
      "ALTER TABLE `login_events` ADD INDEX `idx_login_events_subject_event_at` (`provider`, `provider_subject`, `event_at`)",
    );
  }
};

/** Ensure the user allowlist and login audit tables before serving requests. */
export const initialize_user_tables = () => {
  const connection = db_connect();
  const query = (sql) =>
    new Promise((resolve, reject) => {
      connection.query(sql, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
  return (async () => {
    try {
      const user_migrations = await ensure_table(
        query,
        USERS_TABLE_DEFINITION,
      );
      const event_migrations = await ensure_table(
        query,
        LOGIN_EVENTS_TABLE_DEFINITION,
      );
      await ensure_indexes(query);
      if (user_migrations.length || event_migrations.length) {
        console.log(
          chalk.yellow(
            `user schema migration applied; users: ${user_migrations.length}, login_events: ${event_migrations.length}`,
          ),
        );
      }
      console.log(chalk.green("user tables are ready"));
    } finally {
      db_disconnect(connection);
    }
  })();
};
