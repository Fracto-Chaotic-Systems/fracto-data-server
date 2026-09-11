import { discover_and_newton } from "./orbitals/detector_newton.js";
import { performance } from "node:perf_hooks";

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
    const result = discover_and_newton(
      { re: req.query.re, im: req.query.im },
      {
        iterations: req.query.iterations,
        minimum_return_repetitions: req.query.minimum_return_repetitions,
        newton_limit: req.query.newton_limit,
        newton_mode: req.query.newton_mode,
      },
    );
    return res.status(200).json({
      ...result,
      elapsed_ms: performance.now() - started,
    });
  } catch (error) {
    console.error("handle_orbital_newton", error.message);
    return res.status(500).json({ error: error.message });
  }
};
