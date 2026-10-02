import assert from "node:assert/strict";
import test from "node:test";

import { WorkerTaskPool } from "../handlers/worker_task_pool.js";
import {
  handle_logistic_map_job_status,
  handle_logistic_map_level_one_start,
} from "../handlers/logistic_map/handle_level_one.js";

const mock_response = () => ({
  status_code: 200,
  headers: {},
  status(code) { this.status_code = code; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  json(body) { this.body = body; return this; },
});

test("level-one diagnostic reports compact progress for all 256 bins", async () => {
  const pool = new WorkerTaskPool({ size: 1, max_queue: 0, task_timeout_ms: 30_000 });
  const progress = [];
  try {
    const result = await pool.run("logistic_map_level_one", {
      iteration_cap: 32,
      transient_limit: 8,
    }, undefined, { on_progress: (update) => progress.push(update) });

    assert.equal(result.outcomes.length, 256);
    assert.equal(progress.filter((update) => update.kind === "parameter_completed").length, 256);
    assert.equal(progress.at(-1).completed, 256);
    assert.equal(progress.at(-1).total, 256);
    assert.equal(result.outcomes[0].r, 3);
    assert.equal(result.outcomes[255].r, 3 + 255 / 256);
    assert.ok(result.outcomes.every((outcome) => !Object.hasOwn(outcome, "sample")));
    assert.ok(result.outcomes.every((outcome) => Number.isFinite(outcome.timing.total_ms)));
  } finally {
    await pool.close();
  }
});

test("diagnostic endpoints return a job id and expose completion rows", async () => {
  const start_response = mock_response();
  handle_logistic_map_level_one_start({ body: { iteration_cap: 16, transient_limit: 4 } }, start_response);
  assert.equal(start_response.status_code, 202);
  assert.equal(start_response.body.progress.total, 256);

  let status_response;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    status_response = mock_response();
    handle_logistic_map_job_status({ params: { job_id: start_response.body.job_id } }, status_response);
    if (status_response.body.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(status_response.status_code, 200);
  assert.equal(status_response.body.status, "completed");
  assert.equal(status_response.body.outcomes.length, 256);
  assert.ok(Number.isFinite(status_response.body.duration_ms));
});
