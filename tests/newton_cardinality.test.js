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

test("Newton solvers require a candidate instead of choosing a cardinality", () => {
  const result = newton_derived(reference_point, 1);
  assert.equal(result.cardinality_supplied, false);
  assert.equal(result.status, "cardinality_required");
  assert.equal(result.least_magnitude_N, 0);
  assert.deepEqual(result.point_list, []);
  const big_result = newton_big_complex(reference_point, 1);
  assert.equal(big_result.status, "cardinality_required");
  assert.equal(big_result.least_magnitude_N, 0);
});

test("BigComplex Newton accepts a known cardinality", () => {
  const result = newton_big_complex(reference_point, 1, 65);
  assert.equal(result.cardinality_supplied, true);
  assert.equal(result.least_magnitude_N, 65);
});

test("both Newton solvers preserve supplied periods one and two", () => {
  for (const solve of [newton_derived, newton_big_complex]) {
    const fixed = solve({ x: 0, y: 0 }, 4, 1);
    assert.equal(fixed.cardinality, 1);
    assert.equal(fixed.least_magnitude_N, 1);
    assert.equal(fixed.point_list.length, 1);
    assert.equal(fixed.cycles, 1);
    assert.equal(fixed.least_magnitude, 0);

    const period_two = solve({ x: -1, y: 0 }, 4, 2);
    assert.equal(period_two.cardinality, 2);
    assert.equal(period_two.least_magnitude_N, 2);
    assert.equal(period_two.point_list.length, 2);
    assert.equal(period_two.cycles, 1);
    assert.equal(period_two.least_magnitude, 0);
  }
});
