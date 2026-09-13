import {
  build_circuitry_pipeline,
  INTERPOLATION_HERMITE,
  INTERPOLATION_RADIAL_SWEEP,
} from "./orbitals/circuitry_pipeline.js";

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
  const pipeline = build_circuitry_pipeline(
    { re, im },
    {
      interpolation,
      looped_points,
      optimize_polarity: optimize_polarity_pattern,
      samples: req.query.samples,
      detector_iterations: req.query.detector_iterations,
      minimum_return_repetitions: req.query.minimum_return_repetitions,
      newton_limit: req.query.newton_limit,
    },
  );
  const status_code = pipeline.status === "no_orbit" ? 422 : 200;
  return res.status(status_code).json(pipeline.body);
};
