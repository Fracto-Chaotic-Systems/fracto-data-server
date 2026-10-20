import { discover_and_newton } from "./orbitals/detector_newton.js";
import FractoUtil from "@fracto/sdk/FractoUtil.js";
import { run_two_point_calc_newton_fallback } from "./orbitals/two_point_calc_newton_fallback.js";
import { newton_derived } from "@fracto/sdk/orbitals/FractoNewtonDerived.js";
import { newton_big_complex } from "@fracto/sdk/orbitals/FractoNewtonBigComplex.js";
import { performance } from "node:perf_hooks";

const is_truthy = (value) =>
  ["1", "true", "yes"].includes(String(value).toLowerCase());
const ADAPTIVE_MAX_ITERATIONS = 262144;

const summarize_detection = (detection) =>
  detection
    ? {
        status: detection.status,
        candidate_cardinality: detection.candidate_cardinality ?? null,
        ambiguous: detection.ambiguous ?? null,
      }
    : null;

const summarize_newton = (newton) =>
  newton
    ? {
        status: newton.status,
        closure_reached: newton.closure_reached,
        closure_error: newton.closure_error,
        closure_tolerance: newton.closure_tolerance,
        candidate_cardinality: newton.candidate_cardinality,
        cardinality: newton.closure_reached === true ? newton.cardinality : 0,
        point_list: newton.closure_reached === true ? newton.point_list : [],
        cycles: newton.cycles,
        time: newton.time,
        cardinality_supplied: newton.cardinality_supplied,
      }
    : null;

/**
 * Keep the orbital endpoint response to fields used by the UI. Detailed
 * minima, alternative candidates, pyramid layers, and solver diagnostics are
 * available from direct SDK calls when diagnostic inspection is needed.
 * @param {object} result Full detector/Newton result.
 * @returns {object} Compact API result.
 */
export const summarize_orbital_newton_response = (result) => {
  if (!result?.detection) return result;
  const fallback = result.two_point_calc_newton_fallback;
  return {
    status: result.status,
    closure_reached: result.closure_reached,
    point: result.point,
    domain: result.domain,
    iterations: result.iterations,
    escaped: result.escaped,
    detection: summarize_detection(result.detection),
    cardinality: result.cardinality,
    candidate_cardinality: result.candidate_cardinality,
    cardinality_source: result.cardinality_source,
    newton_native: summarize_newton(result.newton_native),
    newton_big_complex: summarize_newton(result.newton_big_complex),
    newton: summarize_newton(result.newton),
    ...(fallback
      ? {
          two_point_calc_newton_fallback: {
            status: fallback.status,
            calc_cardinality: fallback.calc_cardinality,
            calc_iteration: fallback.calc_iteration,
            newton_cardinality: fallback.newton_cardinality,
            used_for_newton: fallback.used_for_newton,
          },
        }
      : {}),
  };
};

/** Adapt the SDK's outside-cardioid calculator branch to this endpoint's Newton contract. */
export const refine_outside_cardioid_result = (
  point,
  calculation,
  options = {},
) => {
  const cardinality = calculation?.pattern;
  if (
    calculation?.detection ||
    !Number.isInteger(cardinality) ||
    cardinality < 1 ||
    calculation.estimated ||
    FractoUtil.point_in_main_cardioid({
      x: Number(point.re),
      y: Number(point.im),
    })
  )
    return calculation;
  return refine_supplied_cardinality(point, cardinality, {
    ...options,
    cardinality_source: "fracto_fast_calc_outside_cardioid",
    iterations: calculation.iteration,
  });
};

/** Explicit candidate periods bypass detection in either domain. */
export const refine_supplied_cardinality = (
  point,
  cardinality,
  options = {},
) => {
  const mode = options.newton_mode || "big_complex";
  if (!["native", "big_complex", "both"].includes(mode)) {
    return { status: "invalid_newton_mode", cardinality: null, newton: null };
  }
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(options.newton_limit) || 10)),
  );
  const result = {
    status: "cardinality_passed_to_newton",
    point,
    domain: FractoUtil.point_in_main_cardioid({
      x: Number(point.re),
      y: Number(point.im),
    })
      ? "main_cardioid"
      : "outside_main_cardioid",
    iterations: options.iterations || 0,
    escaped: false,
    cardinality,
    cardinality_source: options.cardinality_source || "caller_supplied",
    detection: {
      status:
        options.cardinality_source === "fracto_fast_calc_outside_cardioid"
          ? "calculator_pattern_detected"
          : "supplied_cardinality",
      candidate_cardinality: cardinality,
      ambiguous: false,
    },
    newton_native: null,
    newton_big_complex: null,
    newton: null,
  };
  if (mode === "native" || mode === "both") {
    result.newton_native = newton_derived(
      { x: Number(point.re), y: Number(point.im) },
      limit,
      cardinality,
    );
  }
  if (mode === "big_complex" || mode === "both") {
    result.newton_big_complex = newton_big_complex(
      { x: point.re, y: point.im },
      limit,
      cardinality,
      { precision_digits: 64 },
    );
  }
  result.newton =
    mode === "native"
      ? result.newton_native
      : mode === "big_complex"
        ? result.newton_big_complex
        : null;
  result.closure_reached = [result.newton_native, result.newton_big_complex].filter(Boolean).every(value => value.closure_reached === true);
  if (!result.closure_reached) {
    result.status = "closure_not_reached";
    result.candidate_cardinality = result.cardinality;
    result.cardinality = 0;
  }
  return result;
};

/**
 * Discover a cardinality from critical-orbit returns and refine it with Newton.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @queryParam re Real part of the Mandelbrot parameter.
 * @queryParam im Imaginary part of the Mandelbrot parameter.
 * @queryParam iterations Critical-orbit observation limit.
 * @queryParam minimum_return_repetitions Minimum matching gaps, default 5.
 * @queryParam cardinality Optional supplied period (1–5000); skips detection.
 * @queryParam cardinality_source `legacy_iterative` or `caller_supplied`.
 * @queryParam newton_limit Newton refinement iterations.
 * @queryParam newton_mode `native`, `big_complex`, or `both`.
 * @queryParam adaptive_detection When true, double detector iterations up to
 *   the configured maximum, stopping once recurrence and pyramid evidence are
 *   sufficient.
 * @queryParam maximum_detection_iterations Adaptive detector cap, default 262144.
 * @returns {import('express').Response} Detector and Newton JSON response.
 */
export const handle_orbital_newton = (req, res) => {
  const re = Number(req.query.re);
  const im = Number(req.query.im);
  if (!Number.isFinite(re) || !Number.isFinite(im)) {
    return res.status(400).json({ error: "re and im must be finite numbers" });
  }
  const supplied_cardinality =
    req.query.cardinality === undefined ? null : Number(req.query.cardinality);
  if (
    supplied_cardinality !== null &&
    (!Number.isInteger(supplied_cardinality) ||
      supplied_cardinality < 1 ||
      supplied_cardinality > 5000)
  ) {
    return res
      .status(400)
      .json({ error: "cardinality must be an integer between 1 and 5000" });
  }
  const supplied_source = req.query.cardinality_source || "caller_supplied";
  if (
    supplied_cardinality !== null &&
    !["legacy_iterative", "caller_supplied"].includes(supplied_source)
  ) {
    return res
      .status(400)
      .json({
        error: "cardinality_source must be legacy_iterative or caller_supplied",
      });
  }
  try {
    const started = performance.now();
    const point = { re: req.query.re, im: req.query.im };
    const base_iterations = Math.min(
      ADAPTIVE_MAX_ITERATIONS,
      Math.max(1, Math.floor(Number(req.query.iterations) || 4096)),
    );
    const maximum_iterations = Math.min(
      ADAPTIVE_MAX_ITERATIONS,
      Math.max(
        base_iterations,
        Math.floor(Number(req.query.maximum_detection_iterations)) ||
          ADAPTIVE_MAX_ITERATIONS,
      ),
    );
    const adaptive_detection =
      req.query.adaptive_detection === undefined
        ? true
        : is_truthy(req.query.adaptive_detection);
    let result;
    if (supplied_cardinality !== null) {
      result = refine_supplied_cardinality(point, supplied_cardinality, {
        cardinality_source: supplied_source,
        newton_mode: req.query.newton_mode,
        newton_limit: req.query.newton_limit,
      });
    } else {
      const calculation = discover_and_newton(point, {
        iterations: base_iterations,
        maximum_detection_iterations: maximum_iterations,
        adaptive_detection,
        minimum_return_repetitions: req.query.minimum_return_repetitions,
        newton_limit: req.query.newton_limit,
        newton_mode: req.query.newton_mode,
      });
      result = refine_outside_cardioid_result(point, calculation, {
        newton_limit: req.query.newton_limit,
        newton_mode: req.query.newton_mode,
      });
    }
    if (
      supplied_cardinality === null &&
      result.detection?.candidate_cardinality === 2 &&
      FractoUtil.point_in_main_cardioid({ x: re, y: im })
    ) {
      const fallback = run_two_point_calc_newton_fallback(
        { re: point.re, im: point.im },
        { newton_limit: req.query.newton_limit },
      );
      result.two_point_calc_newton_fallback = {
        status: fallback.status,
        ...fallback.diagnostics,
      };
      if (fallback.status === "newton_points_available") {
        result.newton_big_complex = {
          ...(result.newton_big_complex || {}),
          status: "closure_reached",
          closure_reached: true,
          closure_error: fallback.diagnostics.newton_closure_error,
          closure_tolerance: fallback.diagnostics.newton_closure_tolerance,
          cardinality: fallback.cardinality,
          point_list: fallback.points.map(({ re: point_re, im: point_im }) => ({
            re: String(point_re),
            im: String(point_im),
          })),
          cycles: undefined,
          diagnostics: {
            ...(result.newton_big_complex?.diagnostics || {}),
            mode: "big_complex",
            supplied_cardinality: fallback.cardinality,
            source: "two_point_calc_newton_fallback",
          },
        };
        result.status = "cardinality_passed_to_newton";
        result.closure_reached = true;
        result.cardinality = fallback.cardinality;
        result.newton = result.newton_big_complex;
        result.two_point_calc_newton_fallback.used_for_newton = true;
      }
    }
    return res.status(200).json({
      ...summarize_orbital_newton_response(result),
      detector_horizon_iterations: result.iterations,
      elapsed_ms: performance.now() - started,
    });
  } catch (error) {
    console.error("handle_orbital_newton", error.message);
    return res.status(500).json({ error: error.message });
  }
};
