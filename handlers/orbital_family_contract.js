import { createHash } from "node:crypto";
import {
  COMPACT_SOLVER_VERSION,
  compact_investigation_profile,
  validate_compact_family_outcome,
} from "./orbital_compact_contract.js";
import {
  DENOMINATOR_CATALOG_VERSION,
  COMPACT_CATALOG_VERSION,
} from "@fracto/sdk/orbitals/FractoDenominatorCatalog.js";
import {
  CATALOG_ORBITAL_DISCOVERY_VERSION,
  catalog_discovery_profile,
} from "@fracto/sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import { validate_catalog_ray_family } from "@fracto/sdk/orbitals/FractoCatalogDynamicRays.js";
import {
  canonical_orbital,
  orbital_parameter,
} from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "@fracto/sdk/orbitals/FractoOrbitalDiscovery.js";
import { merge_orbital_ray_cache } from "@fracto/sdk/orbitals/FractoOrbitalRayCache.js";
import { rational_angle } from "@fracto/sdk/orbitals/FractoRayGeometry.js";
import { orbital_period_allowed } from "@fracto/sdk/orbitals/FractoOrbitalPeriodScope.js";

const ordered = (value) =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, ordered(value[key])]),
        )
      : value;
export const family_json = (value) => JSON.stringify(ordered(value));
export const family_hash = (value) =>
  createHash("sha256").update(family_json(value)).digest("hex");

/** Bound-independent identity: extending a catalog must reuse earlier families. */
export const family_investigation_identity = (context) => {
  if (
    ![DENOMINATOR_CATALOG_VERSION, COMPACT_CATALOG_VERSION].includes(
      context?.catalog_version,
    ) ||
    ![CATALOG_ORBITAL_DISCOVERY_VERSION, COMPACT_SOLVER_VERSION].includes(
      context.solver_version,
    )
  )
    throw Error("invalid_investigation_version");
  const parameter = orbital_parameter(context.parameter),
    family = validate_catalog_ray_family(context.family);
  if (
    family.angles.some(
      (angle) => BigInt(angle.numerator) < BigInt(family.numerator),
    )
  )
    throw Error("noncanonical_investigation_family");
  const profile =
    context.solver_version === COMPACT_SOLVER_VERSION
      ? compact_investigation_profile(context.profile)
      : catalog_discovery_profile(context.profile);
  delete profile.max_families;
  delete profile.retain_geometry;
  const identity = {
    parameter,
    family_key: family.key,
    denominator: family.denominator,
    angle_period: family.angle_period,
    // v2 changes catalog encoding/filtering, not the meaning of an exact family.
    // Reuse existing v1 investigation evidence for unchanged families.
    catalog_version: DENOMINATOR_CATALOG_VERSION,
    solver_version: context.solver_version,
    profile,
  };
  return {
    ...identity,
    focal_key: family_hash([parameter.x, parameter.y]),
    identity_key: family_hash(identity),
  };
};

const reason = (value) => {
  if (typeof value !== "string" || !/^[a-z0-9_:-]{1,96}$/.test(value))
    throw Error("invalid_investigation_reason");
  return value;
};
const attempts = (values = [], period) => {
  if (!Array.isArray(values) || values.length > 8192)
    throw Error("invalid_investigation_evidence");
  return values.map((value) => {
    if (
      !Number.isSafeInteger(value.period) ||
      value.period < 1 ||
      period % value.period ||
      !Number.isInteger(value.precision_digits) ||
      value.precision_digits < 64 ||
      value.precision_digits > 512
    )
      throw Error("invalid_investigation_evidence");
    return {
      period: value.period,
      precision_digits: value.precision_digits,
      reason: reason(value.reason),
    };
  });
};

/** Recheck exact cycles, decimal closure, assignments and all geometry before SQL publication. */
export const validate_family_outcome = (context, result) => {
  const identity = family_investigation_identity(context);
  if (context.solver_version === COMPACT_SOLVER_VERSION)
    return validate_compact_family_outcome(context, result);
  const refinement_attempts = attempts(
    result?.refinement_attempts,
    identity.angle_period,
  );
  if (result?.status === "unresolved") {
    if (result.candidate || result.rays?.length)
      throw Error("invalid_unresolved_investigation");
    return {
      status: "unresolved",
      reason: reason(result.reason),
      refinement_attempts,
    };
  }
  if (result?.status !== "orbital_found")
    throw Error("invalid_investigation_outcome");
  const candidate = canonical_orbital(
    identity.parameter,
    result.candidate?.points,
    result.candidate?.precision_digits,
  );
  if (
    !candidate ||
    candidate.period !== result.candidate.period ||
    !orbital_period_allowed(identity.profile, candidate.period) ||
    !Number.isInteger(candidate.precision_digits) ||
    candidate.precision_digits < 64 ||
    candidate.precision_digits > 512 ||
    family_json(candidate.points) !== family_json(result.candidate.points) ||
    identity.angle_period % candidate.period
  )
    throw Error("invalid_investigation_orbital");
  const ratios = result.landing_ratios;
  validate_landing_families(ratios, candidate.period, {
    max_angle_period: identity.profile.max_family_rays,
  });
  const expected = new Set(context.family.angles.map((angle) => angle.key));
  if (
    ratios.length !== identity.angle_period ||
    ratios.some(
      (ratio) => !expected.delete(`${ratio.numerator}/${ratio.denominator}`),
    ) ||
    expected.size
  )
    throw Error("incomplete_investigation_family");
  const landing_family_key = context.family.angles
    .map((angle) => angle.key)
    .sort()[0];
  if (
    result.family?.catalog_key !== identity.family_key ||
    result.family.angle_period !== identity.angle_period ||
    result.family.period !== candidate.period ||
    result.family.denominator !== identity.denominator ||
    result.family.landing_family_key !== landing_family_key ||
    !Number.isInteger(result.family.representative_point_index) ||
    result.family.representative_point_index < 0 ||
    result.family.representative_point_index >= candidate.period ||
    ratios.some((ratio) => ratio.family_key !== landing_family_key)
  )
    throw Error("invalid_investigation_family");
  const request = {
    orbital_id: "1",
    focal_point: identity.parameter,
    period: candidate.period,
    orbital_points: candidate.points,
    requests: ratios.map((ratio) => ({
      angle: rational_angle(ratio.numerator, ratio.denominator),
      point_index: ratio.point_index,
      landing_point: candidate.points[ratio.point_index],
    })),
  };
  if (result.rays?.length !== identity.angle_period)
    throw Error("incomplete_investigation_geometry");
  const cache = merge_orbital_ray_cache(
    null,
    request,
    result.rays,
    identity.profile,
  );
  return {
    status: "orbital_found",
    candidate,
    landing_ratios: structuredClone(ratios),
    family: {
      catalog_key: identity.family_key,
      landing_family_key,
      denominator: identity.denominator,
      angle_period: identity.angle_period,
      period: candidate.period,
      representative_point_index: result.family.representative_point_index,
      representative_reused: !!result.family.representative_reused,
    },
    rays: Object.values(cache.entries).map((entry) => entry.ray),
    refinement_attempts,
  };
};
