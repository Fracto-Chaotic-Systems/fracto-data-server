import BigComplex from "@fracto/sdk/math/BigComplex.js";

const DEFAULT_GROWTH_FACTOR = 4;
const DEFAULT_GROWTH_PATIENCE = 2;
const DEFAULT_STAGNATION_PATIENCE = 3;
const MIN_EARLY_EXIT_STEP = 1e-10;

const build_orbit_points = (seed, parameter, cardinality) => {
  const points = [];
  let current = new BigComplex(seed.re, seed.im, seed.precision);
  for (let index = 0; index < cardinality; index += 1) {
    current = current.mul(current).add(parameter);
    points.push(new BigComplex(current.re, current.im, current.precision));
  }
  return points;
};

/**
 * Experimental BigComplex Newton solver with guarded early exits.
 *
 * This is intentionally separate from `newton_big_complex.js`: only the
 * orbital-2 investigation calls it. A stopped result is diagnostic evidence,
 * not a rejected mathematical orbit. The best point found so far is retained.
 *
 * @param {{x:number|string,y:number|string}} point Mandelbrot parameter.
 * @param {number} limit Maximum Newton iterations.
 * @param {number} cardinality Candidate period supplied by the experiment.
 * @param {{growth_factor?:number,growth_patience?:number,
 *   stagnation_patience?:number}} [options] Experimental guards.
 * @returns {object} Best candidate, step history, and exit diagnostics.
 */
export const newton_big_complex_experimental = (
  point,
  limit,
  cardinality,
  options = {},
) => {
  const N = Math.max(1, Math.floor(Number(cardinality)));
  const max_iterations = Math.max(1, Math.floor(Number(limit) || 5));
  const growth_factor = Math.max(
    1.1,
    Number(options.growth_factor) || DEFAULT_GROWTH_FACTOR,
  );
  const growth_patience = Math.max(
    1,
    Math.floor(Number(options.growth_patience) || DEFAULT_GROWTH_PATIENCE),
  );
  const stagnation_patience = Math.max(
    1,
    Math.floor(
      Number(options.stagnation_patience) || DEFAULT_STAGNATION_PATIENCE,
    ),
  );
  const parameter = new BigComplex(point.x, point.y);
  const started_at = performance.now();
  const step_history = [];
  let best_step = Infinity;
  let best_point_list = [];
  let best_iteration = 0;
  let previous_step = null;
  let growth_count = 0;
  let stagnation_count = 0;
  let exit_reason = "iteration_limit";
  let status = "iteration_limit";
  let completed_iterations = 0;
  let seed = new BigComplex(0, 0);

  for (let iteration = 1; iteration <= max_iterations; iteration += 1) {
    let current = new BigComplex(seed.re, seed.im, seed.precision);
    let derivative = new BigComplex(1, 0);
    for (let index = 0; index < N; index += 1) {
      derivative = derivative.mul(current.scale(2));
      current = current.mul(current).add(parameter);
    }
    const residual = current.add(seed.scale(-1));
    const derivative_residual = derivative.offset(-1, 0);
    const denominator =
      derivative_residual.re * derivative_residual.re +
      derivative_residual.im * derivative_residual.im;

    if (!Number.isFinite(denominator) || denominator === 0) {
      status = "numerical_failure";
      exit_reason = "invalid_newton_denominator";
      break;
    }

    const step = new BigComplex(
      (residual.re * derivative_residual.re +
        residual.im * derivative_residual.im) /
        denominator,
      (residual.im * derivative_residual.re -
        residual.re * derivative_residual.im) /
        denominator,
    );
    const step_magnitude = step.magnitude();
    const step_value = Number(step_magnitude.toString());
    if (!Number.isFinite(step_value)) {
      status = "numerical_failure";
      exit_reason = "non_finite_newton_step";
      break;
    }

    step_history.push(step_value);
    completed_iterations = iteration;
    if (step_value === 0) {
      seed = seed.add(step.scale(-1));
      best_step = 0;
      best_iteration = iteration;
      best_point_list = build_orbit_points(seed, parameter, N);
      status = "zero_step_candidate";
      exit_reason = "zero_newton_step";
      break;
    }

    const negative_step = step.scale(-1);
    const next_seed = seed.add(negative_step);
    const improved_best_step = step_value < best_step;
    if (improved_best_step) {
      best_step = step_value;
      best_iteration = iteration;
      best_point_list = build_orbit_points(next_seed, parameter, N);
    }

    if (
      previous_step !== null &&
      step_value >= previous_step * growth_factor &&
      step_value >= MIN_EARLY_EXIT_STEP
    ) {
      growth_count += 1;
    } else {
      growth_count = 0;
    }
    if (!improved_best_step) {
      stagnation_count += 1;
    } else {
      stagnation_count = 0;
    }
    previous_step = step_value;
    seed = next_seed;

    if (growth_count >= growth_patience) {
      status = "diverging";
      exit_reason = "newton_step_growth";
      break;
    }
    if (
      iteration >= 2 &&
      stagnation_count >= stagnation_patience &&
      best_step >= MIN_EARLY_EXIT_STEP
    ) {
      status = "stagnated";
      exit_reason = "no_step_improvement";
      break;
    }
  }

  return {
    point_list: best_point_list,
    cardinality: N,
    cycles: completed_iterations,
    time: `${performance.now() - started_at}ms`,
    least_magnitude: best_step,
    least_magnitude_N: best_step === Infinity ? 0 : N,
    cardinality_supplied: true,
    status,
    diagnostics: {
      mode: "experimental_big_complex",
      supplied_cardinality: N,
      precision_digits: 64,
      least_newton_step: String(best_step),
      iterations_used: completed_iterations,
      iteration_limit: max_iterations,
      exit_reason,
      step_history,
      early_exit: status !== "iteration_limit" && status !== "zero_step_candidate",
      best_iteration,
      thresholds: {
        growth_factor,
        growth_patience,
        stagnation_patience,
        minimum_early_exit_step: MIN_EARLY_EXIT_STEP,
      },
    },
  };
};
