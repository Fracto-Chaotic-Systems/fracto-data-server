import {
  create_logistic_map_result,
  normalize_logistic_map_request,
} from "./calculation_contract.js";

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

const is_primitive_period = (r, start, period, tolerance) => {
  // If a period p is an integer multiple of a smaller period q, then p/q has
  // a prime factor s and q divides p/s. Testing p/s for each distinct prime
  // factor of p therefore detects every possible proper fundamental period.
  for (const factor of prime_factors(period)) {
    const possible_divisor = period / factor;
    if (Math.abs(iterate(r, start, possible_divisor) - start) <= tolerance) {
      return false;
    }
  }
  return true;
};

const find_prior_state = (history, values, value, tolerance) => {
  const bucket = Math.round(value / tolerance);
  let closest = null;
  for (let offset = -1; offset <= 1; offset += 1) {
    const previous_index = history.get(bucket + offset);
    if (previous_index === undefined) continue;
    const difference = Math.abs(values[previous_index] - value);
    if (difference <= tolerance && (!closest || difference < closest.difference)) {
      closest = { index: previous_index, difference };
    }
  }
  return closest;
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

const create_invalid_input_result = (r, error) => ({
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
});

/**
 * Compute a bounded orbit sample for one logistic-map parameter.
 *
 * This standalone calculation has no HTTP or persistence dependencies. It
 * retains x_n beginning at the transient boundary and ending at the configured
 * iteration cap, inclusive. Thus a zero transient includes x_0, and the result
 * always contains at least one sample because transient_limit must be below
 * iteration_cap.
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
  let request;
  try {
    request = normalize_logistic_map_request(r, options);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return create_invalid_input_result(r, error);
    }
    throw error;
  }
  const {
    cycle_tolerance,
    cycle_confirmation_returns,
    iteration_cap,
    transient_limit,
    seed_policy,
  } = request.settings;
  const r_value = request.r.represented_value;
  let x = seed_policy.x0;
  const values = [];
  const history = new Map();
  let cycle = null;
  let rejected_candidate_count = 0;
  let pending_candidate = null;
  let iterations_attempted = 0;
  let iterations_completed = 0;
  let numerical_failure = null;

  if (transient_limit === 0) {
    values.push(x);
    history.set(Math.round(x / cycle_tolerance), 0);
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
    if (iteration >= transient_limit) {
      values.push(x);
      const current_index = values.length - 1;
      if (pending_candidate &&
        iteration - pending_candidate.last_confirmation_iteration >= pending_candidate.period) {
        const difference = Math.abs(x - pending_candidate.start_value);
        pending_candidate.last_confirmation_iteration = iteration;
        if (difference <= cycle_tolerance) {
          pending_candidate.confirmation_returns += 1;
          if (pending_candidate.confirmation_returns >= cycle_confirmation_returns) {
            const period = pending_candidate.period;
            const candidate_start_index = current_index - period;
            const candidate_start_value = values[candidate_start_index];
            const return_residual = Math.abs(
              iterate(r_value, candidate_start_value, period) - candidate_start_value,
            );
            const primitive = return_residual <= cycle_tolerance &&
              is_primitive_period(r_value, candidate_start_value, period, cycle_tolerance);

            if (primitive) {
              cycle = {
                start_iteration: transient_limit + candidate_start_index,
                period,
                points: values.slice(candidate_start_index, current_index),
                return_residual,
                primitive: true,
                confirmation_returns: pending_candidate.confirmation_returns,
                validation_scope: "finite_precision",
                mathematical_proof: false,
              };
              break;
            }
            rejected_candidate_count += 1;
            pending_candidate = null;
          }
        } else {
          rejected_candidate_count += 1;
          pending_candidate = null;
        }
      }

      if (!pending_candidate) {
        const previous = find_prior_state(history, values, x, cycle_tolerance);
        if (previous) {
          const period = current_index - previous.index;
          const start_value = values[previous.index];
          const return_residual = Math.abs(iterate(r_value, start_value, period) - start_value);
          if (return_residual <= cycle_tolerance) {
            pending_candidate = {
              start_value,
              period,
              last_confirmation_iteration: iteration,
              confirmation_returns: 0,
            };
          } else {
            rejected_candidate_count += 1;
          }
        }
      }
      history.set(Math.round(x / cycle_tolerance), current_index);
    }
  }

  const completed_state_iteration = values.length > 0
    ? transient_limit + values.length - 1
    : null;
  const status = numerical_failure
    ? "numerical_failure"
    : cycle
      ? "cycle_candidate"
      : "sampled_unresolved";
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
      start_iteration: transient_limit,
      end_iteration: completed_state_iteration,
      values,
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
    },
  });
  return result;
};
