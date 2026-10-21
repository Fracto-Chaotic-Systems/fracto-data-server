import { encode_ray_cache, decode_ray_cache } from "./minibrot_ray_codec.js";
import { db_connect, db_disconnect } from "../mysql.js";
import {
  ray_cache_identity,
  ray_cache_matches,
  merge_ray_cache,
  MAX_RAY_GROUP_BYTES,
  RAY_CACHE_VERSION,
} from "../../../sdk/orbitals/FractoMinibrotRayCache.js";

const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
const failure = (res, error) => {
  if (error.code === "ER_BAD_FIELD_ERROR")
    return res.status(503).json({
      error: "Ray cache migration 003 has not been applied",
      code: "ray_cache_schema_pending",
    });
  console.error("minibrot ray cache:", error.code || error.message);
  return res.status(error.status || 500).json({
    error: error.status ? error.message : "Ray cache storage unavailable",
  });
};
const reject = (message, status) => Object.assign(Error(message), { status });

/** Injectable connections keep database and concurrency behavior testable. */
export function create_minibrot_ray_handlers({
  connect = db_connect,
  disconnect = db_disconnect,
} = {}) {
  const get = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0)
      return res.status(400).json({ error: "Invalid minibrot id" });
    let connection;
    try {
      connection = connect();
      const [rows] = await connection
        .promise()
        .query(
          "SELECT id, core_point, pattern, ray_paths FROM free_bailiwicks WHERE id = ?",
          [id],
        );
      if (!rows.length)
        return res.status(404).json({ error: "Minibrot not found" });
      const row = rows[0],
        cache = await decode_ray_cache(row.ray_paths);
      return res.json({
        result: ray_cache_matches(
          cache,
          parse(row.core_point),
          Number(row.pattern),
        )
          ? cache
          : null,
      });
    } catch (error) {
      return failure(res, error);
    } finally {
      if (connection) disconnect(connection);
    }
  };
  const put = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0)
      return res.status(400).json({ error: "Invalid minibrot id" });
    const body = req.body || {};
    let identity;
    try {
      identity = ray_cache_identity(body.core_point, body.period);
      if (body.version !== RAY_CACHE_VERSION)
        throw Error("Unsupported ray cache algorithm version");
      if (Buffer.byteLength(JSON.stringify(body)) > MAX_RAY_GROUP_BYTES)
        return res
          .status(413)
          .json({ error: "Ray cache payload exceeds 20 MiB" });
      // Validate before opening/locking a database row.
      merge_ray_cache(
        null,
        body.core_point,
        body.period,
        body.group,
        body.result,
        body.tolerance,
      );
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    let connection,
      db,
      transaction = false;
    try {
      connection = connect();
      db = connection.promise();
      await db.beginTransaction();
      transaction = true;
      const [rows] = await db.query(
        "SELECT id, core_point, pattern, ray_paths FROM free_bailiwicks WHERE id = ? FOR UPDATE",
        [id],
      );
      if (!rows.length) throw reject("Minibrot not found", 404);
      const row = rows[0],
        core = parse(row.core_point);
      const actual = ray_cache_identity(core, Number(row.pattern));
      if (JSON.stringify(actual) !== JSON.stringify(identity))
        throw reject("Minibrot core or period changed; reload the record", 409);
      const cache = merge_ray_cache(
        await decode_ray_cache(row.ray_paths),
        core,
        Number(row.pattern),
        body.group,
        body.result,
        body.tolerance,
      );
      const json = await encode_ray_cache(cache);
      await db.query(
        "UPDATE free_bailiwicks SET ray_paths = ?, updated_at = updated_at WHERE id = ?",
        [json, id],
      );
      await db.commit();
      transaction = false;
      return res.json({
        result: {
          saved: true,
          group: body.group,
          updated_at: cache.updated_at,
        },
      });
    } catch (error) {
      if (transaction) await db.rollback().catch(() => {});
      return failure(res, error);
    } finally {
      if (connection) disconnect(connection);
    }
  };
  return { get, put };
}
const handlers = create_minibrot_ray_handlers();
export const handle_minibrot_rays_get = handlers.get;
export const handle_minibrot_rays_put = handlers.put;
