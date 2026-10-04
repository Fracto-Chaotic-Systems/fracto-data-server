import FractoUtil from "@fracto/sdk/FractoUtil.js";
import { newton_big_complex_experimental } from "./newton_big_complex_experimental.js";
import { run_newton_coarse_sweep } from "./newton_coarse_sweep.js";

const DEFAULT_MAX_CARDINALITY = 2048;

const greatest_common_divisor = (left, right) => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
};

/**
 * Find the nearest rational turn fraction whose denominator is below the
 * configured maximum orbital cardinality. Enumerating bounded denominators
 * finds the nearest candidate over the complete allowed domain; gcd reduction
 * ensures the returned integer pair is in lowest terms.
 *
 * @param {number} theta Turn fraction in [0, 1/2].
 * @param {number} [max_cardinality=2048] Exclusive upper bound for denominator.
 * @returns {{numerator:number,denominator:number,value:number,error:number,
 *   max_denominator:number}} Reduced rational approximation and diagnostics.
 */
export const approximate_theta_rational = (
  theta,
  max_cardinality = DEFAULT_MAX_CARDINALITY,
) => {
  if (!Number.isFinite(theta) || theta < 0 || theta > 0.5) {
    throw new RangeError("theta must be a finite number in [0, 1/2]");
  }
  if (!Number.isInteger(max_cardinality) || max_cardinality < 2) {
    throw new RangeError("max_cardinality must be an integer of at least 2");
  }

  const max_denominator = max_cardinality - 1;
  let best_numerator = 0;
  let best_denominator = 1;
  let best_error = Math.abs(theta);
  for (let denominator = 1; denominator <= max_denominator; denominator += 1) {
    const numerator = Math.round(theta * denominator);
    const error = Math.abs(theta - numerator / denominator);
    if (error < best_error) {
      best_numerator = numerator;
      best_denominator = denominator;
      best_error = error;
    }
  }

  const divisor = greatest_common_divisor(best_numerator, best_denominator) || 1;
  const numerator = best_numerator / divisor;
  const denominator = best_denominator / divisor;
  const value = numerator / denominator;
  return {
    numerator,
    denominator,
    value,
    error: Math.abs(theta - value),
    max_denominator,
  };
};

/**
 * Investigate a result that appears to have a two-point orbital. Convert the
 * focal parameter to multiplier coordinates and approximate theta by a
 * reduced rational. The established orbital points remain unchanged.
 *
 * @param {{re:number|string,im:number|string}} focal_point Mandelbrot parameter.
 * @param {Array<{re:number,im:number}>} points Ordered two-point orbital.
 * @param {{max_cardinality?:number}} [options] Search bound.
 * @returns {{points:Array<{re:number,im:number}>,parameterization:object}}
 *   Existing points and investigation metadata.
 * @throws {RangeError} If the input does not contain exactly two points.
 */
export const investigate_two_point_orbit = (
  focal_point,
  points,
  options = {},
) => {
  if (!Array.isArray(points) || points.length !== 2) {
    throw new RangeError("Two-point orbital investigation requires 2 points");
  }
  const max_cardinality = options.max_cardinality ?? DEFAULT_MAX_CARDINALITY;
  const numeric_point = {
    x: Number(focal_point?.re),
    y: Number(focal_point?.im),
  };
  let coordinates;
  try {
    coordinates = FractoUtil.P_to_r_theta(numeric_point);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return {
      points,
      parameterization: {
        status: "outside_main_cardioid",
        r: null,
        theta: null,
        theta_rational: null,
        max_cardinality,
      },
    };
  }
  const { r, theta } = coordinates;
  const theta_rational = approximate_theta_rational(theta, max_cardinality);
  const newton_result = newton_big_complex_experimental(
    { x: Number(focal_point.re), y: Number(focal_point.im) },
    options.newton_limit,
    theta_rational.denominator,
    options.newton_early_exit,
  );
  const newton_sweep_experiment = options.newton_sweep_experiment
    ? run_newton_coarse_sweep(
        { x: Number(focal_point.re), y: Number(focal_point.im) },
        {
          max_cardinality: options.newton_sweep_max_cardinality,
          coarse_iterations: options.newton_sweep_coarse_iterations,
          candidate_count: options.newton_sweep_candidate_count,
          refinement_iterations: options.newton_sweep_refinement_iterations,
          include_cardinalities: [theta_rational.denominator],
        },
      )
    : undefined;
  return {
    points,
    parameterization: {
      status: "available",
      r,
      theta,
      theta_rational,
      max_cardinality,
    },
    newton_experiment: {
      candidate_cardinality: theta_rational.denominator,
      mode: "experimental_big_complex",
      result: newton_result,
    },
    ...(newton_sweep_experiment
      ? { newton_sweep_experiment }
      : {}),
  };
};
