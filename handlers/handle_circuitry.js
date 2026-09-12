import FractoFastCalc from "../../../sdk/FractoFastCalc.js";
import { performance } from "node:perf_hooks";
import { discover_and_newton } from "./orbitals/detector_newton.js";
import { magnitude, normalize, scale, sub } from "./orbitals/orbitals_utils.js";
import {
  optimize_polarity,
  sample_curve,
  solve_coefficients,
} from "./orbitals/hermite.js";
import { sample_radial_sweep } from "./orbitals/radial_sweep.js";

const SAMPLES_PER_ORBITAL_INTERVAL = 50;
const MAX_SAMPLE_COUNT = 65536;
const INTERPOLATION_HERMITE = "hermite";
const INTERPOLATION_RADIAL_SWEEP = "radial_sweep";

/**
 * Calculate the principal complex square root used by the cardioid-root
 * construction.
 *
 * @param {{re: number, im: number}} point Complex input.
 * @returns {{re: number, im: number}} Principal complex square root.
 */
const complex_sqrt = (point) => {
  const size = magnitude(point);
  const real_part = Math.sqrt(Math.max(0, (size + point.re) / 2));
  const imaginary_part = Math.sqrt(Math.max(0, (size - point.re) / 2));
  return {
    re: real_part,
    im: point.im < 0 ? -imaginary_part : imaginary_part,
  };
};

/**
 * Calculate Q, the cardioid-root point used as the normal origin.
 *
 * @param {{re: number, im: number}} focal_point Mandelbrot focal point P.
 * @returns {{re: number, im: number}} Q = (1 - sqrt(1 - 4P)) / 2.
 */
const get_cardioid_root = (focal_point) =>
  scale(
    sub(
      { re: 1, im: 0 },
      complex_sqrt(sub({ re: 1, im: 0 }, scale(focal_point, 4))),
    ),
    0.5,
  );

/**
 * Run the deep orbit calculation and normalize its point representation.
 * A repeated terminal point, when present, is removed so the orbit remains
 * cyclic without duplicating its starting point.
 *
 * @param {number} re Real component of the focal point.
 * @param {number} im Imaginary component of the focal point.
 * @param {{iterations?: number, minimum_return_repetitions?: number, newton_limit?: number}} [options]
 *   Detector/Newton controls.
 * @returns {{points: Array<{re: number, im: number}>|undefined, pattern: number|undefined, source: string, detector?: object}}
 *   Ordered orbit points, cardinality, and provenance metadata.
 */
const get_orbital_points = (re, im, options = {}) => {
  const detected = discover_and_newton(
    { re, im },
    {
      iterations: options.iterations,
      minimum_return_repetitions: options.minimum_return_repetitions,
      newton_limit: options.newton_limit,
      newton_mode: "big_complex",
    },
  );
  const refined_points = detected.newton_big_complex?.point_list
    ?.map((point) => ({ re: Number(point.re), im: Number(point.im) }))
    .filter((point) => Number.isFinite(point.re) && Number.isFinite(point.im));
  if (
    detected.status === "cardinality_passed_to_newton" &&
    refined_points?.length >= 2
  ) {
    return {
      points: refined_points,
      pattern: detected.detection.candidate_cardinality,
      source: "detector_newton",
      detector: detected,
    };
  }

  // TODO: Remove this FractoFastCalc fallback once detector/Newton coverage
  // is sufficient for all supported circuitry focal points.
  const calculation = FractoFastCalc.calc(re, im);
  const points = calculation?.orbital_points?.map((point) => ({
    re: point.x,
    im: point.y,
  }));
  if (
    points?.length > 1 &&
    magnitude(sub(points[points.length - 1], points[0])) <= 1e-12
  ) {
    points.pop();
  }
  return {
    points,
    pattern: calculation?.pattern,
    source: "fracto_fast_calc_fallback",
    detector: detected,
  };
};

/**
 * Keep circuitry responses compact while exposing enough detector provenance
 * to diagnose which point-generation path was used.
 * @param {object|undefined} detector Detector/Newton workflow result.
 * @returns {object|undefined} Compact detector summary.
 */
const summarize_detector = (detector) =>
  detector
    ? {
        status: detector.status,
        iterations: detector.iterations,
        escaped: detector.escaped,
        detection: {
          status: detector.detection?.status,
          candidate_cardinality: detector.detection?.candidate_cardinality,
          matching_gaps: detector.detection?.matching_gaps,
          confidence: detector.detection?.confidence,
        },
        newton: detector.newton_big_complex?.diagnostics || null,
      }
    : undefined;

/**
 * Build a normal-length vector at each orbit point. Each vector follows the
 * ray from Q to the point and is scaled by the average adjacent edge length.
 *
 * @param {Array<{re: number, im: number}>} points Ordered orbit points.
 * @param {{re: number, im: number}} focal_point Focal point P.
 * @returns {Array<{re: number, im: number}>} Scaled normal vectors.
 */
const get_normals = (points, focal_point) => {
  const cardioid_root = get_cardioid_root(focal_point);
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const incoming = sub(point, previous);
    const outgoing = sub(next, point);
    const velocity = (magnitude(incoming) + magnitude(outgoing)) / 2;
    return scale(normalize(sub(point, cardioid_root)), velocity);
  });
};

/**
 * Generate a parameterized smooth curve around a periodic Mandelbrot orbit.
 *
 * The endpoint accepts `GET /circuitry` query parameters:
 * - `re`, `im` (required): finite focal-point coordinates P.
 * - `samples` (optional): Hermite output count, clamped to 2 through 65,536.
 *   Radial-sweep output always uses 50 samples per orbital interval plus the
 *   closing sample so every interval receives equal sampling density.
 * - `looped_points` (optional boolean): reverses Hermite normal orientation.
 * - `optimize_polarity` (optional boolean): exhaustively tests Hermite normal
 *   polarity patterns for small orbits and scores their smoothness.
 * - `interpolation` (optional): `hermite` (default) or `radial_sweep`.
 * - `detector_iterations`, `minimum_return_repetitions`, `newton_limit`
 *   (optional): controls the return detector and BigComplex Newton refinement
 *   used to supply the fitted orbital points.
 *
 * Both modes use detector/Newton-refined points when available and return
 * `{t, C}` samples, the exact normalized `orbital_points` used to construct
 * the curve, orbit cardinality, sample count, Q, and interpolation metadata.
 * Hermite mode also
 * returns polarity optimization metadata. Radial-sweep mode uses Q as its
 * polar origin and intentionally ignores Hermite-only options.
 *
 * Responses:
 * - `200`: sampled curve and metadata.
 * - `400`: invalid coordinates or unsupported interpolation mode.
 * - `200`: a valid request whose point is outside the Mandelbrot set. In this
 *   case `orbit_status` and `message` explain why `result` is empty.
 * - `422`: no periodic orbit with at least two points was found for a result
 *   other than the explicit `pattern=0` outside-set outcome.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {import('express').Response} JSON response sent to the client.
 */
export const handle_circuitry = (req, res) => {
  const detection_started = performance.now();
  const re = Number(req.query.re);
  const im = Number(req.query.im);
  const looped_points = [true, "true", 1, "1"].includes(
    req.query.looped_points,
  );
  const optimize_polarity_pattern = [true, "true", 1, "1"].includes(
    req.query.optimize_polarity,
  );
  const interpolation = req.query.interpolation || INTERPOLATION_HERMITE;
  if (!Number.isFinite(re) || !Number.isFinite(im)) {
    return res.status(400).json({ error: "re and im must be finite numbers" });
  }
  if (
    ![INTERPOLATION_HERMITE, INTERPOLATION_RADIAL_SWEEP].includes(interpolation)
  ) {
    return res.status(400).json({
      error: `Unknown circuitry interpolation: ${interpolation}`,
      supported: [INTERPOLATION_HERMITE, INTERPOLATION_RADIAL_SWEEP],
    });
  }
  const orbit = get_orbital_points(re, im, {
    iterations: req.query.detector_iterations,
    minimum_return_repetitions: req.query.minimum_return_repetitions,
    newton_limit: req.query.newton_limit,
  });
  const detector_elapsed_ms = performance.now() - detection_started;
  if (orbit?.pattern === 0) {
    return res.status(200).json({
      result: [],
      orbital_points: [],
      cardinality: 0,
      samples: 0,
      Q: null,
      interpolation,
      looped_points: false,
      optimize_polarity: false,
      polarity_pattern: null,
      polarity_score: null,
      polarity_metrics: null,
      polarity_exhaustive: false,
      in_mandelbrot_set: false,
      orbit_status: "outside_mandelbrot_set",
      point_source: orbit.source,
      detector_elapsed_ms,
      message:
        "The requested focal point is outside the Mandelbrot set; no periodic orbit is available for circuitry rendering.",
    });
  }
  const points = orbit?.points;
  if (!points || points.length < 2) {
    return res.status(422).json({
      error: "No periodic orbit found by FractoFastCalc",
      point_source: orbit.source,
      detector: summarize_detector(orbit.detector),
      detector_elapsed_ms,
    });
  }
  const normals = get_normals(points, { re, im });
  const cardioid_root = get_cardioid_root({ re, im });
  const default_sample_count = points.length * SAMPLES_PER_ORBITAL_INTERVAL + 1;
  const sample_count = Math.min(
    MAX_SAMPLE_COUNT,
    Math.max(2, Number(req.query.samples) || default_sample_count),
  );
  if (interpolation === INTERPOLATION_RADIAL_SWEEP) {
    const radial_samples_per_interval = Math.max(
      1,
      Math.min(
        SAMPLES_PER_ORBITAL_INTERVAL,
        Math.floor((MAX_SAMPLE_COUNT - 1) / points.length),
      ),
    );
    const radial_sample_count =
      points.length * radial_samples_per_interval + 1;
    return res.status(200).json({
      result: sample_radial_sweep(
        points,
        cardioid_root,
        radial_samples_per_interval,
      ),
      orbital_points: points,
      cardinality: points.length,
      samples: radial_sample_count,
      Q: cardioid_root,
      interpolation,
      looped_points: false,
      optimize_polarity: false,
      polarity_pattern: null,
      polarity_score: null,
      polarity_metrics: null,
      polarity_exhaustive: false,
      point_source: orbit.source,
      detector: summarize_detector(orbit.detector),
      detector_elapsed_ms,
    });
  }
  const optimized = optimize_polarity_pattern
    ? optimize_polarity(points, normals, looped_points, cardioid_root)
    : {
        coefficients: solve_coefficients(points, normals, looped_points),
        pattern: null,
        score: null,
        metrics: null,
        exhaustive: false,
      };
  return res.status(200).json({
    result: sample_curve(optimized.coefficients, points.length, sample_count),
    orbital_points: points,
    cardinality: points.length,
    samples: sample_count,
    Q: cardioid_root,
    interpolation,
    looped_points,
    optimize_polarity: optimize_polarity_pattern,
    polarity_pattern: optimized.pattern,
    polarity_score: optimized.score,
    polarity_metrics: optimized.metrics,
    polarity_exhaustive: optimized.exhaustive,
    point_source: orbit.source,
    detector_elapsed_ms,
    detector: summarize_detector(orbit.detector),
  });
};
