import test from "node:test";
import assert from "node:assert/strict";
import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
import {
  handle_orbital_newton,
  summarize_orbital_newton_response,
} from "../handlers/handle_orbital_newton.js";

const invoke = (query) => {
  const response = {
    code: null,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  handle_orbital_newton({ query }, response);
  return response;
};

test("orbital Newton endpoint returns detector and Newton data", () => {
  const response = invoke({
    re: "0.112602264",
    im: "0.5939821402",
    iterations: "4096",
    newton_limit: "1",
    newton_mode: "native",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, "cardinality_passed_to_newton");
  assert.equal(response.body.detection.candidate_cardinality, 7);
  assert.equal(response.body.newton.cardinality_supplied, true);
});

test("orbital Newton endpoint reports inconclusive detection normally", () => {
  const response = invoke({
    re: "0.2",
    im: "0.1",
    iterations: "128",
    adaptive_detection: "false",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, "cardinality_inconclusive");
  assert.equal(response.body.newton, null);
});

test("orbital Newton endpoint rejects invalid coordinates", () => {
  const response = invoke({ re: "not-a-number", im: "0" });
  assert.equal(response.code, 400);
  assert.match(response.body.error, /finite numbers/);
});

test("orbital Newton HTTP response omits investigation-only diagnostics", () => {
  const minima = [{ iteration: 1 }, { iteration: 2 }];
  const matching_minima = [{ iteration: 1 }];
  const point_list = [{ re: "0", im: "0" }];
  const result = {
    status: "cardinality_passed_to_newton",
    point: { re: "0.2", im: "0.1" },
    iterations: 4096,
    diagnostics: { checked_horizons: [4096], large_debug_field: true },
    detection: {
      status: "return_pattern_detected",
      minima,
      matching_minima,
      alternatives: [{ cardinality: 35 }],
      pyramid_layer_diagnostics: [{ scale: 1 }],
      candidate_cardinality: 37,
      ambiguous: true,
    },
    newton_big_complex: {
      point_list,
      cardinality: 37,
      diagnostics: { least_newton_step: "0" },
    },
    newton: { point_list, cardinality: 37, diagnostics: { verbose: true } },
  };
  const response = summarize_orbital_newton_response(result);
  assert.deepEqual(response.detection, {
    status: "return_pattern_detected",
    candidate_cardinality: 37,
    ambiguous: true,
  });
  assert.equal(response.newton_big_complex.point_list, point_list);
  assert.equal(response.newton_big_complex.cardinality, 37);
  assert.equal("diagnostics" in response.newton_big_complex, false);
  assert.equal("diagnostics" in response, false);
  assert.equal("minima" in response.detection, false);
  assert.equal("alternatives" in response.detection, false);
  assert.equal(result.detection.minima, minima);
});

test("detector cardinality 2 automatically uses calc-derived Newton points", () => {
  const response = invoke({
    re: "-0.6690634164",
    im: "0.0908537666",
    iterations: "4096",
    newton_limit: "5",
    newton_mode: "big_complex",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.detection.candidate_cardinality, 2);
  assert.equal(
    response.body.two_point_calc_newton_fallback.status,
    "newton_points_available",
  );
  assert.equal(
    response.body.two_point_calc_newton_fallback.calc_cardinality,
    1,
  );
  assert.equal(
    response.body.two_point_calc_newton_fallback.used_for_newton,
    true,
  );
  assert.equal(response.body.newton_big_complex.cardinality, 1);
  assert.equal(response.body.newton_big_complex.point_list.length, 1);
});

test("two-point fallback passes numeric coordinates to FractoFastCalc", () => {
  const calculator_result = FractoFastCalc.calc(-0.7478628725, 0.0472735375);
  const response = invoke({
    re: "-0.7478628725",
    im: "0.0472735375",
    iterations: "4096",
    newton_limit: "5",
    newton_mode: "big_complex",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.detection.candidate_cardinality, 2);
  assert.equal(
    response.body.two_point_calc_newton_fallback.calc_cardinality,
    calculator_result.pattern,
  );
  assert.equal(
    response.body.two_point_calc_newton_fallback.newton_cardinality,
    calculator_result.pattern,
  );
  assert.equal(
    response.body.newton_big_complex.cardinality,
    calculator_result.pattern,
  );
  assert.equal(
    response.body.newton_big_complex.point_list.length,
    calculator_result.pattern,
  );
});

test("adaptive detection stops once the candidate evidence is sufficient", () => {
  const response = invoke({
    re: "0.112602264",
    im: "0.5939821402",
    adaptive_detection: "true",
    maximum_detection_iterations: "262144",
    newton_mode: "native",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.detection.candidate_cardinality, 7);
  assert.equal(response.body.detector_horizon_iterations, 4096);
  assert.equal(response.body.iterations, 4096);
});

test("orbital Newton defaults to the shared adaptive candidate for the circuitry comparison point", () => {
  const response = invoke({
    re: "0.3237686467",
    im: "0.0535461409",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.detection.candidate_cardinality, 92);
  assert.equal(response.body.iterations, 16384);
});
