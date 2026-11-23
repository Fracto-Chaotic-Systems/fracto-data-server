import { readFile } from "node:fs/promises";
import {
  CATALOG_FIELDS,
  catalog_view,
  validate_model_category,
  normalize_model_folder,
} from "@fracto/sdk/FractoEnvironmentCatalog.js";

// Only asset provenance is persisted; never copy arbitrary record extensions.
export function environment_asset_row(record, revision) {
  const view = catalog_view(record);
  return {
    asset_id: record.id,
    archived: record.archived === true ? 1 : 0,
    name: record.name,
    version: record.version,
    category: record.category || "environment",
    model_category: validate_model_category(record.model_category),
    folder_path: normalize_model_folder(record.folder_path),
    description: record.description || null,
    parent_id: record.parent_id || null,
    record_path: `${record.id}/asset.json`,
    model_path: record.runtime?.path || null,
    model_format: record.runtime?.format || null,
    attribution_status: view.attribution.status || "unresolved",
    ...Object.fromEntries(
      CATALOG_FIELDS.map((key) => [key, view.attribution[key]]),
    ),
    sources: JSON.stringify(
      (record.sources || []).map(({ path, format, sha256 }) => ({
        path,
        format,
        sha256,
      })),
    ),
    modification_history: JSON.stringify(view.history),
    revision,
  };
}

export async function open_environment_asset_pool() {
  const config = JSON.parse(
    await readFile(new URL("../config/mysql.json", import.meta.url), "utf8"),
  );
  const { default: mysql } = await import("mysql2/promise");
  return mysql.createPool({
    ...config,
    host: process.env.FRACTO_MYSQL_HOST || config.host,
    port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
    database: process.env.FRACTO_MYSQL_DATABASE || config.database,
    user: process.env.FRACTO_MYSQL_USER || config.user,
    password: process.env.FRACTO_MYSQL_PASSWORD ?? config.password,
    multipleStatements: false,
    connectionLimit: 2,
    maxIdle: 2,
    idleTimeout: 30000,
    connectTimeout: 10000,
    queueLimit: 16,
  });
}

export function create_environment_asset_database({
  open = open_environment_asset_pool,
} = {}) {
  let pool;
  const database = async () => {
    if (!pool)
      pool = open().catch((error) => {
        pool = null;
        throw error;
      });
    return pool;
  };
  return {
    async folders(category) {
      if (typeof category !== "string") throw new Error("invalid_record");
      validate_model_category(category);
      const db = await database();
      const [rows] = await db.execute(
        "SELECT folder_path FROM model_folders WHERE model_category = ? UNION SELECT folder_path FROM environment_assets WHERE archived = 0 AND model_category = ? AND folder_path <> '' ORDER BY folder_path LIMIT 1001",
        [category, category],
      );
      if (rows.length > 1000) throw new Error("catalog_unavailable");
      return {
        folders: rows.map((row) => normalize_model_folder(row.folder_path)),
      };
    },
    async add_folder(category, folder_path) {
      validate_model_category(category);
      folder_path = normalize_model_folder(folder_path);
      if (!folder_path) throw new Error("invalid_folder");
      const db = await database();
      // Idempotent creation supports safe retries after an uncertain response.
      await db.execute(
        "INSERT IGNORE INTO model_folders (model_category, folder_path) VALUES (?, ?)",
        [category, folder_path],
      );
      return { folder_path };
    },
    async list({ category, after = "", limit = 200 } = {}) {
      if (category !== undefined) validate_model_category(category);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        typeof after !== "string" ||
        (after && !/^[a-z][a-z0-9-]{0,63}$/.test(after))
      )
        throw new Error("invalid_query");
      const db = await database();
      const parameters = category === undefined ? [after] : [after, category];
      const [rows] = await db.execute(
        `SELECT asset_id, name, model_category, folder_path, model_path, model_format FROM environment_assets WHERE archived = 0 AND asset_id > ?${category === undefined ? "" : " AND model_category = ?"} ORDER BY asset_id LIMIT ${limit + 1}`,
        parameters,
      );
      const more = rows.length > limit;
      const assets = rows.slice(0, limit).map((row) => ({
        id: row.asset_id,
        name: row.name,
        category: row.model_category,
        folder_path: normalize_model_folder(row.folder_path),
        model: row.model_path,
        format: row.model_format,
      }));
      return { assets, next_cursor: more ? assets.at(-1).id : null };
    },
    async sync(record, revision) {
      const row = environment_asset_row(record, revision);
      const columns = Object.keys(row);
      const updates = columns.filter(
        (key) =>
          key !== "asset_id" &&
          (key !== "folder_path" || Object.hasOwn(record, "folder_path")) &&
          (key !== "archived" || Object.hasOwn(record, "archived")),
      );
      const db = await database();
      // Repeated reads/backfills are idempotent, including updated_at.
      await db.execute(
        `INSERT INTO environment_assets (${columns.map((key) => `\`${key}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON DUPLICATE KEY UPDATE ${updates.map((key) => `\`${key}\`=VALUES(\`${key}\`)`).join(",")}`,
        Object.values(row),
      );
    },
    async manage_folder(body) {
      const db = await database();
      const { manage_model_folder } = await import("./folders.js");
      return manage_model_folder(db, body);
    },
    async close() {
      if (pool) await (await pool).end();
      pool = null;
    },
  };
}
