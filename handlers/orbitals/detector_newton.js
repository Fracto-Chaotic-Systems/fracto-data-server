import { detect_cardinality } from "./cardinality_detection.js";
import { refine_orbital_points } from "./newton_refinement.js";

/**
 * Run the standalone cardinality detector and, when it succeeds, pass its
 * result to Newton. This adapter deliberately does not use FractoFastCalc;
 * callers may choose native, arbitrary-precision, or both Newton
 * implementations independently.
 *
 * @param {{re:number|string,im:number|string}} point Mandelbrot parameter.
 * @param {{iterations?:number, minimum_return_repetitions?:number, newton_limit?:number, newton_mode?:"native"|"big_complex"|"both"}} [options] Workflow options.
 * @returns {object} Detector evidence and optional Newton result(s).
 */
export const discover_and_newton = (point, options = {}) => {
  const detected = detect_cardinality(point, options);
  const { detection } = detected;
  const response = {
    point: detected.point,
    iterations: detected.iterations,
    escaped: detected.escaped,
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
  const cardinality = detection.candidate_cardinality;
  const refinement = refine_orbital_points(point, cardinality, options);
  response.newton_native = refinement.newton_native;
  response.newton_big_complex = refinement.newton_big_complex;
  response.status = "cardinality_passed_to_newton";
  response.newton = refinement.newton;
  return response;
};
