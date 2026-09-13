import { db_connect, db_disconnect } from "../mysql.js";

const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const COLUMN_TYPE_PATTERN = /^(?:BIGINT|INT|TINYINT\(1\)|DOUBLE|VARCHAR\(\d+\)|TIMESTAMP|JSON)(?:\s+UNSIGNED)?$/i;

/**
 * Ensure an application-owned table exists without exposing arbitrary SQL.
 * The caller supplies the semantic column definitions; this handler owns the
 * MySQL connection and validates identifiers/types before constructing DDL.
 *
 * @param {import("express").Request} req Request body with table and columns.
 * @param {import("express").Response} res JSON result of the operation.
 */
export const handle_ensure_table = async (req, res) => {
  const table = `${req.body?.table || ""}`;
  const columns = req.body?.columns;
  if (
    !TABLE_NAME_PATTERN.test(table) ||
    !Array.isArray(columns) ||
    columns.length === 0
  ) {
    res.status(400).json({ error: "A valid table and columns are required" });
    return;
  }
  const column_definitions = columns.map((column) => {
    const name = `${column?.name || ""}`;
    const type = `${column?.type || ""}`.trim();
    if (!TABLE_NAME_PATTERN.test(name) || !COLUMN_TYPE_PATTERN.test(type)) {
      return null;
    }
    const clauses = [
      column.nullable === false ? "NOT NULL" : "",
      column.auto_increment ? "AUTO_INCREMENT" : "",
      column.primary_key ? "PRIMARY KEY" : "",
      column.unique ? "UNIQUE" : "",
      column.default_current_timestamp ? "DEFAULT CURRENT_TIMESTAMP" : "",
      column.on_update_current_timestamp ? "ON UPDATE CURRENT_TIMESTAMP" : "",
      /^-?\d+$/.test(`${column.default_value ?? ""}`)
        ? `DEFAULT ${column.default_value}`
        : "",
    ].filter(Boolean);
    return `\`${name}\` ${type}${clauses.length ? ` ${clauses.join(" ")}` : ""}`;
  });
  if (column_definitions.some((definition) => !definition)) {
    res.status(400).json({ error: "Invalid table column definition" });
    return;
  }
  const connection = db_connect();
  const query = (sql) =>
    new Promise((resolve, reject) => {
      connection.query(sql, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
  try {
    const sql = `CREATE TABLE IF NOT EXISTS \`${table}\` (${column_definitions.join(", ")})`;
    await query(sql);
    const existing_columns = await query(`SHOW COLUMNS FROM \`${table}\``);
    const existing_names = new Set(
      existing_columns.map((column) => column.Field),
    );
    const migrations = [];
    for (const [index, column] of columns.entries()) {
      if (existing_names.has(column.name)) continue;
      const definition = column_definitions[index];
      await query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
      migrations.push(column.name);
    }
    res.status(200).json({ table, initialized: true, migrations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    db_disconnect(connection);
  }
};
