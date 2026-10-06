import { performance } from "node:perf_hooks";
import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
import { refine_orbital_points } from "./newton_refinement.js";

const get_point_extent_upper_bound = (points = []) => {
  if (!points.length) return null;
  const bounds = points.reduce(
    (result, point) => ({
      min_x: Math.min(result.min_x, point.x),
      max_x: Math.max(result.max_x, point.x),
      min_y: Math.min(result.min_y, point.y),
      max_y: Math.max(result.max_y, point.y),
    }),
    {
      min_x: Number.POSITIVE_INFINITY,
      max_x: Number.NEGATIVE_INFINITY,
      min_y: Number.POSITIVE_INFINITY,
      max_y: Number.NEGATIVE_INFINITY,
    },
  );
  return Math.hypot(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
};

/**
 * Main-cardioid fallback for a detector result with candidate cardinality 2.
 * FractoFastCalc's finite-precision pattern supplies the Newton candidate;
 * its critically iterated points are not used as the refined orbit.
 *
 * @param {{re:number,im:number}} focal_point Mandelbrot parameter.
 * @param {{newton_limit?:number}} [options] Newton effort controls.
 * @returns {{status:string,points?:Array<object>,cardinality?:number,
 *   diagnostics:object}} Experimental output and comparison diagnostics.
 */
export const run_two_point_calc_newton_fallback = (
  focal_point,
  options = {},
) => {
  const calc_started = performance.now();
  // FractoFastCalc performs ordinary numeric arithmetic. In particular, a
  // string coordinate can change its calculation through JavaScript's `+`
  // coercion rules, producing a spurious cardinality (often 1). Keep the
  // caller's original coordinates for Newton, but normalize the calculator
  // inputs explicitly.
  const calculation = FractoFastCalc.calc(
    Number(focal_point.re),
    Number(focal_point.im),
  );
  const calc_elapsed_ms = performance.now() - calc_started;
  const cardinality = Number(calculation?.pattern);
  const calc_points = calculation?.orbital_points || [];
  const diagnostics = {
    detector_cardinality: 2,
    calc_cardinality: Number.isInteger(cardinality) ? cardinality : null,
    calc_iteration: Number.isFinite(calculation?.iteration)
      ? calculation.iteration
      : null,
    calc_estimated: Boolean(calculation?.estimated),
    calc_point_count: calc_points.length,
    calc_point_extent_upper_bound: get_point_extent_upper_bound(calc_points),
    calc_elapsed_ms,
  };

  if (!Number.isInteger(cardinality) || cardinality < 1) {
    return {
      status: "no_calc_cardinality",
      diagnostics,
    };
  }

  const newton_started = performance.now();
  const refinement = refine_orbital_points(focal_point, cardinality, {
    newton_mode: "big_complex",
    newton_limit: options.newton_limit,
    cardinality_source: "fracto_fast_calc_two_point_fallback",
  });
  const newton_result = refinement.newton_big_complex;
  const points = (newton_result?.point_list || []).map((point) => ({
    re: Number(point.re),
    im: Number(point.im),
  }));
  diagnostics.newton_elapsed_ms = performance.now() - newton_started;
  diagnostics.newton_cardinality = Number.isInteger(newton_result?.cardinality)
    ? newton_result.cardinality
    : null;
  diagnostics.newton_point_count = points.length;
  diagnostics.newton_least_magnitude = Number.isFinite(
    Number(newton_result?.least_magnitude),
  )
    ? String(newton_result.least_magnitude)
    : null;
  diagnostics.newton_cardinality_matches_calc =
    diagnostics.newton_cardinality === cardinality &&
    points.length === cardinality;

  if (
    !diagnostics.newton_cardinality_matches_calc ||
    points.some(
      (point) =>
        !Number.isFinite(point.re) || !Number.isFinite(point.im),
    )
  ) {
    return {
      status: "newton_cardinality_mismatch",
      diagnostics,
    };
  }

  return {
    status: "newton_points_available",
    points,
    cardinality,
    diagnostics,
  };
};
