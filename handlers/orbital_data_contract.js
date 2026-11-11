import { createHash } from "node:crypto";
import { orbital_parameter } from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { ORBITAL_DISCOVERY_STRATEGIES } from "@fracto/sdk/orbitals/FractoOrbitalLifecycle.js";
import {
  SEED_SURVEY_DISCOVERY_OPTIONS,
  MAX_SCAN_ORBITALS,
} from "@fracto/sdk/orbitals/FractoSeedSurveyScan.js";

export const fail = (code, status = 400) =>
  Object.assign(Error(code), { code, status });
export const json_value = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
export const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const focal_identity = (point) => {
  const parameter = orbital_parameter(point);
  return { parameter, focal_key: hash([parameter.x, parameter.y]) };
};
export const positive_id = (value) => {
  const text = String(value);
  if (!/^[1-9]\d{0,19}$/.test(text) || BigInt(text) > 18446744073709551615n)
    throw fail("invalid_id");
  return text;
};
export const run_id = (value) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      String(value),
    )
  )
    throw fail("invalid_run_id");
  return value;
};
const defaults = {
  max_period: 4096, // Legacy diagnostic option; the survey does not enumerate/filter periods.
  grid_size: SEED_SURVEY_DISCOVERY_OPTIONS.grid_size,
  half_span: SEED_SURVEY_DISCOVERY_OPTIONS.half_span,
  precision_digits: SEED_SURVEY_DISCOVERY_OPTIONS.precision_digits,
  newton_iterations: SEED_SURVEY_DISCOVERY_OPTIONS.newton_iterations,
  iteration_limit: SEED_SURVEY_DISCOVERY_OPTIONS.iteration_limit,
  max_angle_period: 24,
  max_families: 1024,
  max_orbitals: MAX_SCAN_ORBITALS,
  catalog_max_denominator: 255,
  catalog_max_families: 1024,
  catalog_retry_unresolved: 0,
  discovery_strategy: ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY,
};
const limits = {
  max_period: [1, 4096],
  grid_size: [2, 1024],
  half_span: [0.01, 2],
  precision_digits: [64, 256],
  newton_iterations: [10, 100],
  iteration_limit: [100000, 10000000],
  max_angle_period: [1, 24],
  max_families: [1, 4096],
  max_orbitals: [1, MAX_SCAN_ORBITALS],
  catalog_max_denominator: [0, 1000000],
  catalog_max_families: [1, 4096],
  catalog_retry_unresolved: [0, 1],
};
export const discovery_request = (body) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) => !["free_bailiwick_id", "settings", "request_key"].includes(k),
    )
  )
    throw fail("invalid_request");
  const source_id = positive_id(body.free_bailiwick_id);
  const input = body.settings ?? {};
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !Object.hasOwn(defaults, k))
  )
    throw fail("invalid_settings");
  const settings = { ...defaults, ...input };
  if (
    input.discovery_strategy === undefined &&
    settings.catalog_max_denominator === 0
  )
    settings.discovery_strategy = ORBITAL_DISCOVERY_STRATEGIES.SURVEY;
  if (
    !Object.values(ORBITAL_DISCOVERY_STRATEGIES).includes(
      settings.discovery_strategy,
    ) ||
    (settings.discovery_strategy === ORBITAL_DISCOVERY_STRATEGIES.SURVEY) !==
      (settings.catalog_max_denominator === 0)
  )
    throw fail("invalid_settings");
  for (const [key, value] of Object.entries(settings)) {
    if (key === "discovery_strategy") continue;
    const [min, max] = limits[key];
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (key !== "half_span" && !Number.isInteger(value))
    )
      throw fail("invalid_settings");
  }
  if (
    body.request_key !== undefined &&
    (typeof body.request_key !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(body.request_key))
  )
    throw fail("invalid_request_key");
  return { source_id, settings, request_key: body.request_key || null };
};
export const discovery_seeds = ({ grid_size, half_span }) => {
  const seeds = new Map([["0,0", { x: 0, y: 0 }]]);
  for (let row = 0; row < grid_size; row++)
    for (let col = 0; col < grid_size; col++) {
      const x = -half_span + (2 * half_span * col) / (grid_size - 1);
      const y = -half_span + (2 * half_span * row) / (grid_size - 1);
      seeds.set(`${x},${y}`, { x, y });
    }
  return [...seeds.values()];
};
