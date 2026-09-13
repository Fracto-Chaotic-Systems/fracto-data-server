import test from "node:test";
import assert from "node:assert/strict";

import { detect_cardinality } from "../handlers/orbitals/cardinality_detection.js";
import { refine_orbital_points } from "../handlers/orbitals/newton_refinement.js";
import { build_circuitry_from_points } from "../handlers/orbitals/circuitry_pipeline.js";
import { get_cardioid_root } from "../handlers/orbitals/orbitals_utils.js";

const seven_point = { re: 0.1211937096, im: 0.6106129599 };

test("cardinality detection is independently callable", () => {
  const result = detect_cardinality(seven_point, { iterations: 256 });
  assert.equal(result.point.re, String(seven_point.re));
  assert.equal(result.point.im, String(seven_point.im));
  assert.ok(Array.isArray(result.samples));
  assert.equal(result.detection.candidate_cardinality, 7);
  assert.equal(result.status, "cardinality_detected");
});

test("Newton refinement accepts a supplied cardinality", () => {
  const result = refine_orbital_points(seven_point, 7, {
    newton_mode: "native",
    newton_limit: 1,
  });
  assert.equal(result.cardinality, 7);
  assert.equal(result.newton.cardinality_supplied, true);
  assert.equal(result.newton.diagnostics.supplied_cardinality, 7);
});

test("radial circuitry can begin from caller-supplied points and Q", () => {
  const points = [
    { re: 1, im: 0 },
    { re: 0, im: 1 },
    { re: -1, im: 0 },
    { re: 0, im: -1 },
  ];
  const result = build_circuitry_from_points(points, { re: 0, im: 0 }, {
    samples_per_interval: 4,
  });
  assert.equal(result.status, "success");
  assert.equal(result.body.point_source, "caller_supplied");
  assert.equal(result.body.cardinality, points.length);
  assert.equal(result.body.samples, points.length * 4 + 1);
  assert.deepEqual(result.body.Q, { re: 0, im: 0 });
  assert.equal(result.body.result.length, points.length * 4 + 1);
});

test("Q calculation remains independently available", () => {
  const Q = get_cardioid_root({ re: 0, im: 0 });
  assert.deepEqual(Q, { re: 0, im: 0 });
});
