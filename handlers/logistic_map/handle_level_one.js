import { randomUUID } from "node:crypto";
import { data_compute_worker_pool, WorkerPoolOverloadedError } from "../worker_task_pool.js";

const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1_000;
const MAX_JOBS = 16;
const DEFAULT_ITERATION_CAP = 1_000_000_000;
const MAX_ITERATION_CAP = 1_000_000_000;

const prune_jobs = () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== "running" && now - job.updated_at > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size >= MAX_JOBS) {
    const oldest_finished = [...jobs.entries()].find(([, job]) => job.status !== "running");
    if (!oldest_finished) return false;
    jobs.delete(oldest_finished[0]);
  }
  return true;
};

const public_job = (job) => ({
  job_id: job.id,
  status: job.status,
  progress: { completed: job.outcomes.length, total: 256 },
  settings: job.settings,
  outcomes: job.outcomes,
  current: job.current,
  error: job.error,
  started_at: job.started_at,
  duration_ms: job.duration_ms,
  updated_at: job.updated_at,
  completed_at: job.completed_at,
});

/** Start an ephemeral, worker-thread diagnostic for the 256 level-one r bins. */
export const handle_logistic_map_level_one_start = (req, res) => {
  prune_jobs();
  if (jobs.size >= MAX_JOBS) {
    res.setHeader("Retry-After", "2");
    return res.status(503).json({ error: "Diagnostic job capacity is full" });
  }

  const iteration_cap = req.body?.iteration_cap ?? DEFAULT_ITERATION_CAP;
  const transient_limit = req.body?.transient_limit ?? Math.min(10_000, iteration_cap - 1);
  if (!Number.isSafeInteger(iteration_cap) || iteration_cap < 2 || iteration_cap > MAX_ITERATION_CAP ||
      !Number.isSafeInteger(transient_limit) || transient_limit < 0 || transient_limit >= iteration_cap) {
    return res.status(400).json({
      error: `iteration_cap must be from 2 to ${MAX_ITERATION_CAP}; transient_limit must be below it`,
    });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const job = {
    id,
    status: "running",
    settings: { range_start: 3, range_end_exclusive: 4, divisions: 256, sampling: "left_edge", iteration_cap, transient_limit },
    outcomes: [],
    current: null,
    error: null,
    started_at: now,
    updated_at: Date.now(),
    completed_at: null,
    duration_ms: null,
  };
  jobs.set(id, job);

  data_compute_worker_pool.run("logistic_map_level_one", { iteration_cap, transient_limit }, undefined, {
    task_timeout_ms: 300_000,
    on_progress: (progress) => {
      if (!jobs.has(id)) return;
      if (progress.kind === "parameter_completed") {
        job.outcomes.push(progress.outcome);
        job.current = null;
      } else {
        job.current = {
          index: progress.index,
          r: progress.r,
          iterations_completed: progress.iterations_completed,
        };
      }
      job.updated_at = Date.now();
    },
  }).then((result) => {
    if (!jobs.has(id)) return;
    job.outcomes = result.outcomes;
    job.status = "completed";
    job.updated_at = Date.now();
    job.completed_at = new Date().toISOString();
    job.duration_ms = result.completed_at - result.started_at;
  }).catch((error) => {
    if (!jobs.has(id)) return;
    job.status = "failed";
    job.error = error instanceof WorkerPoolOverloadedError
      ? "Compute capacity is busy; retry shortly"
      : error.message === "Compute worker task timed out"
        ? "Diagnostic exceeded its worker time limit"
        : "Diagnostic worker failed";
    job.updated_at = Date.now();
    job.completed_at = new Date().toISOString();
  });

  return res.status(202).json(public_job(job));
};

/** Read progress or compact results for a diagnostic running in this process. */
export const handle_logistic_map_job_status = (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (job && job.status !== "running" && Date.now() - job.updated_at > JOB_TTL_MS) {
    jobs.delete(req.params.job_id);
    return res.status(404).json({ error: "Diagnostic job was not found or has expired" });
  }
  if (!job) return res.status(404).json({ error: "Diagnostic job was not found or has expired" });
  return res.status(200).json(public_job(job));
};
