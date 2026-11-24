import { open_environment_asset_pool } from "../environment/database.js";
import {
  validate_component_document,
  validate_component_id,
} from "@fracto/sdk/FractoComponentDocument.js";

export function create_component_database({
  open = open_environment_asset_pool,
} = {}) {
  let pool;
  const database = () =>
    (pool ??= open().catch((error) => {
      pool = null;
      throw error;
    }));
  return {
    async list(after = "") {
      if (after) validate_component_id(after);
      const [rows] = await (
        await database()
      ).execute(
        "SELECT document_id, name, revision FROM component_documents WHERE document_id > ? ORDER BY document_id LIMIT 51",
        [after],
      );
      const documents = rows
        .slice(0, 50)
        .map((row) => ({
          id: row.document_id,
          name: row.name,
          revision: row.revision,
        }));
      return {
        documents,
        next_cursor: rows.length > 50 ? documents.at(-1).id : null,
      };
    },
    async load(id) {
      validate_component_id(id);
      const [rows] = await (
        await database()
      ).execute(
        "SELECT document_json, revision FROM component_documents WHERE document_id = ?",
        [id],
      );
      if (!rows.length) throw new Error("component_not_found");
      const document = validate_component_document(
        typeof rows[0].document_json === "string"
          ? JSON.parse(rows[0].document_json)
          : rows[0].document_json,
      );
      if (document.id !== id) throw new Error("component_unavailable");
      return { document, revision: rows[0].revision };
    },
    async save(document, expected_revision) {
      document = validate_component_document(document);
      if (
        !Number.isInteger(expected_revision) ||
        expected_revision < 0 ||
        expected_revision >= 4294967295
      )
        throw new Error("invalid_component_document");
      const db = await database();
      const json = JSON.stringify(document);
      if (expected_revision === 0) {
        try {
          await db.execute(
            "INSERT INTO component_documents (document_id, name, schema_version, revision, document_json) VALUES (?, ?, ?, 1, ?)",
            [document.id, document.name, document.schema_version, json],
          );
        } catch (error) {
          if (error.code === "ER_DUP_ENTRY")
            throw new Error("component_conflict");
          throw error;
        }
      } else {
        const [result] = await db.execute(
          "UPDATE component_documents SET name = ?, schema_version = ?, document_json = ?, revision = revision + 1 WHERE document_id = ? AND revision = ?",
          [
            document.name,
            document.schema_version,
            json,
            document.id,
            expected_revision,
          ],
        );
        if (result.affectedRows !== 1) throw new Error("component_conflict");
      }
      return { document, revision: expected_revision + 1 };
    },
    async close() {
      if (pool) await (await pool).end();
      pool = null;
    },
  };
}
