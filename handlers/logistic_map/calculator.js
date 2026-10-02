import { performance } from "node:perf_hooks";
import {
  create_logistic_map_result,
  normalize_logistic_map_request,
} from "./calculation_contract.js";

export const LOGISTIC_MAP_CHECKPOINT_INTERVAL = 100_000;
export const LOGISTIC_MAP_SAMPLE_SIZE = 10_000;
export const LOGISTIC_MAP_PROGRESS_INTERVAL = 10_000_000;

const iterate = (r, x, count) => {
  for (let iteration = 0; iteration < count; iteration += 1) {
    x = r * x * (1 - x);
  }
  return x;
};

const prime_factors = (value) => {
  const factors = [];
  let remaining = value;
  for (let factor = 2; factor * factor <= remaining; factor += 1) {
    if (remaining % factor !== 0) continue;
    factors.push(factor);
    while (remaining % factor === 0) remaining /= factor;
  }
  if (remaining > 1) factors.push(remaining);
  return factors;
};

const is_primitive_period = (r, start, period) => {
  // If a period p is an integer multiple of a smaller period q, then p/q has
  // a prime factor s and q divides p/s. Testing p/s for each distinct prime
  // factor of p therefore detects every possible proper fundamental period.
  for (const factor of prime_factors(period)) {
    const possible_divisor = period / factor;
    if (iterate(r, start, possible_divisor) === start) {
      return false;
    }
  }
  return true;
};

const describe_invalid_parameter = (r) => {
  if (typeof r !== "number" && typeof r !== "string") return null;
  const input = String(r).trim().slice(0, 128);
  const represented_value = Number(input);
  return {
    input,
    represented_value: Number.isFinite(represented_value) ? represented_value : null,
    represented_text: Number.isFinite(represented_value) ? String(represented_value) : null,
  };
};

const round_milliseconds = (value) => Math.round(value * 1_000) / 1_000;

const create_invalid_input_result = (r, error, timing) => ({
  contract_version: 1,
  status: "invalid_input",
  reason: {
    code: "invalid_calculation_request",
    message: error.message,
  },
  r: describe_invalid_parameter(r),
  settings: null,
  seed: null,
  iteration_counts: {
    iteration_cap: null,
    iterations_attempted: 0,
    iterations_completed: 0,
    transient_iterations_discarded: 0,
    retained_sample_count: 0,
  },
  sample: { start_iteration: null, end_iteration: null, values: [] },
  cycle: null,
  cycle_detection: null,
  timing,
});

/**
 * Compute a bounded orbit sample for one logistic-map parameter.
 *
 * This standalone calculation has no HTTP or persistence dependencies. Exact
 * state repeats are searched with a single checkpoint that advances every
 * LOGISTIC_MAP_CHECKPOINT_INTERVAL iterations. Optional result samples retain
 * only their latest bounded window; callers doing diagnostics can disable
 * sample retention entirely.
 *
 * A repeated state is only a candidate under the selected precision and
 * tolerance. Candidates must pass an independently replayed return-residual
 * check and a proper-divisor check. These numerical checks do not prove an
 * exact real-valued cycle; increased-precision confirmation is a later stage.
 *
 * @param {number|string} r Logistic-map parameter in [3, 4).
 * @param {object} [options] Calculation settings accepted by
 *   `normalize_logistic_map_request`.
 * @returns {object} Versioned result envelope and bounded orbit sample.
 */
export const calculate_logistic_orbit = (r, options = {}) => {
  const total_started_at = performance.now();
  let request;
  try {
    request = normalize_logistic_map_request(r, options);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      const total_ms = round_milliseconds(performance.now() - total_started_at);
      return create_invalid_input_result(r, error, {
        validation_ms: total_ms,
        calculation_ms: 0,
        total_ms,
        iterations_per_second: null,
      });
    }
    throw error;
  }
  const calculation_started_at = performance.now();
  const validation_ms = round_milliseconds(calculation_started_at - total_started_at);
  const {
    cycle_tolerance,
    cycle_confirmation_returns,
    iteration_cap,
    transient_limit,
    seed_policy,
  } = request.settings;
  const r_value = request.r.represented_value;
  const retain_sample = options.retain_sample !== false;
  let x = seed_policy.x0;
  const values = [];
  let checkpoint = null;
  let cycle = null;
  let rejected_candidate_count = 0;
  let iterations_attempted = 0;
  let iterations_completed = 0;
  let numerical_failure = null;

  if (transient_limit === 0) {
    checkpoint = { iteration: 0, value: x };
    if (retain_sample) values.push({ iteration: 0, value: x });
  }

  for (let iteration = 1; iteration <= iteration_cap; iteration += 1) {
    iterations_attempted = iteration;
    x = r_value * x * (1 - x);
    if (!Number.isFinite(x) || x < 0 || x > 1) {
      numerical_failure = {
        code: "state_out_of_domain",
        message: "The computed state was non-finite or outside [0, 1]",
      };
      break;
    }
    iterations_completed = iteration;
    if (iteration % LOGISTIC_MAP_PROGRESS_INTERVAL === 0) {
      options.on_progress?.({ iterations_completed: iteration });
    }
    if (iteration >= transient_limit) {
      if (!checkpoint) {
        checkpoint = { iteration, value: x };
      } else {
        const elapsed_from_checkpoint = iteration - checkpoint.iteration;
        if (x === checkpoint.value) {
          const period = elapsed_from_checkpoint;
          const return_residual = Math.abs(iterate(r_value, checkpoint.value, period) - checkpoint.value);
          let confirmation_returns = 0;
          let confirmation_state = checkpoint.value;
          for (let confirmation = 0; confirmation < cycle_confirmation_returns; confirmation += 1) {
            confirmation_state = iterate(r_value, confirmation_state, period);
            if (confirmation_state !== checkpoint.value) break;
            confirmation_returns += 1;
          }
          const primitive = is_primitive_period(r_value, checkpoint.value, period);
          if (return_residual <= cycle_tolerance &&
              confirmation_returns >= cycle_confirmation_returns && primitive) {
            const points = [];
            let cycle_state = checkpoint.value;
            for (let point = 0; point < period; point += 1) {
              points.push(cycle_state);
              cycle_state = r_value * cycle_state * (1 - cycle_state);
            }
            cycle = {
              start_iteration: checkpoint.iteration,
              period,
              points,
              return_residual,
              primitive: true,
              confirmation_returns,
              validation_scope: "finite_precision",
              mathematical_proof: false,
            };
          } else {
            rejected_candidate_count += 1;
            checkpoint = { iteration, value: x };
          }
        } else if (elapsed_from_checkpoint >= LOGISTIC_MAP_CHECKPOINT_INTERVAL) {
          checkpoint = { iteration, value: x };
        }
      }

      if (retain_sample) {
        if (values.length >= LOGISTIC_MAP_SAMPLE_SIZE) values.shift();
        values.push({ iteration, value: x });
      }
      if (cycle) break;
    }
  }

  const sample_start_iteration = values[0]?.iteration ?? null;
  const completed_state_iteration = values.at(-1)?.iteration ?? null;
  const status = numerical_failure
    ? "numerical_failure"
    : cycle
      ? "cycle_candidate"
      : "sampled_unresolved";
  const completed_at = performance.now();
  const calculation_ms = round_milliseconds(completed_at - calculation_started_at);
  const total_ms = round_milliseconds(completed_at - total_started_at);
  const result = create_logistic_map_result(request, {
    status,
    reason: numerical_failure || (cycle ? null : {
      code: "iteration_cap_reached",
      message: "The iteration cap was reached without a validated cycle candidate",
    }),
    seed: { ...seed_policy },
    iterations_completed,
    iteration_counts: {
      iteration_cap,
      iterations_attempted,
      iterations_completed,
      transient_iterations_discarded: Math.min(transient_limit, iterations_completed),
      retained_sample_count: values.length,
    },
    sample: {
      start_iteration: sample_start_iteration,
      end_iteration: completed_state_iteration,
      values: values.map((state) => state.value),
    },
    cycle: numerical_failure ? null : cycle,
    cycle_detection: {
      status: numerical_failure
        ? "aborted_numerical_failure"
        : cycle
          ? "candidate_found"
          : "no_candidate_found",
      tolerance: cycle_tolerance,
      required_confirmation_returns: cycle_confirmation_returns,
      evidence_scope: "finite_precision_only",
      rejected_candidate_count,
      match_mode: "exact_checkpoint",
      checkpoint_interval: LOGISTIC_MAP_CHECKPOINT_INTERVAL,
    },
    timing: {
      validation_ms,
      calculation_ms,
      total_ms,
      iterations_per_second: calculation_ms > 0
        ? Math.round(iterations_completed / (calculation_ms / 1_000))
        : null,
    },
  });
  return result;
};
