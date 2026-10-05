import { discover_and_newton } from "./orbitals/detector_newton.js";
import FractoUtil from "@fracto/sdk/FractoUtil.js";
import { run_two_point_calc_newton_fallback } from "./orbitals/two_point_calc_newton_fallback.js";
import { performance } from "node:perf_hooks";

const is_truthy = (value) =>
  ["1", "true", "yes"].includes(String(value).toLowerCase());
const ADAPTIVE_MAX_ITERATIONS = 262144;

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
    const adaptive_detection = req.query.adaptive_detection === undefined
      ? true
      : is_truthy(req.query.adaptive_detection);
    const result = discover_and_newton(point, {
      iterations: base_iterations,
      maximum_detection_iterations: maximum_iterations,
      adaptive_detection,
      minimum_return_repetitions: req.query.minimum_return_repetitions,
      newton_limit: req.query.newton_limit,
      newton_mode: req.query.newton_mode,
    });
    if (
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
        result.two_point_calc_newton_fallback.used_for_newton = true;
      }
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
