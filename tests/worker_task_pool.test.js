import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  handle_orbital_spectrum,
} from "../handlers/handle_orbital_spectrum.js";
import {
  WorkerTaskPool,
} from "../handlers/worker_task_pool.js";

const response_capture = () => ({
  status_code: 200,
  body: null,
  status(code) { this.status_code = code; return this; },
  setHeader() {},
  json(body) { this.body = body; return this; },
});

test("orbital spectrum runs in a worker and returns its normal HTTP response", async () => {
  const response = response_capture();
  let main_loop_tick = false;
  setTimeout(() => { main_loop_tick = true; }, 0);
  await handle_orbital_spectrum({
    query: { re: "-0.5", im: "0", detection_mode: "returns", iterations: "32" },
  }, response);

  assert.equal(response.status_code, 200);
  assert.equal(response.body.detection_mode, "returns");
  assert.equal(response.body.iterations, 32);
  assert.ok(response.body.detection);
  assert.equal(main_loop_tick, true);
});

test("orbital spectrum preserves validation responses through the worker", async () => {
  const response = response_capture();
  await handle_orbital_spectrum({ query: { re: "nope", im: "0" } }, response);

  assert.equal(response.status_code, 400);
  assert.deepEqual(response.body, { error: "re and im must be finite numbers" });
});

test("worker pool completes callback-style jobs asynchronously", async () => {
  const pool = new WorkerTaskPool({ size: 1, max_queue: 1 });
  try {
    const result = await new Promise((resolve, reject) => {
      pool.run("orbital_spectrum", {
        query: { re: "-0.5", im: "0", detection_mode: "returns", iterations: "16" },
      }, (error, value) => error ? reject(error) : resolve(value));
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.iterations, 16);
  } finally {
    await pool.close();
  }
});

test("worker pool applies backpressure when its bounded queue is full", async () => {
  class FakeWorker extends EventEmitter {
    postMessage(message) { this.message = message; }
    ref() {}
    unref() {}
    async terminate() { return 0; }
  }
  const worker = new FakeWorker();
  const pool = new WorkerTaskPool({
    size: 1,
    max_queue: 0,
    create_worker: () => worker,
    record_metric: () => {},
  });
  const first = pool.run("test", {});
  await assert.rejects(pool.run("test", {}), { code: "WORKER_POOL_OVERLOADED" });
  worker.emit("message", { id: worker.message.id, result: "complete" });
  assert.equal(await first, "complete");
  await pool.close();
});

test("worker executes multi-analysis without blocking the HTTP handler thread", async () => {
  const response = response_capture();
  await handle_orbital_spectrum({
    query: { re: "2", im: "2", multi_analysis: "true", adaptive_analysis: "true" },
  }, response);

  assert.equal(response.status_code, 200);
  assert.ok(response.body.spectrum.multi_analysis.length > 0);
  assert.ok(response.body.spectrum.analysis_diagnostics.length > 0);
});
