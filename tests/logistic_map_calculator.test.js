import test from "node:test";
import assert from "node:assert/strict";
import {
  calculate_logistic_orbit,
  LOGISTIC_MAP_CHECKPOINT_INTERVAL,
} from "../handlers/logistic_map/calculator.js";

const logistic_step = (r, x) => r * x * (1 - x);

test("returns states from the transient boundary through the iteration cap", () => {
  const result = calculate_logistic_orbit(3.2, {
    iteration_cap: 5,
    transient_limit: 2,
  });
  const expected = [0.5];
  for (let iteration = 1; iteration <= 5; iteration += 1) {
    expected.push(logistic_step(3.2, expected.at(-1)));
  }

  assert.equal(result.status, "sampled_unresolved");
  assert.deepEqual(result.reason, {
    code: "iteration_cap_reached",
    message: "The iteration cap was reached without a validated cycle candidate",
  });
  assert.equal(result.iterations_completed, 5);
  assert.deepEqual(result.iteration_counts, {
    iteration_cap: 5,
    iterations_attempted: 5,
    iterations_completed: 5,
    transient_iterations_discarded: 2,
    retained_sample_count: 4,
  });
  assert.equal(result.sample.start_iteration, 2);
  assert.equal(result.sample.end_iteration, 5);
  assert.deepEqual(result.sample.values, expected.slice(2));
});

test("includes x0 when no transient is discarded", () => {
  const result = calculate_logistic_orbit("3.25", {
    iteration_cap: 2,
    transient_limit: 0,
  });

  assert.deepEqual(result.sample.values, [
    0.5,
    logistic_step(3.25, 0.5),
    logistic_step(3.25, logistic_step(3.25, 0.5)),
  ]);
  assert.equal(result.sample.start_iteration, 0);
});

test("uses an explicit reproducible seed and includes calculation provenance", () => {
  const result = calculate_logistic_orbit(3.5, {
    iteration_cap: 4,
    transient_limit: 3,
    seed_policy: { type: "explicit", x0: 0.2 },
  });

  assert.equal(result.r.represented_text, "3.5");
  assert.equal(result.settings.precision.significant_digits, 16);
  assert.equal(result.settings.iteration_cap, 4);
  assert.equal(result.settings.transient_limit, 3);
  assert.deepEqual(result.settings.seed_policy, { type: "explicit", x0: 0.2 });
  assert.equal(result.sample.values.length, 2);
});

test("returns a bounded sample for the default iteration cap", () => {
  const result = calculate_logistic_orbit(3);

  assert.equal(result.sample.values.length, 10_000);
  assert.equal(result.sample.start_iteration, result.settings.iteration_cap - 9_999);
  assert.equal(result.sample.end_iteration, result.settings.iteration_cap);
  assert.ok(result.sample.values.every(Number.isFinite));
});

test("diagnostic callers can disable sample retention", () => {
  const result = calculate_logistic_orbit(3.5, {
    iteration_cap: 100,
    transient_limit: 10,
    retain_sample: false,
  });

  assert.deepEqual(result.sample, { start_iteration: null, end_iteration: null, values: [] });
  assert.equal(result.iteration_counts.retained_sample_count, 0);
});

test("uses the expanded checkpoint interval without enlarging the retained sample", () => {
  const result = calculate_logistic_orbit(3.9, {
    iteration_cap: 120_000,
    transient_limit: 0,
    retain_sample: true,
  });

  assert.equal(LOGISTIC_MAP_CHECKPOINT_INTERVAL, 100_000);
  assert.equal(result.cycle_detection.checkpoint_interval, 100_000);
  assert.equal(result.sample.values.length, 10_000);
});

test("reports an attracting period-two orbit as a confirmed numerical candidate", () => {
  const result = calculate_logistic_orbit(3.2, {
    iteration_cap: 10_000,
    transient_limit: 100,
  });

  assert.equal(result.status, "cycle_candidate");
  assert.equal(result.cycle.period, 2);
  assert.equal(result.cycle.primitive, true);
  assert.ok(result.cycle.return_residual <= result.settings.cycle_tolerance);
  assert.equal(result.cycle.confirmation_returns,
    result.settings.cycle_confirmation_returns);
});

test("detects the primitive period-four cycle instead of a divisor", () => {
  const result = calculate_logistic_orbit(3.5, {
    iteration_cap: 10_000,
    transient_limit: 100,
  });

  assert.equal(result.status, "cycle_candidate");
  assert.equal(result.cycle.period, 4);
  assert.equal(result.cycle.points.length, 4);
  assert.equal(result.cycle.primitive, true);
  assert.ok(result.cycle.return_residual <= result.settings.cycle_tolerance);
});

test("leaves a chaotic orbit unresolved when no candidate passes confirmation", () => {
  const result = calculate_logistic_orbit(3.9, {
    iteration_cap: 5_000,
    transient_limit: 100,
  });

  assert.equal(result.status, "sampled_unresolved");
  assert.equal(result.cycle, null);
  assert.equal(result.sample.end_iteration, 5_000);
  assert.equal(result.reason.code, "iteration_cap_reached");
  assert.equal(result.seed.x0, 0.5);
  assert.equal(result.settings.precision.significant_digits, 16);
  assert.equal(result.iteration_counts.iteration_cap, 5_000);
});

test("returns structured invalid-input state for an out-of-range parameter", () => {
  const result = calculate_logistic_orbit(4);

  assert.equal(result.status, "invalid_input");
  assert.equal(result.reason.code, "invalid_calculation_request");
  assert.match(result.reason.message, /3 <= r < 4/);
  assert.equal(result.r.represented_value, 4);
  assert.equal(result.settings, null);
  assert.deepEqual(result.iteration_counts, {
    iteration_cap: null,
    iterations_attempted: 0,
    iterations_completed: 0,
    transient_iterations_discarded: 0,
    retained_sample_count: 0,
  });
});
