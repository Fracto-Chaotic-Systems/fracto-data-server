import { performance } from "node:perf_hooks";
import { newton_big_complex_experimental } from "./newton_big_complex_experimental.js";

const MAX_CARDINALITY = 2048;
const DEFAULT_ITERATIONS = 6;
const DEFAULT_SHORTLIST_SIZE = 5;
const DEFAULT_REFINEMENT_ITERATIONS = 8;
const MAX_SHORTLIST_SIZE = 12;

const bounded_integer = (value, fallback, minimum, maximum) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
};

const coarse_newton_candidate = (point, cardinality, iteration_limit) => {
  let seed_re = 0;
  let seed_im = 0;
  let best_step = Infinity;
  let cycles = 0;
  let status = "iteration_limit";

  for (let iteration = 1; iteration <= iteration_limit; iteration += 1) {
    let current_re = seed_re;
    let current_im = seed_im;
    let derivative_re = 1;
    let derivative_im = 0;
    let valid = true;

    for (let index = 0; index < cardinality; index += 1) {
      const next_derivative_re =
        derivative_re * (2 * current_re) - derivative_im * (2 * current_im);
      const next_derivative_im =
        derivative_re * (2 * current_im) + derivative_im * (2 * current_re);
      const next_current_re =
        current_re * current_re - current_im * current_im + point.x;
      const next_current_im = 2 * current_re * current_im + point.y;
      current_re = next_current_re;
      current_im = next_current_im;
      derivative_re = next_derivative_re;
      derivative_im = next_derivative_im;
      if (
        !Number.isFinite(current_re) ||
        !Number.isFinite(current_im) ||
        !Number.isFinite(derivative_re) ||
        !Number.isFinite(derivative_im)
      ) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      status = "numerical_failure";
      break;
    }

    const residual_re = current_re - seed_re;
    const residual_im = current_im - seed_im;
    const derivative_residual_re = derivative_re - 1;
    const derivative_residual_im = derivative_im;
    const denominator =
      derivative_residual_re * derivative_residual_re +
      derivative_residual_im * derivative_residual_im;
    if (!Number.isFinite(denominator) || denominator === 0) {
      status = "numerical_failure";
      break;
    }

    const step_re =
      (residual_re * derivative_residual_re +
        residual_im * derivative_residual_im) /
      denominator;
    const step_im =
      (residual_im * derivative_residual_re -
        residual_re * derivative_residual_im) /
      denominator;
    const step_magnitude = Math.hypot(step_re, step_im);
    if (!Number.isFinite(step_magnitude)) {
      status = "numerical_failure";
      break;
    }

    cycles = iteration;
    best_step = Math.min(best_step, step_magnitude);
    if (step_magnitude === 0) {
      status = "zero_step_candidate";
      break;
    }
    seed_re -= step_re;
    seed_im -= step_im;
  }

  return { cardinality, best_step, cycles, status };
};

/**
 * Rank candidate periods with native-number arithmetic, then rerun a bounded
 * shortlist through the isolated BigComplex early-exit solver. The ranking is
 * a screening heuristic only; it does not certify a primitive or attracting
 * orbit.
 *
 * @param {{x:number,y:number}} point Parameter to test.
 * @param {{max_cardinality?:number,coarse_iterations?:number,
 *   candidate_count?:number,refinement_iterations?:number,
 *   include_cardinalities?:number[]}} [options] Bounded experiment settings.
 * @returns {object} Coarse ranking and high-precision shortlist diagnostics.
 */
export const run_newton_coarse_sweep = (point, options = {}) => {
  const max_cardinality = bounded_integer(
    options.max_cardinality,
    MAX_CARDINALITY,
    2,
    MAX_CARDINALITY,
  );
  const coarse_iterations = bounded_integer(
    options.coarse_iterations,
    DEFAULT_ITERATIONS,
    1,
    64,
  );
  const candidate_count = bounded_integer(
    options.candidate_count,
    DEFAULT_SHORTLIST_SIZE,
    1,
    MAX_SHORTLIST_SIZE,
  );
  const refinement_iterations = bounded_integer(
    options.refinement_iterations,
    DEFAULT_REFINEMENT_ITERATIONS,
    1,
    64,
  );
  const coarse_started_at = performance.now();
  const ranked = [];
  for (let cardinality = 1; cardinality <= max_cardinality; cardinality += 1) {
    const candidate = coarse_newton_candidate(
      point,
      cardinality,
      coarse_iterations,
    );
    if (Number.isFinite(candidate.best_step)) ranked.push(candidate);
  }
  ranked.sort((left, right) => {
    const left_zero = left.status === "zero_step_candidate";
    const right_zero = right.status === "zero_step_candidate";
    if (left_zero !== right_zero) return left_zero ? -1 : 1;
    if (left_zero && left.cycles !== right.cycles) {
      return left.cycles - right.cycles;
    }
    return left.best_step - right.best_step || left.cardinality - right.cardinality;
  });
  const coarse_elapsed_ms = performance.now() - coarse_started_at;

  const shortlist = ranked.slice(0, candidate_count);
  for (const cardinality of options.include_cardinalities || []) {
    if (
      Number.isInteger(cardinality) &&
      cardinality >= 1 &&
      cardinality <= max_cardinality &&
      !shortlist.some((candidate) => candidate.cardinality === cardinality)
    ) {
      const candidate = ranked.find((entry) => entry.cardinality === cardinality);
      if (candidate) shortlist.push(candidate);
    }
  }

  const refinement_started_at = performance.now();
  const refined = shortlist.map((candidate) => {
    const result = newton_big_complex_experimental(
      point,
      refinement_iterations,
      candidate.cardinality,
    );
    return {
      cardinality: candidate.cardinality,
      coarse_best_step: candidate.best_step,
      coarse_cycles: candidate.cycles,
      coarse_status: candidate.status,
      high_precision_status: result.status,
      high_precision_best_step: result.least_magnitude,
      high_precision_cycles: result.cycles,
      high_precision_exit_reason: result.diagnostics.exit_reason,
      point_count: result.point_list.length,
      result,
    };
  });
  refined.sort(
    (left, right) =>
      left.high_precision_best_step - right.high_precision_best_step,
  );

  return {
    mode: "experimental_coarse_then_big_complex_sweep",
    status: refined.length ? "completed" : "no_finite_candidates",
    settings: {
      max_cardinality,
      coarse_precision: "javascript_number",
      coarse_iterations,
      shortlist_size: candidate_count,
      refinement_precision_digits: 64,
      refinement_iterations,
      included_cardinalities: options.include_cardinalities || [],
    },
    timings: {
      coarse_ms: coarse_elapsed_ms,
      refinement_ms: performance.now() - refinement_started_at,
      total_ms: performance.now() - coarse_started_at,
    },
    coarse_summary: {
      candidates_tested: max_cardinality,
      finite_candidates: ranked.length,
      zero_step_count: ranked.filter(
        (candidate) => candidate.status === "zero_step_candidate",
      ).length,
      numerical_failure_count: max_cardinality - ranked.length,
      zero_step_cardinalities: ranked
        .filter((candidate) => candidate.status === "zero_step_candidate")
        .map((candidate) => candidate.cardinality)
        .sort((left, right) => left - right),
      zero_step_by_iteration: Object.fromEntries(
        [...
          ranked
            .filter((candidate) => candidate.status === "zero_step_candidate")
            .reduce((counts, candidate) => {
              counts.set(candidate.cycles, (counts.get(candidate.cycles) || 0) + 1);
              return counts;
            }, new Map()),
        ].sort(([left], [right]) => left - right),
      ),
    },
    coarse_candidates: ranked.slice(0, candidate_count).map((candidate) => ({
      cardinality: candidate.cardinality,
      best_step: candidate.best_step,
      cycles: candidate.cycles,
      status: candidate.status,
    })),
    refined_candidates: refined,
    warning:
      "Newton-step ranking is a screening heuristic; validate closure, primitive period, and stability before interpreting an orbital.",
  };
};
