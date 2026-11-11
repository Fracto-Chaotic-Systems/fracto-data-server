import { readFile } from "node:fs/promises";
import BigComplex from "@fracto/sdk/math/BigComplex.js";
import {
  validate_denominator_catalog,
  catalog_doubling_families,
} from "@fracto/sdk/orbitals/FractoDenominatorCatalog.js";
import {
  CATALOG_ORBITAL_DISCOVERY_VERSION,
  catalog_discovery_profile,
} from "@fracto/sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import { ORBIT_CLOSURE_TOLERANCE } from "@fracto/sdk/orbitals/FractoSeedSurveyConfirmation.js";
import { fail, hash } from "./orbital_data_contract.js";
import { catalog_coverage } from "./orbital_catalog_coverage.js";
import { prepare_confirmation_repair } from "./orbital_confirmation_repair.js";
import { REPRESENTATIVE_CONFIRMATION_REVISION } from "@fracto/sdk/orbitals/FractoRepresentativeRaySolver.js";
import {
  compact_investigation_profile,
  COMPACT_SOLVER_VERSION,
} from "./orbital_compact_contract.js";
import { LANDING_ASSIGNMENT_VERSION } from "@fracto/sdk/orbitals/FractoLandingAssignments.js";
import {
  ORBITAL_DISCOVERY_STRATEGIES,
  stored_discovery_strategy,
} from "@fracto/sdk/orbitals/FractoOrbitalLifecycle.js";

let bundled;
export const load_job_catalog = async (maximum) => {
  bundled ||= readFile(
    new URL(
      "../../../sdk/orbitals/data/denominator-catalog.json",
      import.meta.url,
    ),
    "utf8",
  )
    .then((text) => validate_denominator_catalog(JSON.parse(text)))
    .catch((error) => {
      bundled = null;
      throw error;
    });
  const catalog = await bundled;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > catalog.max_denominator
  )
    throw fail("catalog_bound_unavailable", 400);
  const denominators = catalog.denominators.filter(
    (entry) => Number(entry.denominator) <= maximum,
  );
  return {
    ...catalog,
    max_denominator: maximum,
    denominators,
    family_count: denominators.reduce(
      (sum, entry) => sum + entry.families.length,
      0,
    ),
    angle_count: denominators.reduce(
      (sum, entry) => sum + entry.families.length * entry.angle_period,
      0,
    ),
  };
};
export const job_catalog_profile = (settings) =>
  catalog_discovery_profile({
    precision_digits: Math.max(128, settings.precision_digits || 128),
    newton_iterations: settings.newton_iterations || 80,
    max_families: settings.catalog_max_families || 1024,
    retain_geometry: true,
  });
export const job_compact_profile = (settings) => ({
  ...compact_investigation_profile({
    discovery: {
      precision_digits: Math.max(128, settings.precision_digits || 128),
      newton_iterations: settings.newton_iterations || 80,
    },
    validation: {
      precision_digits: Math.max(128, settings.precision_digits || 128),
      full_fallback: false,
    },
    assignment_version: LANDING_ASSIGNMENT_VERSION,
  }),
  max_families: settings.catalog_max_families || 1024,
});

/** Map complete ratios to the actual stored forward-cycle order without changing points. */
export const catalog_publication = (outcome, saved, profile) => {
  const D = new BigComplex(0, 0, 128).Decimal;
  const tolerance =
    saved.identity_tolerance || outcome.candidate.identity_tolerance;
  if (!(Number(tolerance) > 0) || Number(tolerance) > ORBIT_CLOSURE_TOLERANCE)
    throw fail("invalid_orbital_identity_tolerance", 409);
  const source = outcome.candidate.points,
    target = saved.points;
  if (source.length !== target.length)
    throw fail("catalog_orbital_mismatch", 409);
  const shift = target.findIndex((_, offset) =>
    source.every((point, index) => {
      const other = target[(index + offset) % target.length];
      return (
        new D(point.re).minus(other.re).abs().lte(tolerance) &&
        new D(point.im).minus(other.im).abs().lte(tolerance)
      );
    }),
  );
  if (shift < 0) throw fail("catalog_orbital_mismatch", 409);
  return {
    status: "rays_found",
    ratios: outcome.landing_ratios.map((ratio) => ({
      ...ratio,
      point_index: (ratio.point_index + shift) % target.length,
    })),
    metadata: {
      strategy: "denominator_catalog",
      catalog_family: outcome.family,
      profile,
      search: { complete: false },
    },
  };
};

/** Advance one ledger-backed family, committing publication before moving its cursor. */
export const advance_catalog_job = async (
  jobs,
  id,
  source,
  settings,
  state,
  cp,
) => {
  const compact =
    stored_discovery_strategy(settings) ===
    ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY;
  const solver_version = compact
    ? COMPACT_SOLVER_VERSION
    : CATALOG_ORBITAL_DISCOVERY_VERSION;
  state.catalog_inputs ||= {
    catalog: await jobs.catalog_provider(settings.catalog_max_denominator),
    profile: compact
      ? job_compact_profile(settings)
      : job_catalog_profile(settings),
  };
  const { catalog, profile } = state.catalog_inputs;
  state.catalog_inputs.families ||= [...catalog_doubling_families(catalog)];
  const signature = hash([
    catalog.version,
    catalog.max_denominator,
    catalog.family_count,
    solver_version,
    profile,
  ]);
  cp.catalog ||= {
    signature,
    family_index: 0,
    finalize_index: 0,
    matched_ids: [],
    accepted: 0,
    unresolved: 0,
    cache_hits: 0,
    unresolved_details: [],
    ...(compact
      ? { confirmation_revision: REPRESENTATIVE_CONFIRMATION_REVISION }
      : {}),
  };
  if (cp.catalog.signature !== signature)
    throw fail("checkpoint_version_mismatch", 409);
  prepare_confirmation_repair(cp, settings);
  const progress = cp.catalog,
    total = Math.min(profile.max_families, catalog.family_count);
  Object.assign(state.progress, {
    phase: "catalog",
    catalog_processed: progress.family_index,
    catalog_total: total,
    catalog_families: catalog.family_count,
    catalog_max_denominator: catalog.max_denominator,
    catalog_accepted: progress.accepted,
    catalog_unresolved: progress.unresolved,
    catalog_cache_hits: progress.cache_hits,
    catalog_coverage: catalog_coverage(catalog, progress, total),
    ...(compact
      ? { catalog_confirmation_revision: progress.confirmation_revision }
      : {}),
    ...(compact
      ? {
          catalog_confirmation_retries: progress.confirmation_retry_index || 0,
          catalog_confirmation_retry_total:
            progress.confirmation_retry_keys?.length || 0,
        }
      : {}),
  });
  if (cp.stage === "catalog_finalize") {
    if (compact || progress.finalize_index === cp.orbitals.length) {
      cp.stage = "done";
      if (compact)
        cp.limited = total < catalog.family_count || progress.unresolved > 0;
      if (total < catalog.family_count || progress.unresolved)
        cp.limited = true;
      return;
    }
    const orbital = cp.orbitals[progress.finalize_index];
    if (!progress.matched_ids.includes(orbital.id))
      await jobs.store.save_rays(
        id,
        orbital,
        {
          status: "unresolved",
          ratios: [],
          metadata: {
            strategy: "denominator_catalog",
            max_denominator: catalog.max_denominator,
            search: {
              complete: false,
              exhausted: total === catalog.family_count,
            },
          },
        },
        state.token,
      );
    progress.finalize_index++;
    return;
  }
  const retry_key =
    progress.confirmation_retry_keys?.[progress.confirmation_retry_index || 0];
  if (!retry_key && progress.family_index === total) {
    cp.stage = "catalog_finalize";
    return;
  }
  const retry_index = retry_key
    ? state.catalog_inputs.families.findIndex(
        (family) => family.key === retry_key,
      )
    : -1;
  if (
    retry_key &&
    (retry_index < 0 ||
      retry_index >= progress.family_index ||
      retry_index >= total)
  )
    throw fail("invalid_confirmation_retry", 409);
  const family =
    state.catalog_inputs.families[
      retry_key ? retry_index : progress.family_index
    ];
  state.catalog_family_key = family.key;
  const context = {
    parameter: source.parameter,
    family,
    profile,
    catalog_version: catalog.version,
    solver_version,
  };
  const owner = { run_id: id, execution_token: state.token };
  await jobs.store.checkpoint(
    id,
    "discovering",
    state.progress,
    "running",
    null,
    state.token,
  );
  const claim = await jobs.family_store.claim(context, {
    owner,
    retry_unresolved: !!settings.catalog_retry_unresolved,
  });
  if (claim.status === "busy") throw fail("investigation_busy", 409);
  let outcome;
  if (claim.status === "cached") {
    outcome = claim.result;
    progress.cache_hits = Math.min(
      progress.family_index + (retry_key ? 0 : 1),
      progress.cache_hits + 1,
    );
  } else if (claim.status === "claimed") {
    state.family_claim = { context, token: claim.token, owner };
    try {
      let result = await jobs.task(
        id,
        state,
        compact ? "orbital_catalog_representative" : "orbital_catalog_family",
        { parameter: source.parameter, family, profile },
        "discovering",
      );
      if (
        result.status !== "orbital_found" &&
        !(
          compact &&
          ["assignments_verified", "assignments_pending"].includes(
            result.status,
          )
        )
      )
        result = {
          status: "unresolved",
          reason: result.reason || result.status,
          refinement_attempts: result.refinement_attempts || [],
          ...(compact
            ? { confirmation_revision: result.confirmation_revision }
            : {}),
        };
      outcome = await jobs.family_store.complete(
        context,
        claim.token,
        result,
        owner,
      );
    } finally {
      await jobs.family_store
        .release(context, claim.token, "job_interrupted")
        .catch(() => {});
      state.family_claim = null;
    }
  } else throw Error("invalid_investigation_claim");
  if (outcome.status === "orbital_found" || (compact && outcome.candidate)) {
    const candidate = {
      ...outcome.candidate,
      discovery_method: compact
        ? "catalog_representative_newton"
        : "catalog_ray_endpoint_newton",
      discovery_metadata: {
        algorithm: compact
          ? "catalog-representative-v1"
          : "denominator-catalog-v1",
        run_id: id,
        catalog: {
          version: catalog.version,
          solver_version,
          ...(compact
            ? {
                assignment_version: LANDING_ASSIGNMENT_VERSION,
                assignments:
                  outcome.status === "orbital_found" ? "verified" : "pending",
                path_policy: "on_selection",
              }
            : {}),
          max_denominator: catalog.max_denominator,
          family_keys: [family.key],
        },
      },
    };
    const saved = await jobs.store.save_orbital(
      id,
      source,
      candidate,
      state.token,
    );
    if (outcome.status === "orbital_found") {
      const publication = catalog_publication(outcome, saved, profile);
      await jobs.store.save_rays(id, saved, publication, state.token, {
        max_angle_period: compact
          ? profile.discovery.max_refinement_period
          : profile.max_family_rays,
      });
      if (!progress.matched_ids.includes(saved.id))
        progress.matched_ids.push(saved.id);
      progress.accepted++;
      state.progress.ratios += publication.ratios.length;
    } else await jobs.store.save_pending_assignments(id, saved, state.token);
    await jobs.family_store.attach_orbital(context, saved.id, owner);
    if (!cp.orbitals.some((orbital) => orbital.id === saved.id))
      cp.orbitals.push(saved);
    state.progress.orbital_count = cp.orbitals.length;
  }
  if (retry_key) {
    const previous = progress.unresolved_details.findIndex(
      (row) => row.family_key === retry_key,
    );
    if (previous < 0 || progress.unresolved < 1)
      throw fail("invalid_confirmation_retry", 409);
    progress.unresolved_details.splice(previous, 1);
    progress.unresolved--;
  }
  if (outcome.status !== "orbital_found") {
    progress.unresolved++;
    (progress.unresolved_details ||= []).push({
      family_key: family.key,
      denominator: family.denominator,
      angle_period: family.angle_period,
      reason: outcome.reason || "unresolved",
    });
    cp.limited = true;
  }
  if (retry_key) progress.confirmation_retry_index++;
  else progress.family_index++;
  Object.assign(state.progress, {
    catalog_processed: progress.family_index,
    catalog_accepted: progress.accepted,
    catalog_unresolved: progress.unresolved,
    catalog_cache_hits: progress.cache_hits,
    catalog_coverage: catalog_coverage(catalog, progress, total),
    ...(compact
      ? { catalog_confirmation_retries: progress.confirmation_retry_index || 0 }
      : {}),
  });
};
