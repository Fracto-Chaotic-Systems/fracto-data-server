import {
  representative_ray_profile,
  REPRESENTATIVE_RAY_SOLVER_VERSION,
  REPRESENTATIVE_CONFIRMATION_REVISION,
} from "@fracto/sdk/orbitals/FractoRepresentativeRaySolver.js";
import {
  landing_assignment_profile,
  LANDING_ASSIGNMENT_VERSION,
  recheck_landing_assignment_evidence,
} from "@fracto/sdk/orbitals/FractoLandingAssignments.js";
import {
  canonical_orbital,
  orbital_parameter,
} from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";

export const COMPACT_SOLVER_VERSION = REPRESENTATIVE_RAY_SOLVER_VERSION;
export const compact_investigation_profile = (profile = {}) => {
  if (
    profile.assignment_version !== LANDING_ASSIGNMENT_VERSION ||
    profile.validation?.full_fallback === true
  )
    throw Error("invalid_compact_profile");
  return {
    discovery: representative_ray_profile(profile.discovery),
    validation: {
      ...landing_assignment_profile(profile.validation),
      full_fallback: false,
    },
    assignment_version: LANDING_ASSIGNMENT_VERSION,
  };
};
export const validate_compact_family_outcome = (context, result) => {
  const profile = compact_investigation_profile(context.profile),
    parameter = orbital_parameter(context.parameter);
  if (
    !result ||
    Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024 ||
    result.rays?.length
  )
    throw Error("invalid_compact_outcome");
  const reason = result.reason || "unresolved";
  const confirmation_revision = result.confirmation_revision ?? 1;
  if (
    !Number.isSafeInteger(confirmation_revision) ||
    confirmation_revision < 1 ||
    confirmation_revision > REPRESENTATIVE_CONFIRMATION_REVISION
  )
    throw Error("invalid_confirmation_revision");
  if (!/^[a-z0-9_:-]{1,96}$/.test(reason))
    throw Error("invalid_investigation_reason");
  const refinement_attempts = result.refinement_attempts || [];
  if (
    !Array.isArray(refinement_attempts) ||
    refinement_attempts.length > 8192 ||
    refinement_attempts.some(
      (a) =>
        !Number.isSafeInteger(a.period) ||
        a.period < 1 ||
        context.family.angle_period % a.period ||
        !Number.isSafeInteger(a.precision_digits) ||
        a.precision_digits < 64 ||
        a.precision_digits > 512 ||
        !/^[a-z0-9_:-]{1,96}$/.test(a.reason),
    )
  )
    throw Error("invalid_investigation_evidence");
  if (result.status === "unresolved" && !result.candidate) {
    if (result.landing_ratios?.length)
      throw Error("invalid_unresolved_investigation");
    return {
      status: "unresolved",
      confirmation_revision,
      reason,
      refinement_attempts: structuredClone(refinement_attempts),
    };
  }
  const candidate = canonical_orbital(
    parameter,
    result.candidate?.points,
    result.candidate?.precision_digits,
  );
  if (
    !candidate ||
    candidate.period !== result.candidate.period ||
    context.family.angle_period % candidate.period ||
    candidate.points.some(
      (point, index) =>
        point.re !== result.candidate.points[index].re ||
        point.im !== result.candidate.points[index].im,
    ) ||
    !Number.isInteger(candidate.precision_digits) ||
    candidate.precision_digits < 64 ||
    candidate.precision_digits > 512
  )
    throw Error("invalid_investigation_orbital");
  if (["assignments_pending", "unresolved"].includes(result.status)) {
    if (result.landing_ratios?.length) throw Error("unverified_compact_ratios");
    return {
      status: "unresolved",
      confirmation_revision,
      reason,
      candidate,
      landing_ratios: [],
      rays: [],
      family: {
        catalog_key: context.family.key,
        denominator: context.family.denominator,
        angle_period: context.family.angle_period,
      },
      refinement_attempts: structuredClone(refinement_attempts),
    };
  }
  const checked = { ...result, status: "assignments_verified" };
  if (!["assignments_verified", "orbital_found"].includes(result.status))
    throw Error("invalid_compact_outcome");
  recheck_landing_assignment_evidence(
    parameter,
    context.family,
    checked,
    profile.validation,
  );
  return {
    status: "orbital_found",
    confirmation_revision,
    solver_version: COMPACT_SOLVER_VERSION,
    assignment_version: LANDING_ASSIGNMENT_VERSION,
    parameter,
    candidate,
    family: structuredClone(result.family),
    representative: structuredClone(result.representative),
    landing_ratios: structuredClone(result.landing_ratios),
    assignment_profile: structuredClone(result.assignment_profile),
    evidence: structuredClone(result.evidence),
    rays: [],
    refinement_attempts: structuredClone(refinement_attempts),
  };
};
