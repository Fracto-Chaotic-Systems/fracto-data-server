import test from "node:test";
import assert from "node:assert/strict";
import { discover_and_newton } from "../handlers/orbitals/detector_newton.js";

const reference_point = { re: 0.25, im: 0.1 };
const inconclusive_point = { re: 0.2, im: 0.1 };
const seven_point = { re: 0.112602264, im: 0.5939821402 };

test("passes a detected cardinality into both Newton implementations", () => {
  const result = discover_and_newton(reference_point, {
    iterations: 128,
    adaptive_detection: false,
    newton_limit: 1,
    newton_mode: "both",
  });
  assert.equal(result.status, "cardinality_passed_to_newton");
  assert.equal(result.detection.candidate_cardinality, 9);
  assert.equal(result.newton_native.cardinality_supplied, true);
  assert.equal(result.newton_big_complex.cardinality_supplied, true);
  assert.equal(result.newton_native.diagnostics.supplied_cardinality, 9);
  assert.equal(result.newton_big_complex.diagnostics.precision_digits, 64);
  assert.equal(result.newton_native.diagnostics.residual_type, "least Newton step magnitude");
});

test("does not invoke Newton when the return pattern is inconclusive", () => {
  const result = discover_and_newton(inconclusive_point, {
    iterations: 128,
    adaptive_detection: false,
    newton_limit: 1,
  });
  assert.equal(result.status, "cardinality_inconclusive");
  assert.equal(result.newton, null);
});

test("detects and forwards a second known cardinality", () => {
  const result = discover_and_newton(seven_point, {
    iterations: 4096,
    adaptive_detection: false,
    newton_limit: 1,
    newton_mode: "native",
  });
  assert.equal(result.status, "cardinality_passed_to_newton");
  assert.equal(result.detection.candidate_cardinality, 7);
  assert.equal(result.newton.cardinality_supplied, true);
  assert.equal(result.newton.cardinality, 7);
});
