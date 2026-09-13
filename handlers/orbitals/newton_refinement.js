import { newton_derived } from "./newton_derived.js";
import { newton_big_complex } from "./newton_big_complex.js";

/**
 * Attach common diagnostics to a Newton refinement result.
 *
 * @param {object} result Raw Newton result.
 * @param {"native"|"big_complex"} mode Numeric implementation used.
 * @param {number} cardinality Cardinality supplied to the refinement.
 * @returns {object} Newton result with provenance and effort metadata.
 */
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
 * Refine orbital points using a caller-supplied cardinality.
 *
 * This is intentionally independent of cardinality detection. A caller that
 * already knows or wishes to test a candidate cardinality can enter the
 * pipeline here without sampling the critical orbit again. The result names
 * match the existing detector/Newton response so the HTTP adapter can expose
 * it without a breaking response change.
 *
 * @param {{re:number|string, im:number|string}} point Mandelbrot parameter.
 * @param {number} cardinality Candidate number of orbital points.
 * @param {{newton_limit?:number,newton_mode?:"native"|"big_complex"|"both"}} [options]
 *   Newton effort and numeric-mode controls.
 * @returns {{newton_native?:object|null,newton_big_complex?:object|null,
 *   newton?:object|null,cardinality:number}} Refinement result(s).
 */
export const refine_orbital_points = (point, cardinality, options = {}) => {
  const numeric_cardinality = Math.floor(Number(cardinality));
  const newton_limit = Math.max(
    1,
    Math.floor(Number(options.newton_limit) || 5),
  );
  const newton_mode = options.newton_mode || "big_complex";
  const newton_point = { x: Number(point.re), y: Number(point.im) };
  const response = {
    cardinality: numeric_cardinality,
    newton_native: null,
    newton_big_complex: null,
    newton: null,
  };
  if (newton_mode === "native" || newton_mode === "both") {
    response.newton_native = with_newton_diagnostics(
      newton_derived(newton_point, newton_limit, numeric_cardinality),
      "native",
      numeric_cardinality,
    );
  }
  if (newton_mode === "big_complex" || newton_mode === "both") {
    response.newton_big_complex = with_newton_diagnostics(
      newton_big_complex(newton_point, newton_limit, numeric_cardinality),
      "big_complex",
      numeric_cardinality,
    );
  }
  response.newton =
    newton_mode === "native"
      ? response.newton_native
      : newton_mode === "big_complex"
        ? response.newton_big_complex
        : null;
  return response;
};
