import assert from "node:assert/strict";
import test from "node:test";

import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
import {
  calculate_seed_survey,
  handle_seed_survey_job,
  handle_orbitals,
  start_seed_survey_job,
} from "../handlers/handle_orbital.js";

test("seed survey samples the inclusive complex grid at 0.025 spacing", () => {
  const calls = [];
  const progress_updates = [];
  const survey = calculate_seed_survey(
    { x: -0.5, y: 0.1 },
    (point, options) => {
      calls.push({ point, options });
      return options.seed.re === "0.500" && options.seed.im === "0.000"
        ? {
            status: "cardinality_detected",
            iterations: 4096,
            detection: { candidate_cardinality: 7, confidence: 0.87 },
            samples: Array.from({ length: 4096 }, (_, index) => ({
              re: index,
              im: index / 2,
            })),
          }
        : {
            status: "cardinality_detected",
            iterations: 4096,
            detection: { candidate_cardinality: 1 },
          };
    },
    (progress) => progress_updates.push(progress.completed),
  );

  assert.equal(calls.length, 14641);
  assert.ok(calls.every(({ options }) =>
    /^-?\d+\.\d{3}$/.test(options.seed.re) && /^-?\d+\.\d{3}$/.test(options.seed.im)
  ));
  assert.deepEqual(calls[0], {
    point: { x: -0.5, y: 0.1 },
    options: {
      detector: "FractoCardinality",
      iterations: 4096,
      maximum_detection_iterations: 4096,
      adaptive_detection: false,
      seed_level: 0.00625,
      seed: { re: "-1.500", im: "-1.500" },
    },
  });
  assert.equal(calls.at(-1).options.seed.re, "1.500");
  assert.equal(calls.at(-1).options.seed.im, "1.500");
  assert.ok(calls.some((call) => call.options.seed.im === "-1.500"));
  assert.ok(calls.some((call) => call.options.seed.im === "1.000"));
  assert.ok(calls.some((call) => call.options.seed.im === "1.500"));
  assert.equal(survey.total_samples, 14641);
  assert.deepEqual(progress_updates.slice(0, 4), [8, 16, 24, 32]);
  assert.equal(progress_updates.at(-1), 14641);
  assert.equal(progress_updates.length, Math.ceil(14641 / 8));
  assert.equal(survey.outcome_counts.non_singleton_candidate, 1);
  assert.equal(survey.outcome_counts.single_point_candidate, 14640);
  assert.equal(survey.step, 0.025);
  assert.equal(survey.real_min, -1.5);
  assert.equal(survey.real_max, 1.5);
  assert.equal(survey.imaginary_min, -1.5);
  assert.equal(survey.imaginary_max, 1.5);
  assert.deepEqual(survey.calculation_settings, {
    detector: "FractoCardinality",
    iterations: 4096,
    maximum_detection_iterations: 4096,
    adaptive_detection: false,
    seed_level: 0.00625,
  });
  assert.equal(survey.stable_count, 1);
  assert.deepEqual(survey.stable_points, [
    { x: 0.5, y: 0, pattern: 7, confidence: 0.87, iterations: 4096 },
  ]);
  assert.ok(survey.orbital_magnitude_range.min <= survey.orbital_magnitude_range.max);
});

test("seed survey passes its bounds and per-sample seed to FractoCardinality", () => {
  const calls = [];
  const survey = calculate_seed_survey(
    { x: 0, y: 0 },
    (point, options) => {
      calls.push({ point, options });
      return {
        status: "cardinality_detected",
        iterations: 4096,
        detection: { candidate_cardinality: 1 },
      };
    },
  );
  assert.equal(calls.length, 14641);
  assert.deepEqual(calls[0], {
    point: { x: 0, y: 0 },
    options: {
      detector: "FractoCardinality",
      iterations: 4096,
      maximum_detection_iterations: 4096,
      adaptive_detection: false,
      seed_level: 0.00625,
      seed: { re: "-1.500", im: "-1.500" },
    },
  });
  assert.equal(survey.outcome_counts.single_point_candidate, 14641);
});

test("live survey progress streams every discovered candidate as a delta", () => {
  let latest_progress;
  const streamed_points = [];
  const survey = calculate_seed_survey(
    { x: -0.5, y: 0.1 },
    () => ({
      status: "cycle_candidate",
      pattern: 2,
      orbital_points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }],
      iteration: 4096,
    }),
    (progress) => {
      latest_progress = progress;
      streamed_points.push(...progress.stable_points);
    },
  );

  assert.equal(survey.stable_points.length, 14641);
  assert.equal(streamed_points.length, 14641);
  assert.equal(latest_progress.stable_points.length, 1);
  assert.deepEqual(latest_progress.stable_points.at(-1), {
    x: 1.5,
    y: 1.5,
    pattern: 2,
    confidence: null,
    iterations: 4096,
  });
});

test("seed survey greys inconclusive results and leaves single-point results blank", () => {
  const survey = calculate_seed_survey(
    { x: 0, y: 0 },
    (point, options) =>
      options.seed.re === "0.000" && options.seed.im === "0.000"
        ? {
            status: "cardinality_inconclusive",
            iterations: 4096,
            escaped: false,
            detection: { candidate_cardinality: 8, confidence: 0.42 },
          }
        : { status: "cardinality_detected", detection: { candidate_cardinality: 1 } },
  );
  assert.equal(survey.stable_count, 0);
  assert.deepEqual(survey.stable_points, []);
  assert.equal(survey.unresolved_points.length, 1);
  assert.deepEqual(survey.unresolved_points[0], {
    x: 0,
    y: 0,
    pattern: 8,
    confidence: 0.42,
    iterations: 4096,
  });
  assert.equal(survey.orbital_magnitude_range, null);
});

test("orbital magnitude range uses the maximum point distance from Q per orbit", () => {
  const survey = calculate_seed_survey(
    { x: 0, y: 0 },
    (_point, options) =>
      options.seed.re === "0.500" && options.seed.im === "0.000"
        ? {
            pattern: 2,
            iteration: 9000,
            status: "cycle_candidate",
            orbital_points: [
              { x: 3, y: 4 },
              { x: 0, y: 2 },
              { x: 3, y: 4 },
            ],
          }
        : { pattern: 1, iteration: 9000 },
  );

  assert.deepEqual(survey.orbital_magnitude_range, { min: 5, max: 5 });
});

test("/orbitals preserves the legacy zero-seed series and returns its seed survey", () => {
  const original_calc = FractoFastCalc.calc;
  let legacy_calls = 0;
  FractoFastCalc.calc = (re, im) => {
    legacy_calls++;
    assert.equal(re, -0.5);
    assert.equal(im, 0.1);
    return { pattern: 2, iteration: 100, orbital_points: [{ x: 1, y: 0 }, { x: 0, y: 1 }] };
  };
  try {
    let response;
    const res = {
      status(code) {
        assert.equal(code, 200);
        return this;
      },
      json(body) {
        response = body;
      },
    };

    handle_orbitals(
      { query: { re: "-0.5", im: "0.1", limit: "50000" } },
      res,
      {
        start_survey: (parameter) => {
          assert.deepEqual(parameter, { x: -0.5, y: 0.1 });
          return {
            job_id: "survey-1",
            status: "queued",
            progress: { completed: 0, total: 14641 },
          };
        },
      },
    );

    assert.equal(legacy_calls, 1);
    assert.equal(response.result.pro_derived.cardinality, 2);
    assert.equal(
      response.result.pro_derived.cardinality_source,
      "legacy_fracto_fast_calc",
    );
    assert.equal(response.result.seed_survey.job_id, "survey-1");
    assert.equal(response.result.seed_survey.status, "queued");
  } finally {
    FractoFastCalc.calc = original_calc;
  }
});

test("seed survey jobs expose worker progress and completed results", async () => {
  const result = {
    stable_count: 1,
    total_samples: 14641,
    stable_points: [{ x: 0, y: 0, pattern: 2 }],
    orbital_magnitude_range: { min: 0.1, max: 0.2 },
  };
  const worker_pool = {
    run(task, payload, callback, options) {
      assert.equal(task, "orbital_seed_survey");
      assert.deepEqual(payload, { parameter: { x: -0.5, y: 0.1 } });
      assert.equal(callback, undefined);
      options.on_progress({
        completed: 64,
        total: 14641,
        stable_count: 1,
        stable_points: [{ x: 0, y: 0, pattern: 2 }],
        outcome_counts: { non_singleton_candidate: 1 },
      });
      options.on_progress({
        completed: 128,
        total: 14641,
        stable_count: 2,
        stable_points: [{ x: 0.1, y: 0.1, pattern: 3 }],
        unresolved_points: [{ x: 0.2, y: 0.2, pattern: 0 }],
        outcome_counts: { non_singleton_candidate: 2, unresolved: 1 },
      });
      return Promise.resolve(result);
    },
  };
  const initial = start_seed_survey_job({ x: -0.5, y: 0.1 }, worker_pool);
  assert.equal(initial.status, "running");
  assert.equal(initial.total_samples, 14641);
  assert.equal(initial.progress.completed, 128);
  assert.deepEqual(initial.progress.stable_points, [
    { x: 0, y: 0, pattern: 2 },
    { x: 0.1, y: 0.1, pattern: 3 },
  ]);
  assert.deepEqual(initial.progress.unresolved_points, [
    { x: 0.2, y: 0.2, pattern: 0 },
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  let response;
  const res = {
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    json(body) {
      response = body;
    },
  };
  handle_seed_survey_job({ params: { job_id: initial.job_id } }, res);
  assert.equal(response.status, "completed");
  assert.deepEqual(response.result, result);
});

test("new seed survey replaces stale work and reuses an identical focal job", async () => {
  let next_task_id = 1;
  const pending = new Map();
  const cancelled = [];
  const worker_pool = {
    run(_task, _payload, _callback, options) {
      options.on_started();
      let reject_task;
      const promise = new Promise((_resolve, reject) => { reject_task = reject; });
      const task_id = next_task_id++;
      promise.task_id = task_id;
      pending.set(task_id, reject_task);
      return promise;
    },
    cancel(task_id) {
      cancelled.push(task_id);
      pending.get(task_id)?.(Object.assign(new Error("cancelled"), { code: "WORKER_TASK_CANCELLED" }));
      return true;
    },
  };

  const first = start_seed_survey_job({ x: -0.5, y: 0.1 }, worker_pool);
  const duplicate = start_seed_survey_job({ x: -0.5, y: 0.1 }, worker_pool);
  assert.equal(first.job_id, duplicate.job_id);
  assert.deepEqual(cancelled, []);

  const replacement = start_seed_survey_job({ x: -0.4, y: 0.1 }, worker_pool);
  assert.notEqual(replacement.job_id, first.job_id);
  assert.deepEqual(cancelled, [1]);
  await new Promise((resolve) => setImmediate(resolve));

  let old_job;
  handle_seed_survey_job({ params: { job_id: first.job_id } }, {
    status() { return this; },
    json(body) { old_job = body; },
  });
  assert.equal(old_job.status, "cancelled");
});
