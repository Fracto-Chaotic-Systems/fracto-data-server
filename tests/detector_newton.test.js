import test from "node:test";
import assert from "node:assert/strict";
import { discover_and_newton } from "../handlers/orbitals/detector_newton.js";

const reference_point = { re: 0.1517440416, im: 0.5760073226 };
const seven_point = { re: 0.1211937096, im: 0.6106129599 };

test("passes a detected cardinality into both Newton implementations", () => {
  const result = discover_and_newton(reference_point, {
    iterations: 512,
    newton_limit: 1,
    newton_mode: "both",
  });
  assert.equal(result.status, "cardinality_passed_to_newton");
  assert.equal(result.detection.candidate_cardinality, 65);
  assert.equal(result.newton_native.cardinality_supplied, true);
  assert.equal(result.newton_big_complex.cardinality_supplied, true);
  assert.equal(result.newton_native.diagnostics.supplied_cardinality, 65);
  assert.equal(result.newton_big_complex.diagnostics.precision_digits, 64);
  assert.equal(result.newton_native.diagnostics.residual_type, "least Newton step magnitude");
});

test("does not invoke Newton when the return pattern is inconclusive", () => {
  const result = discover_and_newton(reference_point, {
    iterations: 128,
    newton_limit: 1,
  });
  assert.equal(result.status, "cardinality_inconclusive");
  assert.equal(result.newton, null);
});

test("detects and forwards a second known cardinality", () => {
  const result = discover_and_newton(seven_point, {
    iterations: 256,
    newton_limit: 1,
    newton_mode: "native",
  });
  assert.equal(result.status, "cardinality_passed_to_newton");
  assert.equal(result.detection.candidate_cardinality, 7);
  assert.equal(result.newton.cardinality_supplied, true);
  assert.equal(result.newton.cardinality, 7);
});
