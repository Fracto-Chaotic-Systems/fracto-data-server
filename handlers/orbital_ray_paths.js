import { db_connect, db_disconnect } from "../mysql.js";
import { OrbitalDataStore } from "./orbital_data_store.js";
import { positive_id, fail } from "./orbital_data_contract.js";
import {
  lifecycle_for,
  save_lifecycle,
  path_lifecycle,
} from "./orbital_lifecycle.js";
import {
  prepare_orbital_cache,
  save_orbital_cache,
  decode_orbital_cache,
} from "./orbital_ray_cache_codec.js";
import { build_orbital_trace_request } from "../../../sdk/orbitals/FractoOrbitalTraceRequest.js";
import {
  ORBITAL_RAY_CACHE_VERSION,
  MAX_ORBITAL_RAY_WRITE_BYTES,
  orbital_ray_identity,
  orbital_ray_cache_matches,
  merge_orbital_ray_cache,
} from "../../../sdk/orbitals/FractoOrbitalRayCache.js";

const request_for = (orbital) =>
  build_orbital_trace_request(
    {
      x: orbital.focal_point.re,
      y: orbital.focal_point.im,
    },
    orbital,
  );

/** The orbital lock serializes merges and binds every write to current stored targets. */
export class OrbitalRayPathStore {
  constructor({
    connect = db_connect,
    disconnect = db_disconnect,
    store = new OrbitalDataStore(),
  } = {}) {
    this.connect = connect;
    this.disconnect = disconnect;
    this.store = store;
  }
  async get(value) {
    const id = positive_id(value),
      connection = this.connect();
    try {
      const db = connection.promise();
      const orbital = await this.store.get(id, db);
      const request = request_for(orbital);
      const [rows] = await db.execute(
        "SELECT paths FROM orbital_ray_paths WHERE orbital_id=?",
        [id],
      );
      const cache = rows.length
        ? await decode_orbital_cache(db, rows[0].paths)
        : null;
      return orbital_ray_cache_matches(cache, request) ? cache : null;
    } finally {
      this.disconnect(connection);
    }
  }
  async put(value, body) {
    const id = positive_id(value);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw fail("invalid_ray_cache_request");
    // Reject malformed or oversized geometry before acquiring a row lock.
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_ORBITAL_RAY_WRITE_BYTES)
      throw fail("ray_cache_payload_too_large", 413);
    try {
      if (
        body.version !== ORBITAL_RAY_CACHE_VERSION ||
        body.request?.orbital_id !== id
      )
        throw Error("invalid_ray_cache_version_or_id");
      merge_orbital_ray_cache(null, body.request, body.rays, body.quality);
    } catch (error) {
      throw fail(error.message);
    }
    const connection = this.connect(),
      db = connection.promise();
    let transaction = false;
    try {
      await db.beginTransaction();
      transaction = true;
      const [locked] = await db.execute(
        "SELECT id,lifecycle_state FROM orbital_progressions WHERE id=? FOR UPDATE",
        [id],
      );
      if (!locked.length) throw fail("orbital_not_found", 404);
      const orbital = await this.store.get(id, db);
      const request = request_for(orbital);
      if (
        JSON.stringify(orbital_ray_identity(request)) !==
        JSON.stringify(orbital_ray_identity(body.request))
      )
        throw fail("orbital_ray_targets_changed", 409);
      const [rows] = await db.execute(
        "SELECT paths FROM orbital_ray_paths WHERE orbital_id=?",
        [id],
      );
      const previous = rows.length
        ? await decode_orbital_cache(db, rows[0].paths)
        : null;
      const cache = merge_orbital_ray_cache(
        previous,
        request,
        body.rays,
        body.quality,
      );
      await db.execute(
        "INSERT INTO orbital_ray_paths (orbital_id, paths) VALUES (?,?) ON DUPLICATE KEY UPDATE paths=VALUES(paths)",
        [id, await save_orbital_cache(db, await prepare_orbital_cache(cache))],
      );
      const paths = path_lifecycle(cache, request, body.quality);
      const current = lifecycle_for(orbital);
      await save_lifecycle(db, id, current, {
        paths,
        assignments:
          current.assignments === "verified"
            ? "verified"
            : paths.status === "cached"
              ? "verified"
              : "partial",
      });
      await db.commit();
      transaction = false;
      return { saved: true, updated_at: cache.updated_at };
    } catch (error) {
      if (transaction) await db.rollback().catch(() => {});
      throw error;
    } finally {
      this.disconnect(connection);
    }
  }
}
