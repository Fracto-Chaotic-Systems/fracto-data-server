import { randomUUID } from "node:crypto";
import {
  ORBITAL_CALCULATION_VERSION,
  canonical_orbital,
  same_orbital_cycle,
} from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "@fracto/sdk/orbitals/FractoOrbitalDiscovery.js";
import { ORBIT_CLOSURE_TOLERANCE } from "@fracto/sdk/orbitals/FractoSeedSurveyConfirmation.js";
import {
  fail,
  json_value,
  hash,
  focal_identity,
} from "./orbital_data_contract.js";
import { create_orbital_database_pool } from "./orbital_data_database.js";
export { open_orbital_database } from "./orbital_data_database.js";
const terminal = ["completed", "partial", "cancelled", "failed", "interrupted"];
const run_fields =
  "id, source_bailiwick_id, focal_re, focal_im, source_pattern, settings, calculation_version, status, stage, progress, error_code, cancel_requested, created_at, updated_at";
const header_fields =
  "id, free_bailiwick_id, focal_re, focal_im, period, precision_digits, closure_error, closure_tolerance, identity_tolerance, calculation_version, ray_status, ray_metadata, discovery_metadata";
const points_for = async (db, id) => {
  const [rows] = await db.execute(
    "SELECT point_re AS re, point_im AS im FROM orbital_progression_points WHERE orbital_id=? ORDER BY point_index",
    [id],
  );
  return rows;
};

/** All calculations stay outside connections/transactions; opens are injectable. */
export class OrbitalDataStore {
  constructor({ open, source_open } = {}) {
    this.pool = null;
    this.open =
      open ||
      (async () => {
        this.pool ??= create_orbital_database_pool();
        return (await this.pool).getConnection();
      });
    this.source_open = source_open || this.open;
  }
  async close() {
    if (this.pool) await (await this.pool).end();
  }
  async with_db(operation, open = this.open) {
    const db = await open();
    try {
      return await operation(db);
    } finally {
      if (typeof db.connection?.release === "function") db.release();
      else await db.end();
    }
  }
  async source(id) {
    return this.with_db(async (db) => {
      const [rows] = await db.execute(
        "SELECT id,core_point,pattern FROM free_bailiwicks WHERE id=?",
        [id],
      );
      if (!rows.length) throw fail("free_bailiwick_not_found", 404);
      let identity;
      try {
        identity = focal_identity(json_value(rows[0].core_point));
      } catch {
        throw fail("invalid_source_core_point");
      }
      if (
        !Number.isInteger(Number(rows[0].pattern)) ||
        Number(rows[0].pattern) < 1 ||
        Number(rows[0].pattern) > 4294967295
      )
        throw fail("invalid_source_pattern");
      return {
        id: String(rows[0].id),
        pattern: Number(rows[0].pattern),
        ...identity,
      };
    }, this.source_open);
  }
  async create_run(source, request) {
    const request_hash = hash([
      ORBITAL_CALCULATION_VERSION,
      source.id,
      source.parameter,
      source.pattern,
      request.settings,
    ]);
    return this.with_db(async (db) => {
      const existing = async () => {
        const [rows] = await db.execute(
          "SELECT id,request_hash FROM orbital_discovery_runs WHERE request_key=?",
          [request.request_key],
        );
        if (!rows.length) return null;
        if (rows[0].request_hash !== request_hash)
          throw fail("request_key_conflict", 409);
        return { id: rows[0].id, reused: true };
      };
      if (request.request_key) {
        const found = await existing();
        if (found) return found;
      }
      const id = randomUUID();
      try {
        await db.execute(
          `INSERT INTO orbital_discovery_runs
          (id,request_key,request_hash,source_bailiwick_id,focal_key,focal_re,focal_im,source_pattern,settings,calculation_version,status,stage,progress,lease_expires_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,'queued','queued','{}',DATE_ADD(NOW(3),INTERVAL 120 SECOND))`,
          [
            id,
            request.request_key,
            request_hash,
            source.id,
            source.focal_key,
            source.parameter.x,
            source.parameter.y,
            source.pattern,
            JSON.stringify(request.settings),
            ORBITAL_CALCULATION_VERSION,
          ],
        );
      } catch (error) {
        if (request.request_key && error.code === "ER_DUP_ENTRY")
          return existing();
        throw error;
      }
      return { id, reused: false };
    });
  }
  async get_run(id) {
    return this.with_db(async (db) => {
      await db.execute(
        `UPDATE orbital_discovery_runs SET status='interrupted',stage='interrupted',error_code='lease_expired'
        WHERE id=? AND status IN ('queued','running') AND lease_expires_at<NOW(3)`,
        [id],
      );
      const [rows] = await db.execute(
        `SELECT ${run_fields} FROM orbital_discovery_runs WHERE id=?`,
        [id],
      );
      if (!rows.length) throw fail("discovery_job_not_found", 404);
      const row = rows[0];
      const [results] = await db.execute(
        "SELECT orbital_id,disposition,discovery_method,discovery_metadata FROM orbital_discovery_results WHERE run_id=? ORDER BY orbital_id",
        [id],
      );
      return {
        ...row,
        source_bailiwick_id: String(row.source_bailiwick_id),
        settings: json_value(row.settings),
        progress: json_value(row.progress),
        focal_point: { re: row.focal_re, im: row.focal_im },
        results: results.map((r) => ({
          ...r,
          orbital_id: String(r.orbital_id),
          discovery_metadata: json_value(r.discovery_metadata),
        })),
      };
    });
  }
  async checkpoint(id, stage, progress, status = "running", error_code = null) {
    return this.with_db(async (db) => {
      const [result] = await db.execute(
        `UPDATE orbital_discovery_runs SET stage=?,status=?,progress=?,error_code=?,
        lease_expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND)
        WHERE id=? AND cancel_requested=0 AND status IN ('queued','running')`,
        [stage, status, JSON.stringify(progress), error_code, id],
      );
      if (!result.affectedRows) throw fail("job_not_active", 409);
    });
  }
  async heartbeat(id) {
    return this.with_db(async (db) => {
      const [result] = await db.execute(
        `UPDATE orbital_discovery_runs SET lease_expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND)
        WHERE id=? AND cancel_requested=0 AND status IN ('queued','running')`,
        [id],
      );
      if (!result.affectedRows) throw fail("job_not_active", 409);
    });
  }
  async cancel(id) {
    await this.with_db(async (db) =>
      db.execute(
        `UPDATE orbital_discovery_runs SET cancel_requested=1,status='cancelled',stage='cancelled'
      WHERE id=? AND status IN ('queued','running')`,
        [id],
      ),
    );
    return this.get_run(id);
  }
  async assert_active(db, id) {
    const [rows] = await db.execute(
      "SELECT status,cancel_requested FROM orbital_discovery_runs WHERE id=? FOR UPDATE",
      [id],
    );
    if (
      !rows.length ||
      terminal.includes(rows[0].status) ||
      rows[0].cancel_requested
    )
      throw fail("job_not_active", 409);
  }
  async save_orbital(run, source, candidate) {
    const checked = canonical_orbital(
      source.parameter,
      candidate.points,
      candidate.precision_digits,
      candidate.discovery_method === "seed_survey_scan"
        ? {
            closure_tolerance: String(ORBIT_CLOSURE_TOLERANCE),
            identity_tolerance: String(ORBIT_CLOSURE_TOLERANCE),
            reduce_period: false,
          }
        : {},
    );
    if (!checked) throw fail("invalid_orbital");
    return this.with_db(async (db) => {
      let locked = false;
      try {
        const [lock] = await db.execute("SELECT GET_LOCK(?,10) AS acquired", [
          source.focal_key,
        ]);
        if (Number(lock[0].acquired) !== 1) throw fail("focal_point_busy", 503);
        locked = true;
        await db.beginTransaction();
        await this.assert_active(db, run);
        const [headers] = await db.execute(
          `SELECT ${header_fields} FROM orbital_progressions WHERE focal_key=? AND period=?`,
          [source.focal_key, checked.period],
        );
        let orbital,
          disposition = "reused";
        for (const header of headers) {
          const points = await points_for(db, header.id);
          if (
            same_orbital_cycle(
              checked.points,
              points,
              checked.identity_tolerance,
            )
          ) {
            orbital = { ...header, points };
            break;
          }
        }
        if (!orbital) {
          const [insert] = await db.execute(
            `INSERT INTO orbital_progressions
            (focal_key,focal_re,focal_im,period,precision_digits,closure_error,closure_tolerance,identity_tolerance,calculation_version,free_bailiwick_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [
              source.focal_key,
              source.parameter.x,
              source.parameter.y,
              checked.period,
              checked.precision_digits,
              checked.closure_error,
              checked.closure_tolerance,
              checked.identity_tolerance,
              checked.calculation_version,
              source.id,
            ],
          );
          orbital = {
            ...checked,
            id: String(insert.insertId),
            ray_status: "pending",
            free_bailiwick_id: source.id,
          };
          for (const [index, point] of checked.points.entries())
            await db.execute(
              "INSERT INTO orbital_progression_points (orbital_id,point_index,point_re,point_im) VALUES (?,?,?,?)",
              [orbital.id, index, point.re, point.im],
            );
          disposition = "created";
        }
        if (orbital.free_bailiwick_id == null) {
          await db.execute(
            "UPDATE orbital_progressions SET free_bailiwick_id=? WHERE id=? AND free_bailiwick_id IS NULL",
            [source.id, orbital.id],
          );
          orbital.free_bailiwick_id = source.id;
        }
        const discovery_metadata = candidate.discovery_metadata || null;
        if (discovery_metadata) {
          await db.execute(
            "UPDATE orbital_progressions SET discovery_metadata=?,calculation_version=? WHERE id=?",
            [
              JSON.stringify(discovery_metadata),
              ORBITAL_CALCULATION_VERSION,
              orbital.id,
            ],
          );
          orbital.discovery_metadata = discovery_metadata;
          orbital.calculation_version = ORBITAL_CALCULATION_VERSION;
        }
        await db.execute(
          `INSERT INTO orbital_discovery_results (run_id,orbital_id,disposition,discovery_method,discovery_metadata)
          VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE discovery_metadata=VALUES(discovery_metadata)`,
          [
            run,
            orbital.id,
            disposition,
            candidate.discovery_method,
            discovery_metadata ? JSON.stringify(discovery_metadata) : null,
          ],
        );
        await db.commit();
        return { ...orbital, id: String(orbital.id), disposition };
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        if (locked) {
          try {
            await db.execute("SELECT RELEASE_LOCK(?)", [source.focal_key]);
          } catch (error) {
            db.destroy();
            throw error;
          }
        }
      }
    });
  }
  async save_rays(run, orbital, result) {
    validate_landing_families(result.ratios, orbital.period);
    return this.with_db(async (db) => {
      await db.beginTransaction();
      try {
        await this.assert_active(db, run);
        const [headers] = await db.execute(
          "SELECT id,ray_status FROM orbital_progressions WHERE id=? FOR UPDATE",
          [orbital.id],
        );
        if (!headers.length) throw fail("orbital_not_found", 404);
        for (const ratio of result.ratios)
          await db.execute(
            `INSERT INTO orbital_landing_ratios
          (orbital_id,point_index,numerator,denominator,family_key,angle_period,landing_error,validation_status,calculation_version)
          VALUES (?,?,?,?,?,?,?,'validated',?) ON DUPLICATE KEY UPDATE landing_error=LEAST(landing_error,VALUES(landing_error))`,
            [
              orbital.id,
              ratio.point_index,
              ratio.numerator,
              ratio.denominator,
              ratio.family_key,
              ratio.angle_period,
              ratio.landing_error,
              ORBITAL_CALCULATION_VERSION,
            ],
          );
        if (headers[0].ray_status !== "rays_found" || result.ratios.length)
          await db.execute(
            "UPDATE orbital_progressions SET ray_status=?,ray_metadata=? WHERE id=?",
            [
              result.ratios.length ? "rays_found" : result.status,
              JSON.stringify(result.metadata),
              orbital.id,
            ],
          );
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      }
    });
  }
  async list(parameter, limit = 100, after = "0") {
    const { focal_key } = focal_identity(parameter);
    return this.with_db(async (db) => {
      const [rows] = await db.query(
        `SELECT ${header_fields} FROM orbital_progressions WHERE focal_key=? AND id>? ORDER BY id LIMIT ?`,
        [focal_key, after, limit],
      );
      return rows.map((r) => ({
        ...r,
        id: String(r.id),
        free_bailiwick_id:
          r.free_bailiwick_id == null ? null : String(r.free_bailiwick_id),
        ray_metadata: json_value(r.ray_metadata),
        discovery_metadata: json_value(r.discovery_metadata),
      }));
    });
  }
  async latest_survey(parameter) {
    const { focal_key } = focal_identity(parameter);
    return this.with_db(async (db) => {
      const [runs] = await db.execute(
        `SELECT id FROM orbital_discovery_runs WHERE focal_key=? AND calculation_version=?
        AND status IN ('completed','partial') ORDER BY created_at DESC,id DESC LIMIT 1`,
        [focal_key, ORBITAL_CALCULATION_VERSION],
      );
      if (!runs.length) {
        const [existing] = await db.execute(
          "SELECT id FROM orbital_progressions WHERE focal_key=? LIMIT 1",
          [focal_key],
        );
        return {
          result: [],
          stale: Boolean(existing.length),
          calculation_version: ORBITAL_CALCULATION_VERSION,
        };
      }
      const columns = header_fields
        .split(",")
        .map((field) => `o.${field.trim()}`)
        .join(",");
      const [rows] = await db.execute(
        `SELECT ${columns},r.discovery_metadata AS run_metadata
        FROM orbital_discovery_results r JOIN orbital_progressions o ON o.id=r.orbital_id
        WHERE r.run_id=? ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(r.discovery_metadata,'$.rank')) AS UNSIGNED),o.id`,
        [runs[0].id],
      );
      return {
        result: rows.map(({ run_metadata, ...row }) => ({
          ...row,
          id: String(row.id),
          free_bailiwick_id:
            row.free_bailiwick_id == null
              ? null
              : String(row.free_bailiwick_id),
          ray_metadata: json_value(row.ray_metadata),
          discovery_metadata: json_value(run_metadata),
        })),
        stale: false,
        run_id: runs[0].id,
        calculation_version: ORBITAL_CALCULATION_VERSION,
      };
    });
  }
  async get(id) {
    return this.with_db(async (db) => {
      const [rows] = await db.execute(
        `SELECT o.id,o.free_bailiwick_id,o.focal_re,o.focal_im,o.period,o.precision_digits,o.closure_error,
        o.closure_tolerance,o.identity_tolerance,o.calculation_version,o.ray_status,o.ray_metadata,o.discovery_metadata,
        p.point_index,p.point_re,p.point_im,r.numerator,r.denominator,r.family_key,r.angle_period,r.landing_error,r.validation_status
        FROM orbital_progressions o JOIN orbital_progression_points p ON p.orbital_id=o.id
        LEFT JOIN orbital_landing_ratios r ON r.orbital_id=p.orbital_id AND r.point_index=p.point_index
        WHERE o.id=? ORDER BY p.point_index,r.family_key,r.numerator`,
        [id],
      );
      if (!rows.length) throw fail("orbital_not_found", 404);
      const first = rows[0],
        points = new Map();
      for (const r of rows) {
        if (!points.has(r.point_index))
          points.set(r.point_index, {
            point_index: r.point_index,
            point: { re: r.point_re, im: r.point_im },
            landing_ratios: [],
          });
        if (r.numerator !== null)
          points.get(r.point_index).landing_ratios.push({
            numerator: r.numerator,
            denominator: r.denominator,
            family_key: r.family_key,
            angle_period: r.angle_period,
            landing_error: r.landing_error,
            validation_status: r.validation_status,
          });
      }
      return {
        orbital_id: String(first.id),
        free_bailiwick_id:
          first.free_bailiwick_id == null
            ? null
            : String(first.free_bailiwick_id),
        focal_point: { re: first.focal_re, im: first.focal_im },
        period: first.period,
        precision_digits: first.precision_digits,
        closure_error: first.closure_error,
        closure_tolerance: first.closure_tolerance,
        identity_tolerance: first.identity_tolerance,
        calculation_version: first.calculation_version,
        ray_status: first.ray_status,
        ray_metadata: json_value(first.ray_metadata),
        discovery_metadata: json_value(first.discovery_metadata),
        points: [...points.values()],
      };
    });
  }
}
