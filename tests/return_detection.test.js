import test from "node:test";
import assert from "node:assert/strict";
import { sample_critical_orbit } from "../handlers/orbitals/orbit_sampling.js";
import { detect_return_cardinality } from "../handlers/orbitals/return_detection.js";

test("detects repeated near-zero returns without a warm-up", () => {
  const orbit = sample_critical_orbit(
    { re: 0.1517440416, im: 0.5760073226 },
    { iterations: 512 },
  );
  const result = detect_return_cardinality(orbit.samples);
  assert.equal(result.status, "return_pattern_detected");
  assert.equal(result.candidate_cardinality, 65);
  assert.ok(result.matching_gaps >= 5);
});

test("does not accept a pattern before five repetitions", () => {
  const orbit = sample_critical_orbit(
    { re: 0.1517440416, im: 0.5760073226 },
    { iterations: 128 },
  );
  const result = detect_return_cardinality(orbit.samples);
  assert.equal(result.status, "inconclusive");
});

test("recognizes a 28-cycle orbit with alternating radius minima", () => {
  const orbit = sample_critical_orbit(
    { re: -0.061056345, im: 0.6457252242 },
    { iterations: 4096 },
  );
  const result = detect_return_cardinality(orbit.samples);
  assert.equal(result.status, "return_pattern_detected");
  assert.equal(result.candidate_cardinality, 28);
});

test("distinguishes a prime period from transient sub-gaps", () => {
  const orbit = sample_critical_orbit(
    { re: -0.0831368385, im: 0.6477333222 },
    { iterations: 4096 },
  );
  const result = detect_return_cardinality(orbit.samples);
  assert.equal(result.candidate_cardinality, 43);
  assert.equal(result.ambiguous, false);
  assert.ok(result.alternatives.some((candidate) => candidate.cardinality === 3));
});
