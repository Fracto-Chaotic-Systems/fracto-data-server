import { sample_critical_orbit } from "./orbit_sampling.js";
import { detect_return_cardinality } from "./return_detection.js";

/**
 * Detect a candidate orbital cardinality from the critical orbit beginning at
 * z=0. This is the standalone detection stage of the orbital pipeline; it
 * does not calculate Q, perform Newton refinement, or parameterize a curve.
 *
 * The returned object is deliberately suitable for passing to a later stage:
 * callers that already have a detection result can skip this function, while
 * callers needing the established detector behavior receive the same orbit
 * and diagnostic fields previously assembled by detector_newton.js.
 *
 * @param {{re:number|string, im:number|string}} point Mandelbrot parameter.
 * @param {{iterations?:number, minimum_return_repetitions?:number}} [options]
 *   Critical-orbit and recurrence-detector controls.
 * @returns {{point:{re:string,im:string},iterations:number,escaped:boolean,
 *   samples:Array<{iteration:number,re:number,im:number,radius:number}>,
 *   detection:object,status:string}} Detection result and evidence.
 */
export const detect_cardinality = (point, options = {}) => {
  const orbit = sample_critical_orbit(point, {
    iterations: options.iterations,
  });
  const detection = detect_return_cardinality(orbit.samples, {
    minimum_return_repetitions: options.minimum_return_repetitions,
  });
  return {
    point: { re: String(point.re), im: String(point.im) },
    iterations: orbit.iterations,
    escaped: orbit.escaped,
    samples: orbit.samples,
    detection,
    status:
      detection.status === "return_pattern_detected" &&
      Number.isInteger(detection.candidate_cardinality)
        ? "cardinality_detected"
        : "cardinality_inconclusive",
  };
};
