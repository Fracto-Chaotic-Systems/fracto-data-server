import FractoFastCalc from "../../../../sdk/FractoFastCalc.js";
import { performance } from "node:perf_hooks";
import { discover_and_newton } from "./detector_newton.js";
import {
  get_cardioid_root,
  magnitude,
  normalize,
  scale,
  sub,
} from "./orbitals_utils.js";
import {
  optimize_polarity,
  sample_curve,
  solve_coefficients,
} from "./hermite.js";
import { parameterize_radial_sweep } from "./radial_sweep.js";

export const INTERPOLATION_HERMITE = "hermite";
export const INTERPOLATION_RADIAL_SWEEP = "radial_sweep";

const SAMPLES_PER_ORBITAL_INTERVAL = 50;
const MAX_SAMPLE_COUNT = 65536;

/**
 * Run detection/Newton and normalize the resulting orbital point list.
 *
 * @param {{re:number,im:number}} focal_point Canonical focal point.
 * @param {object} options Detector/Newton controls.
 * @returns {{points:Array<{re:number,im:number}>|undefined,
 *   pattern:number|undefined,source:string,detector?:object}}
 */
const get_orbital_points = (focal_point, options = {}) => {
  const detected = discover_and_newton(focal_point, {
    iterations: options.detector_iterations,
    minimum_return_repetitions: options.minimum_return_repetitions,
    newton_limit: options.newton_limit,
    newton_mode: "big_complex",
  });
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
  const calculation = FractoFastCalc.calc(focal_point.re, focal_point.im);
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

/** @param {object|undefined} detector Detector/Newton workflow result. */
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
 * Build Hermite normal vectors for the supplied orbit.
 * @param {Array<{re:number,im:number}>} points Ordered orbit points.
 * @param {{re:number,im:number}} focal_point Original focal point.
 * @returns {Array<{re:number,im:number}>} Normal vectors.
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
 * Assemble the complete circuitry result from a focal point. This is the
 * reusable orchestration stage; it does not know about Express or HTTP status
 * codes. The handler maps its `status_code` and `body` to a response.
 *
 * @param {{re:number,im:number}} focal_point Canonical focal point P.
 * @param {{interpolation?:string,looped_points?:boolean,
 *   optimize_polarity?:boolean,samples?:number,detector_iterations?:number,
 *   minimum_return_repetitions?:number,newton_limit?:number}} [options]
 *   Pipeline controls.
 * @returns {{status:"success"|"outside_mandelbrot_set"|"no_orbit",
 *   body:object}} Pipeline result independent of HTTP transport.
 */
export const build_circuitry_pipeline = (focal_point, options = {}) => {
  const detection_started = performance.now();
  const interpolation = options.interpolation || INTERPOLATION_HERMITE;
  const looped_points = Boolean(options.looped_points);
  const optimize_polarity_pattern = Boolean(options.optimize_polarity);
  const orbit = get_orbital_points(focal_point, options);
  const detector_elapsed_ms = performance.now() - detection_started;
  if (orbit?.pattern === 0) {
    return {
      status: "outside_mandelbrot_set",
      body: {
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
      },
    };
  }
  const points = orbit?.points;
  if (!points || points.length < 2) {
    return {
      status: "no_orbit",
      body: {
        error: "No periodic orbit found by FractoFastCalc",
        point_source: orbit.source,
        detector: summarize_detector(orbit.detector),
        detector_elapsed_ms,
      },
    };
  }
  const normals = get_normals(points, focal_point);
  const cardioid_root = get_cardioid_root(focal_point);
  const default_sample_count = points.length * SAMPLES_PER_ORBITAL_INTERVAL + 1;
  const sample_count = Math.min(
    MAX_SAMPLE_COUNT,
    Math.max(2, Number(options.samples) || default_sample_count),
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
    return {
      status: "success",
      body: {
        result: parameterize_radial_sweep(
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
      },
    };
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
  return {
    status: "success",
    body: {
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
    },
  };
};

/**
 * Enter the curve portion of the pipeline with known orbital points and Q.
 * This direct path is useful when detection and Newton refinement have already
 * been performed elsewhere. It intentionally supports radial sweep first;
 * additional interpolators can be added without changing its caller contract.
 *
 * @param {Array<{re:number,im:number}>} points Ordered orbital points.
 * @param {{re:number,im:number}} Q Radial-sweep origin.
 * @param {{samples_per_interval?:number}} [options] Curve-stage options.
 * @returns {{status:"success"|"no_orbit",body:object}} Transport-neutral
 *   result suitable for use by a handler or another pipeline stage.
 */
export const build_circuitry_from_points = (points, Q, options = {}) => {
  if (!Array.isArray(points) || points.length < 2 || !Q) {
    return {
      status: "no_orbit",
      body: {
        result: [],
        orbital_points: [],
        cardinality: 0,
        samples: 0,
        Q: Q || null,
        interpolation: INTERPOLATION_RADIAL_SWEEP,
        point_source: "caller_supplied",
      },
    };
  }
  const maximum_samples_per_interval = Math.max(
    1,
    Math.floor((MAX_SAMPLE_COUNT - 1) / points.length),
  );
  const samples_per_interval = Math.min(
    maximum_samples_per_interval,
    Math.max(
      1,
      Math.floor(
        Number(options.samples_per_interval) || SAMPLES_PER_ORBITAL_INTERVAL,
      ),
    ),
  );
  const result = parameterize_radial_sweep(points, Q, {
    samples_per_interval,
  });
  return {
    status: "success",
    body: {
      result,
      orbital_points: points,
      cardinality: points.length,
      samples: result.length,
      Q,
      interpolation: INTERPOLATION_RADIAL_SWEEP,
      looped_points: false,
      optimize_polarity: false,
      point_source: "caller_supplied",
    },
  };
};
