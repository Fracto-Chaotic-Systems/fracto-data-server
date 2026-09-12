import { discover_and_newton } from "./orbitals/detector_newton.js";
import { performance } from "node:perf_hooks";

const is_truthy = (value) =>
  ["1", "true", "yes"].includes(String(value).toLowerCase());
const ADAPTIVE_MAX_ITERATIONS = 262144;

const has_sufficient_detection = (result, horizon) => {
  const detection = result?.detection;
  const cardinality = detection?.candidate_cardinality;
  return (
    detection?.status === "return_pattern_detected" &&
    Number.isInteger(cardinality) &&
    horizon >= cardinality * 10 &&
    detection.pyramid_coherence >= 0.9 &&
    detection.recurrence_quality >= 0.9 &&
    detection.confidence_margin >= 0.25 &&
    detection.ambiguous !== true
  );
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
    const iterations = is_truthy(req.query.adaptive_detection)
      ? (() => {
          let horizon = base_iterations;
          let result = null;
          const checked_horizons = [];
          while (true) {
            result = discover_and_newton(point, {
              iterations: horizon,
              minimum_return_repetitions: req.query.minimum_return_repetitions,
              newton_limit: req.query.newton_limit,
              newton_mode: req.query.newton_mode,
            });
            checked_horizons.push(horizon);
            if (
              has_sufficient_detection(result, horizon) ||
              horizon >= maximum_iterations
            ) {
              break;
            }
            horizon = Math.min(maximum_iterations, horizon * 2);
          }
          return {
            result,
            horizons: checked_horizons,
          };
        })()
      : { result: discover_and_newton(point, {
          iterations: base_iterations,
          minimum_return_repetitions: req.query.minimum_return_repetitions,
          newton_limit: req.query.newton_limit,
          newton_mode: req.query.newton_mode,
        }), horizons: null };
    const result = iterations.result;
    if (iterations.horizons) {
      result.diagnostics = {
        ...(result.diagnostics || {}),
        adaptive_detection: true,
        maximum_detection_iterations: maximum_iterations,
        checked_horizons: iterations.horizons,
      };
    }
    return res.status(200).json({
      ...result,
      detector_horizon_iterations: result.iterations,
      elapsed_ms: performance.now() - started,
    });
  } catch (error) {
    console.error("handle_orbital_newton", error.message);
    return res.status(500).json({ error: error.message });
  }
};
