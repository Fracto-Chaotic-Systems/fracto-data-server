import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";

import { record_runtime_metric } from "../../../utils/windowed_metrics.js";

const bounded_integer = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min ? Math.min(parsed, max) : fallback;
};
const default_size = Math.max(1, Math.min(2, availableParallelism() - 1));

export class WorkerPoolOverloadedError extends Error {
  constructor() {
    super("Compute worker queue is full");
    this.name = "WorkerPoolOverloadedError";
    this.code = "WORKER_POOL_OVERLOADED";
  }
}

export class WorkerTaskCancelledError extends Error {
  constructor() {
    super("Compute worker task was cancelled");
    this.name = "WorkerTaskCancelledError";
    this.code = "WORKER_TASK_CANCELLED";
  }
}

/** Bounded task pool for CPU-bound work, with Promise and Node callback APIs. */
export class WorkerTaskPool {
  constructor({
    worker_url = new URL("./data_compute_worker.js", import.meta.url),
    size = bounded_integer(process.env.FRACTO_DATA_WORKER_THREADS, default_size, 1, 4),
    max_queue = bounded_integer(process.env.FRACTO_DATA_WORKER_QUEUE_LIMIT, 32, 0, 256),
    task_timeout_ms = bounded_integer(process.env.FRACTO_DATA_WORKER_TIMEOUT_MS, 30_000, 1, 300_000),
    create_worker = (url) => new Worker(url),
    record_metric = record_runtime_metric,
  } = {}) {
    this.worker_url = worker_url;
    this.max_queue = Math.max(0, max_queue);
    this.task_timeout_ms = Math.max(1, task_timeout_ms);
    this.create_worker = create_worker;
    this.record_metric = record_metric;
    this.queue = [];
    this.next_id = 1;
    this.closed = false;
    this.slots = Array.from({ length: Math.max(1, size) }, () => ({ worker: null, job: null, generation: 0 }));
  }

  run(task, payload, callback, options = {}) {
    const { on_progress, on_started } = options;
    let task_id = null;
    const promise = new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("Compute worker pool is closed"));
      if (!this.slots.some((slot) => !slot.job) && this.queue.length >= this.max_queue) {
        this.record_metric("data_worker_task_duration", 0, "overloaded");
        return reject(new WorkerPoolOverloadedError());
      }
      task_id = this.next_id++;
      this.queue.push({
        id: task_id, task, payload, queued_at: performance.now(), resolve, reject,
        on_progress,
        on_started,
        task_timeout_ms: bounded_integer(options.task_timeout_ms, this.task_timeout_ms, 1, 3_600_000),
      });
      this.pump();
    });
    promise.task_id = task_id;
    if (typeof callback === "function") {
      promise.then((result) => callback(null, result), (error) => callback(error))
        .catch(() => {});
    }
    return promise;
  }

  /** Cancel a queued task or terminate its worker if it is already running. */
  cancel(task_id) {
    if (!Number.isInteger(task_id)) return false;
    const queued_index = this.queue.findIndex((job) => job.id === task_id);
    if (queued_index >= 0) {
      const [job] = this.queue.splice(queued_index, 1);
      job.reject(new WorkerTaskCancelledError());
      return true;
    }
    const slot = this.slots.find((candidate) => candidate.job?.id === task_id);
    if (!slot) return false;
    const job = slot.job;
    const worker = slot.worker;
    slot.job = null;
    slot.worker = null;
    slot.generation += 1;
    clearTimeout(job.timer);
    this.record_metric("data_worker_task_duration", performance.now() - job.started_at, "cancelled");
    job.reject(new WorkerTaskCancelledError());
    worker?.terminate();
    this.pump();
    return true;
  }

  pump() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift();
      this.ensure_worker(slot);
      job.started_at = performance.now();
      this.record_metric("data_worker_task_wait", job.started_at - job.queued_at, "started");
      slot.job = job;
      job.timer = setTimeout(() => this.timeout(slot, job), job.task_timeout_ms);
      slot.worker.ref?.();
      job.on_started?.();
      slot.worker.postMessage({ id: job.id, task: job.task, payload: job.payload });
    }
  }

  ensure_worker(slot) {
    if (slot.worker) return;
    const generation = ++slot.generation;
    const worker = this.create_worker(this.worker_url);
    worker.unref?.();
    slot.worker = worker;
    worker.on("message", (message) => {
      if (slot.generation !== generation || !slot.job || message?.id !== slot.job.id) return;
      if (message.progress) {
        slot.job.on_progress?.(message.progress);
        return;
      }
      const job = slot.job;
      slot.job = null;
      clearTimeout(job.timer);
      slot.worker.unref?.();
      const elapsed = performance.now() - job.started_at;
      if (message.error) {
        this.record_metric("data_worker_task_duration", elapsed, "error");
        job.reject(new Error("Compute worker task failed"));
      } else {
        this.record_metric("data_worker_task_duration", elapsed, "success");
        job.resolve(message.result);
      }
      this.pump();
    });
    worker.on("error", () => this.fail(slot, generation, "Compute worker failed"));
    worker.on("exit", (code) => {
      if (slot.generation !== generation || this.closed) return;
      slot.worker = null;
      if (slot.job) this.fail(slot, generation, `Compute worker exited (${code})`);
      this.pump();
    });
  }

  timeout(slot, job) {
    if (slot.job !== job) return;
    const worker = slot.worker;
    slot.job = null;
    slot.worker = null;
    slot.generation += 1;
    this.record_metric("data_worker_task_duration", performance.now() - job.started_at, "timeout");
    job.reject(new Error("Compute worker task timed out"));
    worker?.terminate();
    this.pump();
  }

  fail(slot, generation, message) {
    if (slot.generation !== generation || this.closed) return;
    const job = slot.job;
    slot.job = null;
    slot.worker = null;
    if (job) {
      clearTimeout(job.timer);
      this.record_metric("data_worker_task_duration", performance.now() - job.started_at, "error");
      job.reject(new Error(message));
    }
    this.pump();
  }

  async close() {
    this.closed = true;
    this.queue.splice(0).forEach((job) => job.reject(new Error("Compute worker pool is closed")));
    await Promise.all(this.slots.map(async (slot) => {
      if (slot.job) {
        clearTimeout(slot.job.timer);
        slot.job.reject(new Error("Compute worker pool is closed"));
        slot.job = null;
      }
      const worker = slot.worker;
      slot.worker = null;
      if (worker) await worker.terminate();
    }));
  }
}

export const data_compute_worker_pool = new WorkerTaskPool();
