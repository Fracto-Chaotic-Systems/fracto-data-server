import test from "node:test";
import assert from "node:assert/strict";
import {
  create_logistic_map_result,
  LOGISTIC_MAP_DEFAULTS,
  normalize_logistic_map_request,
} from "../handlers/logistic_map/calculation_contract.js";

test("normalizes the default critical-point request and reports represented r", () => {
  const request = normalize_logistic_map_request("3.5000000000000001");

  assert.equal(request.r.input, "3.5000000000000001");
  assert.equal(request.r.represented_value, 3.5);
  assert.equal(request.r.represented_text, "3.5");
  assert.deepEqual(request.settings, {
    precision: { backend: "number", significant_digits: 16 },
    iteration_cap: LOGISTIC_MAP_DEFAULTS.iteration_cap,
    transient_limit: LOGISTIC_MAP_DEFAULTS.transient_limit,
    cycle_tolerance: LOGISTIC_MAP_DEFAULTS.cycle_tolerance,
    cycle_confirmation_returns: LOGISTIC_MAP_DEFAULTS.cycle_confirmation_returns,
    seed_policy: { type: "critical_point", x0: 0.5 },
  });
});

test("accepts explicit settings and preserves them in the result envelope", () => {
  const request = normalize_logistic_map_request(3.2, {
    precision: { backend: "number", significant_digits: 16 },
    iteration_cap: 500,
    transient_limit: 100,
    seed_policy: { type: "explicit", x0: 0.25 },
  });
  const result = create_logistic_map_result(request, {
    status: "sampled_unresolved",
    r: "incorrect payload value",
    settings: { changed: true },
  });

  assert.equal(result.r.represented_value, 3.2);
  assert.equal(result.settings.iteration_cap, 500);
  assert.equal(result.settings.transient_limit, 100);
  assert.deepEqual(result.settings.seed_policy, { type: "explicit", x0: 0.25 });
  assert.equal(result.status, "sampled_unresolved");
});

test("rejects parameters outside [3, 4) and malformed numeric inputs", () => {
  for (const r of [2.999, 4, "4", "3.2x", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalize_logistic_map_request(r));
  }
  assert.equal(normalize_logistic_map_request(3).r.represented_value, 3);
});

test("validates precision, iteration limits, transient limits, and seeds", () => {
  assert.throws(() => normalize_logistic_map_request(3.5, {
    precision: { backend: "decimal", significant_digits: 50 },
  }), /precision.backend/);
  assert.throws(() => normalize_logistic_map_request(3.5, { iteration_cap: 0 }));
  assert.throws(() => normalize_logistic_map_request(3.5, {
    iteration_cap: 100,
    transient_limit: 100,
  }));
  assert.throws(() => normalize_logistic_map_request(3.5, { cycle_tolerance: 0 }));
  assert.throws(() => normalize_logistic_map_request(3.5, {
    cycle_tolerance: Number.EPSILON / 2,
  }));
  assert.throws(() => normalize_logistic_map_request(3.5, { cycle_confirmation_returns: 0 }));
  assert.throws(() => normalize_logistic_map_request(3.5, {
    seed_policy: { type: "explicit", x0: 1.1 },
  }));
});
