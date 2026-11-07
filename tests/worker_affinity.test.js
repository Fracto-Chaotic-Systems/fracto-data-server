import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WorkerTaskPool } from "../handlers/worker_task_pool.js";

const fixture = (size = 2) => {
  const workers = [];
  class FakeWorker extends EventEmitter {
    postMessage(message) { this.message = message; }
    ref() {}
    unref() {}
    async terminate() { this.terminated = true; }
    finish() { this.emit("message", { id: this.message.id, result: this.threadId }); }
  }
  const pool = new WorkerTaskPool({
    size,
    create_worker: () => {
      const worker = new FakeWorker();
      worker.threadId = workers.length + 1;
      workers.push(worker);
      return worker;
    },
    record_metric: () => {},
  });
  const run = (affinity) => pool.run("batch", {}, undefined, { affinity });
  return { pool, workers, run };
};

test("a reserved worker survives checkpoint gaps while different jobs use other workers", async () => {
  const { pool, workers, run } = fixture();
  try {
    const first = run("orbital-a");
    workers[0].finish();
    assert.equal(await first, 1);
    const other = run("orbital-b");
    assert.equal(workers.length, 2);
    const next = run("orbital-a");
    workers[0].finish();
    assert.equal(await next, 1);
    workers[1].finish();
    assert.equal(await other, 2);
    const waiting = run("orbital-c");
    assert.equal(pool.queue.length, 1);
    pool.release("orbital-b");
    workers[1].finish();
    assert.equal(await waiting, 2);
    pool.release("orbital-a");
    pool.release("orbital-c");
  } finally { await pool.close(); }
});

test("a dead worker cannot silently be replaced within its assigned execution", async () => {
  const { pool, workers, run } = fixture(1);
  try {
    const first = run("attempt-1");
    workers[0].finish();
    await first;
    workers[0].emit("exit", 1); // Failure during a durable checkpoint gap.
    await assert.rejects(run("attempt-1"), /Assigned compute worker failed/);
    assert.equal(workers.length, 1);
    pool.release("attempt-1");
    const resumed = run("attempt-2");
    assert.equal(workers.length, 2);
    workers[1].finish();
    assert.equal(await resumed, 2);
    pool.release("attempt-2");
  } finally { await pool.close(); }
});

test("worker failure fences active batches and cancellation releases a reservation only at execution end", async () => {
  const { pool, workers, run } = fixture(1);
  try {
    const failed = run("attempt-1");
    const rejected = assert.rejects(failed, /Compute worker failed/);
    workers[0].emit("error", new Error("crash"));
    await rejected;
    await assert.rejects(run("attempt-1"), /Assigned compute worker failed/);
    pool.release("attempt-1");
    const cancelled = run("attempt-2");
    const cancellation = assert.rejects(cancelled, { code: "WORKER_TASK_CANCELLED" });
    pool.cancel(cancelled.task_id);
    await cancellation;
    const other = run("other");
    assert.equal(pool.queue.length, 1);
    pool.release("attempt-2");
    workers[2].finish();
    await other;
    pool.release("other");
  } finally { await pool.close(); }
});
