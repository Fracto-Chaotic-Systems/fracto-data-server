import chalk from "chalk";

import { db_connect, db_disconnect } from "../mysql.js";

/** Shared automation table schema used by all server namespaces. */
export const AUTOMATION_TABLE_DEFINITION = {
  table: "automation",
  columns: [
    "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    "`title` VARCHAR(255) NOT NULL",
    "`automation_type` VARCHAR(100) NOT NULL",
    "`state` VARCHAR(16) NOT NULL DEFAULT 'draft'",
    "`run_start` DATETIME",
    "`run_stop` DATETIME",
    "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    "`tasks` JSON NOT NULL",
  ],
};

/** Ensure the shared automation table exists before serving requests. */
export const initialize_automation_table = () => {
  const connection = db_connect();
  const query = (sql) =>
    new Promise((resolve, reject) => {
      connection.query(sql, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
  return (async () => {
    try {
      await query(
        `CREATE TABLE IF NOT EXISTS \`${AUTOMATION_TABLE_DEFINITION.table}\` (${AUTOMATION_TABLE_DEFINITION.columns.join(", ")})`,
      );
      const existing_columns = await query(
        `SHOW COLUMNS FROM \`${AUTOMATION_TABLE_DEFINITION.table}\``,
      );
      const existing_names = new Set(
        existing_columns.map((column) => column.Field),
      );
      for (const definition of AUTOMATION_TABLE_DEFINITION.columns) {
        const name = definition.match(/^`([^`]+)`/)?.[1];
        if (name && !existing_names.has(name)) {
          await query(
            `ALTER TABLE \`${AUTOMATION_TABLE_DEFINITION.table}\` ADD COLUMN ${definition}`,
          );
        }
      }
      console.log(chalk.green("automation table is ready"));
    } finally {
      db_disconnect(connection);
    }
  })();
};
