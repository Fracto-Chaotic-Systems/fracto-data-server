import { sample_critical_orbit } from "./orbit_sampling.js";
import { detect_return_cardinality } from "./return_detection.js";
import { newton_derived } from "./newton_derived.js";
import { newton_big_complex } from "./newton_big_complex.js";

const with_newton_diagnostics = (result, mode, cardinality) => ({
  ...result,
  diagnostics: {
    mode,
    supplied_cardinality: cardinality,
    precision_digits: mode === "big_complex" ? 64 : 15,
    least_newton_step: String(result.least_magnitude),
    best_cardinality_matches_input: result.least_magnitude_N === cardinality,
    residual_type: "least Newton step magnitude",
  },
});

/**
 * Discover a cardinality from critical-orbit returns and pass it to Newton.
 * This adapter deliberately does not use FractoFastCalc; callers may choose
 * native, arbitrary-precision, or both Newton implementations independently.
 *
 * @param {{re:number|string,im:number|string}} point Mandelbrot parameter.
 * @param {{iterations?:number, minimum_return_repetitions?:number, newton_limit?:number, newton_mode?:"native"|"big_complex"|"both"}} [options] Workflow options.
 * @returns {object} Detector evidence and optional Newton result(s).
 */
export const discover_and_newton = (point, options = {}) => {
  const orbit = sample_critical_orbit(point, {
    iterations: options.iterations,
  });
  const detection = detect_return_cardinality(orbit.samples, {
    minimum_return_repetitions: options.minimum_return_repetitions,
  });
  const response = {
    point: { re: String(point.re), im: String(point.im) },
    iterations: orbit.iterations,
    escaped: orbit.escaped,
    detection,
    newton: null,
  };
  if (
    detection.status !== "return_pattern_detected" ||
    !Number.isInteger(detection.candidate_cardinality)
  ) {
    response.status = "cardinality_inconclusive";
    return response;
  }
  const newton_point = { x: Number(point.re), y: Number(point.im) };
  const newton_limit = Math.max(
    1,
    Math.floor(Number(options.newton_limit) || 5),
  );
  const newton_mode = options.newton_mode || "big_complex";
  const cardinality = detection.candidate_cardinality;
  if (newton_mode === "native" || newton_mode === "both") {
    response.newton_native = with_newton_diagnostics(
      newton_derived(newton_point, newton_limit, cardinality),
      "native",
      cardinality,
    );
  }
  if (newton_mode === "big_complex" || newton_mode === "both") {
    response.newton_big_complex = with_newton_diagnostics(
      newton_big_complex(newton_point, newton_limit, cardinality),
      "big_complex",
      cardinality,
    );
  }
  response.status = "cardinality_passed_to_newton";
  response.newton =
    newton_mode === "native"
      ? response.newton_native
      : newton_mode === "big_complex"
        ? response.newton_big_complex
        : null;
  return response;
};
