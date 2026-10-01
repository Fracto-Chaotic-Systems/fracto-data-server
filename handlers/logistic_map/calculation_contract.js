/**
 * Contract helpers for a single logistic-map calculation.
 *
 * This module normalizes and validates requests and preserves their
 * provenance. Orbit iteration and candidate classification are separate
 * modules; persistence and HTTP handling belong to later stages.
 */

export const LOGISTIC_MAP_CONTRACT_VERSION = 1;

// Provisional defaults for initial setup. Tune with runtime and classification
// coverage measurements; every normalized request records the values used.
export const LOGISTIC_MAP_DEFAULTS = Object.freeze({
  precision: Object.freeze({
    backend: "number",
    significant_digits: 16,
  }),
  iteration_cap: 1_000_000,
  transient_limit: 10_000,
  cycle_tolerance: 1e-12,
  cycle_confirmation_returns: 2,
  seed_policy: Object.freeze({ type: "critical_point" }),
});

const parse_r_input = (r) => {
  if (typeof r !== "number" && typeof r !== "string") {
    throw new TypeError("r must be a finite number or decimal string");
  }

  const input_text = String(r).trim();
  if (!input_text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input_text)) {
    throw new TypeError("r must be a finite number or decimal string");
  }

  const represented_value = Number(input_text);
  if (!Number.isFinite(represented_value) || represented_value < 3 || represented_value >= 4) {
    throw new RangeError("r must be in the range 3 <= r < 4");
  }

  return {
    input: input_text,
    represented_value,
    represented_text: String(represented_value),
  };
};

const normalize_positive_integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
};

const normalize_precision = (precision = LOGISTIC_MAP_DEFAULTS.precision) => {
  if (!precision || typeof precision !== "object" || Array.isArray(precision)) {
    throw new TypeError("precision must be an object");
  }
  const backend = precision.backend ?? LOGISTIC_MAP_DEFAULTS.precision.backend;
  if (backend !== "number") {
    throw new RangeError("precision.backend must be 'number' for the initial calculator");
  }

  const significant_digits = precision.significant_digits ??
    LOGISTIC_MAP_DEFAULTS.precision.significant_digits;
  if (significant_digits !== 16) {
    throw new RangeError("the initial number backend uses 16 significant digits");
  }

  return { backend, significant_digits };
};

const normalize_seed_policy = (seed_policy = LOGISTIC_MAP_DEFAULTS.seed_policy) => {
  if (!seed_policy || typeof seed_policy !== "object" || Array.isArray(seed_policy)) {
    throw new TypeError("seed_policy must be an object");
  }

  if (seed_policy.type === "critical_point") {
    return { type: "critical_point", x0: 0.5 };
  }

  if (seed_policy.type === "explicit") {
    const x0 = seed_policy.x0;
    if (typeof x0 !== "number" || !Number.isFinite(x0) || x0 < 0 || x0 > 1) {
      throw new RangeError("explicit seed_policy.x0 must be a finite number in [0, 1]");
    }
    return { type: "explicit", x0 };
  }

  throw new RangeError("seed_policy.type must be 'critical_point' or 'explicit'");
};

/**
 * Validate and normalize the inputs for one logistic-map calculation.
 *
 * `r` accepts a number or decimal string. The original text is retained, and
 * `represented_text` records the exact JavaScript Number value the initial
 * backend will use. The default seed is the reproducible critical point x0=1/2.
 *
 * @param {number|string} r Parameter in `[3, 4)`.
 * @param {{precision?: {backend?: string, significant_digits?: number}, iteration_cap?: number, transient_limit?: number, seed_policy?: {type: string, x0?: number}}} [options]
 * @returns {{contract_version: number, r: {input: string, represented_value: number, represented_text: string}, settings: {precision: {backend: string, significant_digits: number}, iteration_cap: number, transient_limit: number, seed_policy: {type: string, x0: number}}}}
 */
export const normalize_logistic_map_request = (r, options = {}) => {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object");
  }

  const normalized_r = parse_r_input(r);
  const precision = normalize_precision(options.precision);
  const iteration_cap = normalize_positive_integer(
    options.iteration_cap ?? LOGISTIC_MAP_DEFAULTS.iteration_cap,
    "iteration_cap",
  );
  const transient_limit = options.transient_limit ?? LOGISTIC_MAP_DEFAULTS.transient_limit;
  if (!Number.isSafeInteger(transient_limit) || transient_limit < 0 || transient_limit >= iteration_cap) {
    throw new RangeError("transient_limit must be a non-negative safe integer less than iteration_cap");
  }
  const cycle_tolerance = options.cycle_tolerance ?? LOGISTIC_MAP_DEFAULTS.cycle_tolerance;
  if (typeof cycle_tolerance !== "number" || !Number.isFinite(cycle_tolerance) ||
    cycle_tolerance < Number.EPSILON || cycle_tolerance >= 1) {
    throw new RangeError("cycle_tolerance must be a finite number in [Number.EPSILON, 1)");
  }
  const cycle_confirmation_returns = normalize_positive_integer(
    options.cycle_confirmation_returns ?? LOGISTIC_MAP_DEFAULTS.cycle_confirmation_returns,
    "cycle_confirmation_returns",
  );

  return {
    contract_version: LOGISTIC_MAP_CONTRACT_VERSION,
    r: normalized_r,
    settings: {
      precision,
      iteration_cap,
      transient_limit,
      cycle_tolerance,
      cycle_confirmation_returns,
      seed_policy: normalize_seed_policy(options.seed_policy),
    },
  };
};

/**
 * Attach the normalized parameter and settings to a calculation result.
 * Calculation payload fields are supplied by the future orbit calculator.
 *
 * @param {ReturnType<typeof normalize_logistic_map_request>} request Normalized request.
 * @param {object} calculation_result Result fields from the calculator.
 * @returns {object} Versioned result with complete calculation provenance.
 */
export const create_logistic_map_result = (request, calculation_result) => {
  if (!request || request.contract_version !== LOGISTIC_MAP_CONTRACT_VERSION) {
    throw new TypeError("request must be a normalized logistic-map request");
  }
  if (!calculation_result || typeof calculation_result !== "object" || Array.isArray(calculation_result)) {
    throw new TypeError("calculation_result must be an object");
  }

  return {
    ...calculation_result,
    contract_version: LOGISTIC_MAP_CONTRACT_VERSION,
    r: { ...request.r },
    settings: {
      ...request.settings,
      precision: { ...request.settings.precision },
      seed_policy: { ...request.settings.seed_policy },
    },
  };
};
