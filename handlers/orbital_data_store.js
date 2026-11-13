import { randomUUID } from "node:crypto";
import {
  initial_checkpoint,
  encode_checkpoint,
  decode_checkpoint,
  checkpoint_stage,
  bind_checkpoint_strategy,
} from "./orbital_data_checkpoint.js";
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
  discovery_request,
} from "./orbital_data_contract.js";
import { create_orbital_database_pool } from "./orbital_data_database.js";
import {
  normalize_orbital_lifecycle,
  orbital_is_selectable,
  stored_discovery_strategy,
} from "@fracto/sdk/orbitals/FractoOrbitalLifecycle.js";
import { lifecycle_for, save_lifecycle } from "./orbital_lifecycle.js";
import {
  needs_confirmation_repair,
  prepare_confirmation_repair,
} from "./orbital_confirmation_repair.js";
export { open_orbital_database } from "./orbital_data_database.js";
const terminal = ["completed", "partial", "cancelled", "failed", "interrupted"];
const run_fields =
  "id, source_bailiwick_id, focal_re, focal_im, source_pattern, settings, calculation_version, status, stage, progress, error_code, cancel_requested, resume_count, created_at, updated_at";
const header_fields =
  "id, free_bailiwick_id, focal_re, focal_im, period, precision_digits, closure_error, closure_tolerance, identity_tolerance, calculation_version, ray_status, ray_metadata, discovery_metadata, lifecycle_state";
const points_for = async (db, id) => {
  const [rows] = await db.execute(
    "SELECT point_re AS re, point_im AS im FROM orbital_progression_points WHERE orbital_id=? ORDER BY point_index",
    [id],
  );
  return rows;
};

const request_digest = (source, request) =>
  hash([
    ORBITAL_CALCULATION_VERSION,
    source.id,
    source.parameter,
    source.pattern,
    request.settings,
  ]);
const restartable_sql =
  "SELECT r.id FROM orbital_discovery_runs r LEFT JOIN orbital_discovery_checkpoints c ON c.run_id=r.id WHERE r.source_bailiwick_id=? AND JSON_EXTRACT(r.progress,'$.superseded_by') IS NULL AND (c.run_id IS NOT NULL OR r.status IN ('queued','running')) AND (c.phase<>'done' OR r.status IN ('queued','running','cancelled','interrupted','failed')) AND r.status IN ('queued','running','interrupted','cancelled','failed','partial') ORDER BY (r.status IN ('queued','running') AND r.lease_expires_at>NOW(3)) DESC,r.created_at DESC,r.id DESC LIMIT 1";

const bailiwick_lock = (id) => hash(["orbital_bailiwick", String(id)]);

// Called under the bailiwick's database lock when admitting or claiming work.
// Leases remain authoritative, including for runs created by older servers.
const assert_bailiwick_idle = async (db, source_id, except_id = "") => {
  const [rows] = await db.execute(
    "SELECT id FROM orbital_discovery_runs WHERE source_bailiwick_id=? AND id<>? AND status IN ('queued','running') AND cancel_requested=0 AND lease_expires_at>NOW(3) LIMIT 1",
    [source_id, except_id],
  );
  if (rows.length) throw fail("bailiwick_busy", 409);
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
    const request_hash = request_digest(source, request);
    const initial = initial_checkpoint(request_hash, request.settings),
      payload = await encode_checkpoint(initial);
    return this.with_db(async (db) => {
      let locked = false,
        transaction = false;
      const lock_key = bailiwick_lock(source.id);
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
      try {
        const [locks] = await db.execute("SELECT GET_LOCK(?,10) AS acquired", [
          lock_key,
        ]);
        if (Number(locks[0].acquired) !== 1)
          throw fail("focal_point_busy", 503);
        locked = true;
        await assert_bailiwick_idle(db, source.id);
        if (request.request_key) {
          const found = await existing();
          if (found) return found;
        } else {
          const [rows] = await db.execute(restartable_sql, [source.id]);
          if (rows.length) return { id: rows[0].id, reused: true };
        }
        const id = randomUUID();
        await db.beginTransaction();
        transaction = true;
        await db.execute(
          "INSERT INTO orbital_discovery_runs (id,request_key,request_hash,source_bailiwick_id,focal_key,focal_re,focal_im,source_pattern,settings,calculation_version,status,stage,progress,lease_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,'queued','queued','{}',DATE_ADD(NOW(3),INTERVAL 120 SECOND))",
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
        await db.execute(
          "INSERT INTO orbital_discovery_checkpoints (run_id,format_version,phase,payload) VALUES (?,?,?,?)",
          [id, initial.version, initial.stage, payload],
        );
        if (request.rediscover)
          await db.execute(
            `UPDATE orbital_discovery_runs SET progress=JSON_SET(COALESCE(progress,JSON_OBJECT()),'$.superseded_by',?)
          WHERE source_bailiwick_id=? AND id<>? AND (status IN ('cancelled','interrupted','failed','partial')
          OR (status IN ('queued','running') AND (lease_expires_at IS NULL OR lease_expires_at<=NOW(3))))`,
            [id, source.id, id],
          );
        await db.commit();
        transaction = false;
        return { id, reused: false };
      } catch (error) {
        if (transaction) await db.rollback();
        if (request.request_key && error.code === "ER_DUP_ENTRY")
          return existing();
        throw error;
      } finally {
        if (locked) {
          try {
            await db.execute("SELECT RELEASE_LOCK(?)", [lock_key]);
          } catch (error) {
            db.destroy();
            throw error;
          }
        }
      }
    });
  }
  async lookup_run(source, request) {
    return this.with_db(async (db) => {
      await assert_bailiwick_idle(db, source.id);
      if (!request.request_key) {
        const [rows] = await db.execute(restartable_sql, [source.id]);
        return rows[0]?.id || null;
      }
      const [rows] = await db.execute(
        "SELECT id,request_hash FROM orbital_discovery_runs WHERE request_key=?",
        [request.request_key],
      );
      if (
        rows.length &&
        rows[0].request_hash !== request_digest(source, request)
      )
        throw fail("request_key_conflict", 409);
      return rows[0]?.id || null;
    });
  }
  async latest_job(source, request) {
    const id = await this.with_db(async (db) => {
      const [rows] = await db.execute(restartable_sql, [source.id]);
      return rows[0]?.id;
    });
    return id ? this.get_run(id) : null;
  }
  async claim_run(id) {
    return this.with_db(async (db) => {
      const [sources] = await db.execute(
        "SELECT source_bailiwick_id FROM orbital_discovery_runs WHERE id=?",
        [id],
      );
      if (!sources.length) throw fail("discovery_job_not_found", 404);
      const source_id = String(sources[0].source_bailiwick_id);
      const lock_key = bailiwick_lock(source_id);
      const [locks] = await db.execute("SELECT GET_LOCK(?,10) AS acquired", [
        lock_key,
      ]);
      if (Number(locks[0].acquired) !== 1) throw fail("bailiwick_busy", 409);
      try {
        await db.beginTransaction();
        await assert_bailiwick_idle(db, source_id, id);
        const [rows] = await db.execute(
          "SELECT *,lease_expires_at>NOW(3) AS lease_active FROM orbital_discovery_runs WHERE id=? FOR UPDATE",
          [id],
        );
        if (!rows.length) throw fail("discovery_job_not_found", 404);
        const row = rows[0];
        if (row.calculation_version !== ORBITAL_CALCULATION_VERSION)
          throw fail("checkpoint_version_mismatch", 409);
        if (["completed"].includes(row.status)) {
          await db.commit();
          return { owned: false };
        }
        if (
          ["queued", "running"].includes(row.status) &&
          row.execution_token &&
          Number(row.lease_active) === 1
        ) {
          throw fail("bailiwick_busy", 409);
        }
        const [checkpoints] = await db.execute(
          "SELECT payload FROM orbital_discovery_checkpoints WHERE run_id=?",
          [id],
        );
        if (!checkpoints.length) throw fail("checkpoint_unavailable", 409);
        const checkpoint = await decode_checkpoint(checkpoints[0].payload);
        const source = {
          id: String(row.source_bailiwick_id),
          pattern: Number(row.source_pattern),
          ...focal_identity({ x: row.focal_re, y: row.focal_im }),
        };
        const original_settings = json_value(row.settings);
        bind_checkpoint_strategy(checkpoint, original_settings);
        const request = discovery_request({
          free_bailiwick_id: source.id,
          settings: original_settings,
        });
        request.settings.discovery_strategy =
          stored_discovery_strategy(original_settings);
        // MySQL JSON can reorder keys. Rebuild historical defaults order
        // without injecting newly introduced keys into the request digest.
        const digest_settings = Object.fromEntries(
          Object.entries(request.settings).filter(([key]) =>
            Object.hasOwn(original_settings, key),
          ),
        );
        if (
          checkpoint.input_hash !== row.request_hash ||
          request_digest(source, { settings: digest_settings }) !==
            row.request_hash
        )
          throw fail("checkpoint_input_mismatch", 409);
        const repairing_confirmation = prepare_confirmation_repair(
          checkpoint,
          original_settings,
        );
        if (checkpoint.stage === "done" && row.status === "partial") {
          await db.commit();
          return { owned: false };
        }
        if (repairing_confirmation)
          await db.execute(
            "UPDATE orbital_discovery_checkpoints SET phase=?,format_version=?,payload=? WHERE run_id=?",
            [
              checkpoint.stage,
              checkpoint.version,
              await encode_checkpoint(checkpoint),
              id,
            ],
          );
        const token = randomUUID();
        const resumed = row.execution_token != null || row.status !== "queued";
        await db.execute(
          "UPDATE orbital_discovery_runs SET execution_token=?,resume_count=resume_count+?,cancel_requested=0,status='queued',stage='queued',error_code=NULL,progress=?,lease_expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND) WHERE id=?",
          [token, resumed ? 1 : 0, JSON.stringify(checkpoint.progress), id],
        );
        await db.commit();
        return {
          owned: true,
          token,
          checkpoint,
          settings: {
            ...request.settings,
            // Existing checkpoints keep their original unscoped solver profile.
            catalog_pattern_periods:
              original_settings.catalog_pattern_periods ?? 0,
            catalog_pattern_angles: original_settings.catalog_pattern_angles ?? 0,
            catalog_max_denominator: Object.hasOwn(
              original_settings,
              "catalog_max_denominator",
            )
              ? request.settings.catalog_max_denominator
              : 0,
          },
          source,
        };
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        try {
          await db.execute("SELECT RELEASE_LOCK(?)", [lock_key]);
        } catch (error) {
          db.destroy();
          throw error;
        }
      }
    });
  }
  async save_checkpoint(id, checkpoint, token) {
    const payload = await encode_checkpoint(checkpoint);
    return this.with_db(async (db) => {
      await db.beginTransaction();
      try {
        const owner = await this.assert_active(db, id, token);
        if (checkpoint.input_hash !== owner.request_hash)
          throw fail("checkpoint_input_mismatch", 409);
        await db.execute(
          "UPDATE orbital_discovery_checkpoints SET phase=?,format_version=?,payload=? WHERE run_id=?",
          [checkpoint.stage, checkpoint.version, payload, id],
        );
        await db.execute(
          "UPDATE orbital_discovery_runs SET stage=?,progress=?,lease_expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND) WHERE id=?",
          [
            checkpoint_stage(checkpoint),
            JSON.stringify(checkpoint.progress),
            id,
          ],
        );
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      }
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
      const [checkpoints] = await db.execute(
        "SELECT phase,updated_at FROM orbital_discovery_checkpoints WHERE run_id=?",
        [id],
      );
      const [results] = await db.execute(
        "SELECT orbital_id,disposition,discovery_method,discovery_metadata FROM orbital_discovery_results WHERE run_id=? ORDER BY orbital_id",
        [id],
      );
      const confirmation_repair_available = needs_confirmation_repair(
        json_value(row.settings),
        json_value(row.progress),
      );
      return {
        ...row,
        confirmation_repair_available,
        resume_count: Number(row.resume_count || 0),
        resumable: Boolean(
          checkpoints.length &&
          ["cancelled", "interrupted", "failed", "partial"].includes(
            row.status,
          ) &&
          (checkpoints[0].phase !== "done" ||
            row.status !== "partial" ||
            confirmation_repair_available),
        ),
        checkpoint_phase: checkpoints[0]?.phase || null,
        source_bailiwick_id: String(row.source_bailiwick_id),
        settings: json_value(row.settings),
        discovery_strategy: stored_discovery_strategy(json_value(row.settings)),
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
  async checkpoint(
    id,
    stage,
    progress,
    status = "running",
    error_code = null,
    token = null,
  ) {
    return this.with_db(async (db) => {
      const [result] = await db.execute(
        `UPDATE orbital_discovery_runs SET stage=?,status=?,progress=?,error_code=?,
        lease_expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND)
        WHERE id=? AND cancel_requested=0 AND status IN ('queued','running') AND execution_token<=>? AND lease_expires_at>=NOW(3)`,
        [stage, status, JSON.stringify(progress), error_code, id, token],
      );
      if (!result.affectedRows) throw fail("job_not_active", 409);
    });
  }
  async heartbeat(id, token = null) {
    return this.with_db(async (db) => {
      const [result] = await db.execute(
        `UPDATE orbital_discovery_runs SET lease_expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND)
        WHERE id=? AND cancel_requested=0 AND status IN ('queued','running') AND execution_token<=>? AND lease_expires_at>=NOW(3)`,
        [id, token],
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
  async assert_active(db, id, token = null) {
    const [rows] = await db.execute(
      "SELECT status,cancel_requested,execution_token,request_hash,lease_expires_at>NOW(3) AS lease_active FROM orbital_discovery_runs WHERE id=? FOR UPDATE",
      [id],
    );
    if (
      !rows.length ||
      terminal.includes(rows[0].status) ||
      rows[0].cancel_requested ||
      (rows[0].execution_token ?? null) !== token ||
      Number(rows[0].lease_active) !== 1
    )
      throw fail("job_not_active", 409);
    return rows[0];
  }
  async save_orbital(run, source, candidate, token = null) {
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
        await this.assert_active(db, run, token);
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
              [
                "catalog_ray_endpoint_newton",
                "catalog_representative_newton",
              ].includes(candidate.discovery_method) &&
                Number(header.identity_tolerance) > 0 &&
                Number(header.identity_tolerance) <= ORBIT_CLOSURE_TOLERANCE
                ? header.identity_tolerance
                : checked.identity_tolerance,
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
        const merge_metadata = (previous, incoming) => ({
          ...incoming,
          ...(json_value(previous) || {}),
          run_id: run,
          catalog: {
            ...((json_value(previous) || {}).catalog || {}),
            ...(incoming.catalog || {}),
            family_keys: [
              ...new Set([
                ...((json_value(previous) || {}).catalog?.family_keys || []),
                ...(incoming.catalog?.family_keys || []),
              ]),
            ],
          },
        });
        const is_catalog = [
          "catalog_ray_endpoint_newton",
          "catalog_representative_newton",
        ].includes(candidate.discovery_method);
        const discovery_metadata = is_catalog
          ? merge_metadata(
              orbital.discovery_metadata,
              candidate.discovery_metadata || {},
            )
          : candidate.discovery_metadata || null;
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
        let run_metadata = discovery_metadata;
        if (is_catalog) {
          const [prior] = await db.execute(
            "SELECT discovery_metadata FROM orbital_discovery_results WHERE run_id=? AND orbital_id=?",
            [run, orbital.id],
          );
          run_metadata = merge_metadata(
            prior[0]?.discovery_metadata,
            candidate.discovery_metadata || {},
          );
        }
        await db.execute(
          `INSERT INTO orbital_discovery_results (run_id,orbital_id,disposition,discovery_method,discovery_metadata)
          VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE discovery_metadata=VALUES(discovery_metadata)`,
          [
            run,
            orbital.id,
            disposition,
            candidate.discovery_method,
            run_metadata ? JSON.stringify(run_metadata) : null,
          ],
        );
        orbital.lifecycle_state = await save_lifecycle(
          db,
          orbital.id,
          disposition === "created"
            ? normalize_orbital_lifecycle(null)
            : lifecycle_for(orbital),
          { orbital: "validated" },
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
  async save_rays(run, orbital, result, token = null, options = {}) {
    validate_landing_families(result.ratios, orbital.period, options);
    return this.with_db(async (db) => {
      await db.beginTransaction();
      try {
        await this.assert_active(db, run, token);
        const [headers] = await db.execute(
          "SELECT id,ray_status,lifecycle_state FROM orbital_progressions WHERE id=? FOR UPDATE",
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
        let lifecycle = lifecycle_for(headers[0]);
        if (["cached", "partial"].includes(lifecycle.paths.status))
          lifecycle = (await this.get(orbital.id, db)).lifecycle_state;
        const assignments =
          headers[0].ray_status === "rays_found" || result.ratios.length
            ? "verified"
            : result.status === "attracting"
              ? "not_applicable"
              : "unresolved";
        await save_lifecycle(db, orbital.id, lifecycle, { assignments });
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      }
    });
  }
  async save_pending_assignments(run, orbital, token) {
    return this.with_db(async (db) => {
      await db.beginTransaction();
      try {
        await this.assert_active(db, run, token);
        const [rows] = await db.execute(
          "SELECT id,ray_status,lifecycle_state FROM orbital_progressions WHERE id=? FOR UPDATE",
          [orbital.id],
        );
        if (!rows.length) throw fail("orbital_not_found", 404);
        const current = lifecycle_for(rows[0]);
        if (
          !["verified", "partial", "not_applicable"].includes(
            current.assignments,
          )
        )
          await save_lifecycle(db, orbital.id, current, {
            assignments: "pending",
          });
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
        lifecycle_state: lifecycle_for(r),
        selectable: orbital_is_selectable(lifecycle_for(r)),
      }));
    });
  }
  async latest_survey(parameter) {
    const { focal_key } = focal_identity(parameter);
    return this.with_db(async (db) => {
      const [runs] = await db.execute(
        `SELECT id,progress FROM orbital_discovery_runs WHERE focal_key=? AND calculation_version=?
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
        WHERE r.run_id=? ORDER BY (JSON_EXTRACT(r.discovery_metadata,'$.rank') IS NULL),CAST(JSON_UNQUOTE(JSON_EXTRACT(r.discovery_metadata,'$.rank')) AS UNSIGNED),o.id`,
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
          lifecycle_state: lifecycle_for(row),
          selectable: orbital_is_selectable(lifecycle_for(row)),
        })),
        stale: false,
        run_id: runs[0].id,
        coverage: json_value(runs[0].progress)?.catalog_coverage || null,
        calculation_version: ORBITAL_CALCULATION_VERSION,
      };
    });
  }
  async get(id, connection_db = null) {
    const read = async (db) => {
      const [rows] = await db.execute(
        `SELECT o.id,o.free_bailiwick_id,o.focal_re,o.focal_im,o.period,o.precision_digits,o.closure_error,
        o.closure_tolerance,o.identity_tolerance,o.calculation_version,o.ray_status,o.ray_metadata,o.discovery_metadata,o.lifecycle_state,
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
      const orbital = {
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
      orbital.lifecycle_state = lifecycle_for({
        ...orbital,
        lifecycle_state: first.lifecycle_state,
      });
      orbital.selectable = orbital_is_selectable(orbital.lifecycle_state);
      return orbital;
    };
    return connection_db ? read(connection_db) : this.with_db(read);
  }
}
