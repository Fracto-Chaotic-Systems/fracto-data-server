import test from "node:test";
import assert from "node:assert/strict";
import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
import { handle_orbital_newton } from "../handlers/handle_orbital_newton.js";

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
    re: "0.1517440416",
    im: "0.5760073226",
    iterations: "512",
    newton_limit: "1",
    newton_mode: "native",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, "cardinality_passed_to_newton");
  assert.equal(response.body.detection.candidate_cardinality, 65);
  assert.equal(response.body.newton.cardinality_supplied, true);
});

test("orbital Newton endpoint reports inconclusive detection normally", () => {
  const response = invoke({
    re: "0.1517440416",
    im: "0.5760073226",
    iterations: "128",
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
    response.body.orbital_two_calc_newton_experiment.status,
    "newton_points_available",
  );
  assert.equal(
    response.body.orbital_two_calc_newton_experiment.calc_cardinality,
    1,
  );
  assert.equal(
    response.body.orbital_two_calc_newton_experiment.used_for_chart,
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
    response.body.orbital_two_calc_newton_experiment.calc_cardinality,
    calculator_result.pattern,
  );
  assert.equal(
    response.body.orbital_two_calc_newton_experiment.newton_cardinality,
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
  assert.deepEqual(response.body.diagnostics.checked_horizons, [4096]);
});
