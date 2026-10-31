import { isDeepStrictEqual } from "node:util";
import { DATA_TABLES } from "./registry.js";
import {
  parse_data_request,
  identifier,
  request_error,
  encoded,
} from "./contract.js";

export function create_data_request_handler({
  connect,
  disconnect,
  registry = DATA_TABLES,
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let connection,
      db,
      close = disconnect,
      in_transaction = false;
    try {
      const request = parse_data_request(req.body, registry);
      const { spec, key, values, expected, operation } = request;
      const database =
        connect && disconnect ? null : await import("../../mysql.js");
      close ||= database.db_disconnect;
      connection = (connect || database.db_connect)();
      db = connection.promise();
      const where = Object.keys(key)
        .map((field) => `${identifier(field)} = ?`)
        .join(" AND ");
      const parameters = Object.entries(key).map(([field, value]) =>
        encoded(spec.keys[field], value),
      );
      const select_sql = `SELECT ${spec.readable.map(identifier).join(", ")} FROM ${identifier(spec.table)} WHERE ${where} LIMIT 1`;
      const serialize = (row) =>
        Object.fromEntries(
          spec.readable.map((field) => {
            const descriptor = spec.writable[field] || spec.keys[field];
            return [
              field,
              descriptor?.decode ? descriptor.decode(row[field]) : row[field],
            ];
          }),
        );
      if (operation === "update") {
        await db.beginTransaction();
        in_transaction = true;
      }
      const [rows] = await db.execute(
        select_sql + (in_transaction ? " FOR UPDATE" : ""),
        parameters,
      );
      if (!rows.length)
        throw request_error(404, "record_not_found", "Record not found");
      const current = serialize(rows[0]);
      if (operation === "get") return res.json({ result: current });
      if (
        expected &&
        Object.entries(expected).some(
          ([field, value]) => !isDeepStrictEqual(current[field], value),
        )
      )
        throw request_error(
          409,
          "data_conflict",
          "The record no longer matches the expected values",
        );
      const changes = Object.entries(values).filter(
        ([field, value]) => !isDeepStrictEqual(current[field], value),
      );
      let result = current;
      if (changes.length) {
        await db.execute(
          `UPDATE ${identifier(spec.table)} SET ${changes.map(([field]) => `${identifier(field)} = ?`).join(", ")} WHERE ${where}`,
          [
            ...changes.map(([field, value]) =>
              encoded(spec.writable[field], value),
            ),
            ...parameters,
          ],
        );
        const [updated] = await db.execute(select_sql, parameters);
        result = serialize(updated[0]);
      }
      await db.commit();
      in_transaction = false;
      return res.json({ result, changed: changes.length > 0 });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY")
        error = request_error(
          409,
          "data_conflict",
          "The update conflicts with stored data",
        );
      if (in_transaction) {
        try {
          await db.rollback();
        } catch {
          /* Preserve the original failure. */
        }
      }
      return res.status(error.status || 503).json({
        error: error.status ? error.message : "Data request unavailable",
        code:
          error.code && error.status ? error.code : "data_request_unavailable",
      });
    } finally {
      if (connection) close(connection);
    }
  };
}
export const handle_data_request = create_data_request_handler();
