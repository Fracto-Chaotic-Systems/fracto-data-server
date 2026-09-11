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
