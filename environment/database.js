import { readFile } from "node:fs/promises";
import {
  CATALOG_FIELDS,
  catalog_view,
  validate_model_category,
} from "@fracto/sdk/FractoEnvironmentCatalog.js";

// Only asset provenance is persisted; never copy arbitrary record extensions.
export function environment_asset_row(record, revision) {
  const view = catalog_view(record);
  return {
    asset_id: record.id,
    name: record.name,
    version: record.version,
    category: record.category || "environment",
    model_category: validate_model_category(record.model_category),
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
        `SELECT asset_id, name, model_category, model_path, model_format FROM environment_assets WHERE asset_id > ?${category === undefined ? "" : " AND model_category = ?"} ORDER BY asset_id LIMIT ${limit + 1}`,
        parameters,
      );
      const more = rows.length > limit;
      const assets = rows.slice(0, limit).map((row) => ({
        id: row.asset_id,
        name: row.name,
        category: row.model_category,
        model: row.model_path,
        format: row.model_format,
      }));
      return { assets, next_cursor: more ? assets.at(-1).id : null };
    },
    async sync(record, revision) {
      const row = environment_asset_row(record, revision);
      const columns = Object.keys(row);
      const updates = columns.filter((key) => key !== "asset_id");
      const db = await database();
      // Repeated reads/backfills are idempotent, including updated_at.
      await db.execute(
        `INSERT INTO environment_assets (${columns.map((key) => `\`${key}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON DUPLICATE KEY UPDATE ${updates.map((key) => `\`${key}\`=VALUES(\`${key}\`)`).join(",")}`,
        Object.values(row),
      );
    },
    async close() {
      if (pool) await (await pool).end();
      pool = null;
    },
  };
}
