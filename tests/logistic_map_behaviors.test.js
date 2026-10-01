import test from "node:test";
import assert from "node:assert/strict";
import { calculate_logistic_orbit } from "../handlers/logistic_map/calculator.js";

const settings = (iteration_cap, transient_limit = 0, extras = {}) => ({
  iteration_cap,
  transient_limit,
  ...extras,
});

test("recognizes a seeded fixed point without calling it an attracting cycle", () => {
  const result = calculate_logistic_orbit(3.2, settings(100, 0, {
    seed_policy: { type: "explicit", x0: 0.6875 },
  }));

  assert.equal(result.status, "cycle_candidate");
  assert.equal(result.cycle.period, 1);
  assert.equal(result.cycle.points[0], 0.6875);
  assert.equal(result.cycle.validation_scope, "finite_precision");
  assert.equal(result.cycle.mathematical_proof, false);
});

test("covers period-two and period-four cycles after period doubling", () => {
  const period_two = calculate_logistic_orbit(3.2, settings(10_000, 100));
  const period_four = calculate_logistic_orbit(3.5, settings(10_000, 100));

  assert.equal(period_two.cycle.period, 2);
  assert.equal(period_four.cycle.period, 4);
  assert.ok(period_two.cycle.return_residual <= period_two.settings.cycle_tolerance);
  assert.ok(period_four.cycle.return_residual <= period_four.settings.cycle_tolerance);
});

test("recognizes a period-three cycle in a periodic window", () => {
  const result = calculate_logistic_orbit(3.83, settings(10_000, 1_000));

  assert.equal(result.status, "cycle_candidate");
  assert.equal(result.cycle.period, 3);
  assert.equal(result.cycle.mathematical_proof, false);
});

test("keeps a representative chaotic parameter unresolved at the cap", () => {
  const result = calculate_logistic_orbit(3.9, settings(5_000, 100));

  assert.equal(result.status, "sampled_unresolved");
  assert.equal(result.reason.code, "iteration_cap_reached");
  assert.equal(result.sample.end_iteration, 5_000);
  assert.equal(result.cycle_detection.evidence_scope, "finite_precision_only");
});

test("covers the lower boundary, the excluded upper boundary, and values near it", () => {
  const lower = calculate_logistic_orbit(3, settings(100, 0));
  const near_upper = calculate_logistic_orbit("3.999999", settings(1_000, 100));
  const upper = calculate_logistic_orbit(4, settings(100, 0));
  const below = calculate_logistic_orbit("2.999999", settings(100, 0));

  assert.notEqual(lower.status, "invalid_input");
  assert.notEqual(near_upper.status, "invalid_input");
  assert.equal(upper.status, "invalid_input");
  assert.equal(below.status, "invalid_input");
});

test("a deliberately short cap remains unresolved and a larger cap refines it", () => {
  const short_run = calculate_logistic_orbit(3.5, settings(10, 0));
  const longer_run = calculate_logistic_orbit(3.5, settings(100, 0));

  assert.equal(short_run.status, "sampled_unresolved");
  assert.equal(short_run.reason.code, "iteration_cap_reached");
  assert.equal(longer_run.status, "cycle_candidate");
  assert.equal(longer_run.cycle.period, 4);
  assert.equal(short_run.status, "sampled_unresolved");
  assert.equal(longer_run.cycle.mathematical_proof, false);
});

test("does not claim higher precision before an arithmetic backend exists", () => {
  const result = calculate_logistic_orbit(3.5, settings(100, 0, {
    precision: { backend: "decimal", significant_digits: 50 },
  }));

  assert.equal(result.status, "invalid_input");
  assert.match(result.reason.message, /precision.backend/);
});
