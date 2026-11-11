import { randomUUID } from "node:crypto";
import { OrbitalDataStore } from "./orbital_data_store.js";
import { positive_id, run_id, fail } from "./orbital_data_contract.js";
import { COMPACT_SOLVER_VERSION } from "./orbital_compact_contract.js";
import { stale_representative_confirmation } from "@fracto/sdk/orbitals/FractoRepresentativeRaySolver.js";
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
import {
  family_investigation_identity,
  validate_family_outcome,
  family_hash,
  family_json,
} from "./orbital_family_contract.js";
import {
  validate_denominator_catalog,
  catalog_doubling_families,
} from "@fracto/sdk/orbitals/FractoDenominatorCatalog.js";
import {
  CATALOG_ORBITAL_DISCOVERY_VERSION,
  discover_catalog_orbitals,
} from "@fracto/sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import {
  orbital_parameter,
  same_orbital_cycle,
} from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { ORBIT_CLOSURE_TOLERANCE } from "@fracto/sdk/orbitals/FractoSeedSurveyConfirmation.js";
import { build_orbital_trace_request } from "@fracto/sdk/orbitals/FractoOrbitalTraceRequest.js";
import { merge_orbital_ray_cache } from "@fracto/sdk/orbitals/FractoOrbitalRayCache.js";

const insert_pending = (db, identity) =>
  db.execute(
    `INSERT INTO orbital_family_investigations
   (identity_key,focal_key,focal_re,focal_im,family_key,denominator,angle_period,catalog_version,solver_version,profile,status)
   VALUES (?,?,?,?,?,?,?,?,?,?,'pending') ON DUPLICATE KEY UPDATE identity_key=identity_key`,
    [
      identity.identity_key,
      identity.focal_key,
      identity.parameter.x,
      identity.parameter.y,
      identity.family_key,
      identity.denominator,
      identity.angle_period,
      identity.catalog_version,
      identity.solver_version,
      family_json(identity.profile),
    ],
  );
const load_locked = async (db, identity_key) =>
  (
    await db.execute(
      "SELECT *,lease_expires_at>NOW(3) AS lease_active FROM orbital_family_investigations WHERE identity_key=? FOR UPDATE",
      [identity_key],
    )
  )[0][0];

/** Per-family ownership and durable outcomes; no service jobs or HTTP writes are started here. */
export class OrbitalFamilyInvestigationStore {
  constructor({
    database = new OrbitalDataStore(),
    orbital_store = database,
    lease_seconds = 300,
  } = {}) {
    if (
      !Number.isInteger(lease_seconds) ||
      lease_seconds < 1 ||
      lease_seconds > 86400
    )
      throw Error("invalid_investigation_lease");
    this.database = database;
    this.orbital_store = orbital_store;
    this.lease_seconds = lease_seconds;
  }
  close() {
    return this.database.close?.();
  }
  async assert_owner(db, owner, row = null) {
    if (owner) {
      run_id(owner.run_id);
      run_id(owner.execution_token);
      await this.database.assert_active(
        db,
        owner.run_id,
        owner.execution_token,
      );
    }
    if (
      row &&
      (row.owner_run_id || owner) &&
      (row.owner_run_id !== owner?.run_id ||
        row.owner_execution_token !== owner?.execution_token)
    )
      throw fail("investigation_job_owner_mismatch", 409);
  }
  async transaction(operation) {
    return this.database.with_db(async (db) => {
      await db.beginTransaction();
      try {
        const result = await operation(db);
        await db.commit();
        return result;
      } catch (error) {
        await db.rollback().catch(() => {});
        throw error;
      }
    });
  }
  async prepare(parameter, catalog, profile) {
    validate_denominator_catalog(catalog);
    return this.database.with_db(async (db) => {
      for (const family of catalog_doubling_families(catalog))
        await insert_pending(
          db,
          family_investigation_identity({
            parameter,
            family,
            profile,
            catalog_version: catalog.version,
            solver_version: CATALOG_ORBITAL_DISCOVERY_VERSION,
          }),
        );
    });
  }
  async get(context) {
    const identity = family_investigation_identity(context);
    return this.database.with_db(async (db) => {
      const [rows] = await db.execute(
        "SELECT * FROM orbital_family_investigations WHERE identity_key=?",
        [identity.identity_key],
      );
      if (!rows.length) return null;
      return {
        ...rows[0],
        outcome: rows[0].outcome
          ? await decode_orbital_cache(db, rows[0].outcome)
          : null,
      };
    });
  }
  async claim(context, { retry_unresolved = false, owner = null } = {}) {
    const identity = family_investigation_identity(context);
    return this.transaction(async (db) => {
      await this.assert_owner(db, owner);
      await insert_pending(db, identity);
      const row = await load_locked(db, identity.identity_key);
      if (
        row.status === "validated" ||
        (row.status === "unresolved" && !retry_unresolved)
      ) {
        const result = validate_family_outcome(
          context,
          await decode_orbital_cache(db, row.outcome),
        );
        if (!(
          context.solver_version === COMPACT_SOLVER_VERSION &&
          stale_representative_confirmation(result)
        ))
          return { status: "cached", result };
      }
      const revoked_owner =
        owner &&
        row.owner_run_id === owner.run_id &&
        row.owner_execution_token !== owner.execution_token;
      if (
        row.status === "investigating" &&
        Number(row.lease_active) === 1 &&
        !revoked_owner
      )
        return { status: "busy" };
      if (row.lease_token)
        await db.execute(
          "UPDATE orbital_family_investigation_attempts SET status='unresolved',reason=?,finished_at=NOW(3) WHERE id=? AND status='investigating'",
          [revoked_owner ? "owner_replaced" : "lease_expired", row.lease_token],
        );
      const token = randomUUID();
      await db.execute(
        `UPDATE orbital_family_investigations SET status='investigating',reason=NULL,
        lease_token=?,lease_expires_at=DATE_ADD(NOW(3),INTERVAL ? SECOND),attempt_count=attempt_count+1,
        owner_run_id=?,owner_execution_token=? WHERE identity_key=?`,
        [
          token,
          this.lease_seconds,
          owner?.run_id || null,
          owner?.execution_token || null,
          identity.identity_key,
        ],
      );
      await db.execute(
        "INSERT INTO orbital_family_investigation_attempts (id,investigation_key,status) VALUES (?,?,'investigating')",
        [token, identity.identity_key],
      );
      return { status: "claimed", token };
    });
  }
  async heartbeat(context, token, owner = null) {
    const identity = family_investigation_identity(context);
    return this.transaction(async (db) => {
      await this.assert_owner(db, owner);
      const row = await load_locked(db, identity.identity_key);
      await this.assert_owner(db, owner, row);
      // Completion clears the lease before its final SQL acknowledgement reaches
      // the coordinator. A queued heartbeat for that same attempt is harmless.
      if (["validated", "unresolved"].includes(row?.status)) {
        const [finished] = await db.execute(
          "SELECT status,outcome_hash FROM orbital_family_investigation_attempts WHERE id=? AND investigation_key=?",
          [token, identity.identity_key],
        );
        if (finished[0]?.status === row.status && finished[0]?.outcome_hash)
          return;
      }
      const [updated] = await db.execute(
        `UPDATE orbital_family_investigations SET lease_expires_at=DATE_ADD(NOW(3),INTERVAL ? SECOND)
        WHERE identity_key=? AND lease_token=? AND status='investigating' AND lease_expires_at>NOW(3)`,
        [this.lease_seconds, identity.identity_key, token],
      );
      if (!updated.affectedRows) throw fail("investigation_lease_lost", 409);
    });
  }
  async complete(context, token, result, owner = null) {
    const identity = family_investigation_identity(context),
      checked = validate_family_outcome(context, result);
    const prepared = await prepare_orbital_cache(checked),
      outcome_hash = family_hash(checked);
    const status =
      checked.status === "orbital_found" ? "validated" : "unresolved";
    const evidence = {
      family: checked.family || null,
      candidate: checked.candidate || null,
      landing_ratios: checked.landing_ratios || [],
      refinement_attempts: checked.refinement_attempts,
    };
    return this.transaction(async (db) => {
      await this.assert_owner(db, owner);
      const row = await load_locked(db, identity.identity_key);
      await this.assert_owner(db, owner, row);
      const [attempts] = await db.execute(
        "SELECT * FROM orbital_family_investigation_attempts WHERE id=? AND investigation_key=?",
        [token, identity.identity_key],
      );
      const attempt = attempts[0];
      if (attempt?.outcome_hash === outcome_hash && attempt.status === status)
        return row?.status === "validated"
          ? validate_family_outcome(
              context,
              await decode_orbital_cache(db, row.outcome),
            )
          : checked;
      if (
        !row ||
        row.status !== "investigating" ||
        row.lease_token !== token ||
        Number(row.lease_active) !== 1 ||
        !attempt
      )
        throw fail("investigation_lease_lost", 409);
      await db.execute(
        `UPDATE orbital_family_investigations SET status=?,reason=?,outcome=?,lease_token=NULL,lease_expires_at=NULL WHERE identity_key=?`,
        [
          status,
          checked.reason || null,
          await save_orbital_cache(db, prepared),
          identity.identity_key,
        ],
      );
      await db.execute(
        `UPDATE orbital_family_investigation_attempts SET status=?,reason=?,outcome_hash=?,evidence=?,finished_at=NOW(3) WHERE id=?`,
        [
          status,
          checked.reason || null,
          outcome_hash,
          family_json(evidence),
          token,
        ],
      );
      return checked;
    });
  }
  async release(context, token, reason = "cancelled") {
    const identity = family_investigation_identity(context);
    if (!/^[a-z0-9_:-]{1,96}$/.test(reason))
      throw Error("invalid_investigation_reason");
    return this.transaction(async (db) => {
      const row = await load_locked(db, identity.identity_key);
      if (row?.lease_token !== token || row.status !== "investigating") return;
      await db.execute(
        "UPDATE orbital_family_investigations SET status='pending',reason=?,lease_token=NULL,lease_expires_at=NULL WHERE identity_key=?",
        [reason, identity.identity_key],
      );
      await db.execute(
        "UPDATE orbital_family_investigation_attempts SET status='unresolved',reason=?,finished_at=NOW(3) WHERE id=? AND status='investigating'",
        [reason, token],
      );
    });
  }
  async attach_orbital(context, value, owner = null) {
    const identity = family_investigation_identity(context),
      id = positive_id(value);
    return this.transaction(async (db) => {
      await this.assert_owner(db, owner);
      const [headers] = await db.execute(
        "SELECT id FROM orbital_progressions WHERE id=? FOR UPDATE",
        [id],
      );
      if (!headers.length) throw fail("orbital_not_found", 404);
      const row = await load_locked(db, identity.identity_key);
      if (
        row?.status !== "validated" &&
        !(
          context.solver_version === COMPACT_SOLVER_VERSION &&
          row?.status === "unresolved"
        )
      )
        throw fail("investigation_not_validated", 409);
      const result = validate_family_outcome(
        context,
        await decode_orbital_cache(db, row.outcome),
      );
      const orbital = await this.orbital_store.get(id, db);
      const identity_tolerance = Number(orbital.identity_tolerance || "1e-20");
      if (
        !Number.isFinite(identity_tolerance) ||
        identity_tolerance <= 0 ||
        identity_tolerance > ORBIT_CLOSURE_TOLERANCE
      )
        throw fail("invalid_orbital_identity_tolerance", 409);
      if (
        family_json(orbital_parameter(orbital.focal_point)) !==
          family_json(identity.parameter) ||
        !same_orbital_cycle(
          result.candidate.points,
          orbital.points.map((point) => point.point),
          identity_tolerance,
        )
      )
        throw fail("investigation_orbital_mismatch", 409);
      const request = build_orbital_trace_request(identity.parameter, orbital);
      const targets = new Map(
        request.requests.map((access) => [access.angle.key, access]),
      );
      if (context.solver_version === COMPACT_SOLVER_VERSION) {
        for (const ratio of result.landing_ratios || []) {
          const target = targets.get(`${ratio.numerator}/${ratio.denominator}`);
          const source = result.candidate.points[ratio.point_index];
          if (
            !target ||
            Math.abs(Number(target.landing_point.re) - Number(source.re)) >
              identity_tolerance ||
            Math.abs(Number(target.landing_point.im) - Number(source.im)) >
              identity_tolerance
          )
            throw fail("investigation_ratios_not_published", 409);
        }
        await db.execute(
          "UPDATE orbital_family_investigations SET orbital_id=? WHERE identity_key=?",
          [id, identity.identity_key],
        );
        return { orbital_id: id, paths: 0 };
      }
      const rays = result.rays.map((ray) => {
        const target = targets.get(ray.angle.key);
        if (!target) throw fail("investigation_ratios_not_published", 409);
        return {
          ...ray,
          point_index: target.point_index,
          landing_point: target.landing_point,
        };
      });
      const [cached] = await db.execute(
        "SELECT paths FROM orbital_ray_paths WHERE orbital_id=?",
        [id],
      );
      const cache = merge_orbital_ray_cache(
        cached.length ? await decode_orbital_cache(db, cached[0].paths) : null,
        request,
        rays,
        identity.profile,
      );
      await db.execute(
        "INSERT INTO orbital_ray_paths (orbital_id,paths) VALUES (?,?) ON DUPLICATE KEY UPDATE paths=VALUES(paths)",
        [id, await save_orbital_cache(db, await prepare_orbital_cache(cache))],
      );
      await save_lifecycle(db, id, lifecycle_for(orbital), {
        assignments: "verified",
        paths: path_lifecycle(cache, request, identity.profile),
      });
      await db.execute(
        "UPDATE orbital_family_investigations SET orbital_id=? WHERE identity_key=?",
        [id, identity.identity_key],
      );
      return { orbital_id: id, paths: rays.length };
    });
  }
}

/** Opt-in persistence adapter; application job scheduling is integrated separately. */
export const discover_persisted_catalog_orbitals = async (
  parameter,
  options = {},
) => {
  const store = options.store || new OrbitalFamilyInvestigationStore();
  try {
    if (!options.cancelled?.())
      await store.prepare(parameter, options.catalog, options);
    return await discover_catalog_orbitals(parameter, {
      ...options,
      investigation_store: store,
    });
  } finally {
    if (!options.store) await store.close();
  }
};
