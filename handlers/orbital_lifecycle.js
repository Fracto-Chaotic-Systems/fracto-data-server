import { normalize_orbital_lifecycle } from "@fracto/sdk/orbitals/FractoOrbitalLifecycle.js";
import {
  orbital_ray_identity,
  cached_orbital_rays,
} from "@fracto/sdk/orbitals/FractoOrbitalRayCache.js";
import { build_orbital_trace_request } from "@fracto/sdk/orbitals/FractoOrbitalTraceRequest.js";
import { orbital_parameter } from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { SEED_SURVEY_RAY_OPTIONS } from "@fracto/sdk/orbitals/FractoDynamicRays.js";
import { hash, json_value } from "./orbital_data_contract.js";

export const lifecycle_for = (row) => {
  const state = normalize_orbital_lifecycle(json_value(row.lifecycle_state), {
    stored: true,
    ray_status: row.ray_status,
  });
  if (
    row.orbital_id != null &&
    row.focal_point &&
    row.points &&
    ["cached", "partial"].includes(state.paths.status)
  ) {
    const request = build_orbital_trace_request(
      orbital_parameter(row.focal_point),
      row,
    );
    if (state.paths.identity_key !== hash(orbital_ray_identity(request)))
      state.paths.status = "stale";
  }
  return state;
};

/** Caller holds the orbital lock and commits this alongside the evidence. */
export const save_lifecycle = async (db, id, current, changes) => {
  const state = normalize_orbital_lifecycle({ ...current, ...changes });
  await db.execute(
    "UPDATE orbital_progressions SET lifecycle_state=? WHERE id=?",
    [JSON.stringify(state), id],
  );
  return state;
};

export const path_lifecycle = (
  cache,
  request,
  profile = SEED_SURVEY_RAY_OPTIONS,
) => {
  const cached_rays = cached_orbital_rays(cache, request, profile).length;
  return {
    status:
      cached_rays === request.requests.length && cached_rays > 0
        ? "cached"
        : cached_rays > 0
          ? "partial"
          : "missing",
    cached_rays,
    required_rays: request.requests.length,
    identity_key: hash(orbital_ray_identity(request)),
    profile: {
      tolerance: profile.tolerance,
      precision_digits: profile.precision_digits,
      minimum_depth: profile.minimum_depth,
    },
  };
};
