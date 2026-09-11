import test from "node:test";
import assert from "node:assert/strict";
import { newton_derived } from "../handlers/orbitals/newton_derived.js";
import { newton_big_complex } from "../handlers/orbitals/newton_big_complex.js";

const reference_point = { x: 0.1517440416, y: 0.5760073226 };

test("derived Newton accepts a known cardinality without searching", () => {
  const result = newton_derived(reference_point, 1, 65);
  assert.equal(result.cardinality_supplied, true);
  assert.equal(result.least_magnitude_N, 65);
});

test("derived Newton preserves the legacy cardinality search", () => {
  const result = newton_derived(reference_point, 1);
  assert.equal(result.cardinality_supplied, false);
  assert.ok(result.least_magnitude_N > 0);
});

test("BigComplex Newton accepts a known cardinality", () => {
  const result = newton_big_complex(reference_point, 1, 65);
  assert.equal(result.cardinality_supplied, true);
  assert.equal(result.least_magnitude_N, 65);
});
