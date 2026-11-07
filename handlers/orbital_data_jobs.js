import { fail } from "./orbital_data_contract.js";
import { data_compute_worker_pool } from "./worker_task_pool.js";
import { OrbitalDataStore } from "./orbital_data_store.js";

/** Durable run records, process-local worker ownership, and bounded SDK stages. */
export class OrbitalDiscoveryJobs {
  constructor({
    store = new OrbitalDataStore(),
    pool = data_compute_worker_pool,
    max_jobs = 4,
    run_timeout_ms = 7200000,
    task_timeout_ms = 3600000,
  } = {}) {
    this.store = store;
    this.pool = pool;
    this.max_jobs = max_jobs;
    this.run_timeout_ms = run_timeout_ms;
    this.task_timeout_ms = task_timeout_ms;
    this.active = new Map();
    this.pending_starts = 0;
  }
  async start(request) {
    if (
      this.active.size + this.pending_starts >= this.max_jobs ||
      (this.pool.slots?.every((slot) => slot.job) &&
        this.pool.queue.length >= this.pool.max_queue)
    )
      throw fail("worker_queue_full", 503);
    this.pending_starts++;
    let source, run;
    try {
      source = await this.store.source(request.source_id);
      run = await this.store.create_run(source, request);
    } finally {
      this.pending_starts--;
    }
    if (run.reused) return this.store.get_run(run.id);
    const state = {
      task_id: null,
      stage: "queued",
      progress: { attempts: 0, orbital_count: 0, ratios: 0, ray_outcomes: {} },
      deadline: Date.now() + this.run_timeout_ms,
    };
    this.active.set(run.id, state);
    state.deadline_timer = setTimeout(() => {
      state.time_limited = true;
      this.pool.cancel(state.task_id);
    }, this.run_timeout_ms);
    state.deadline_timer.unref?.();
    state.timer = setInterval(() => {
      this.store.heartbeat(run.id).catch((error) => {
        if (error.code === "job_not_active") this.pool.cancel(state.task_id);
      });
    }, 20000);
    state.timer.unref?.();
    state.completion = this.execute(
      run.id,
      source,
      request.settings,
      state,
    ).finally(() => {
      clearInterval(state.timer);
      clearTimeout(state.deadline_timer);
      this.active.delete(run.id);
    });
    // execute owns error reporting; no unhandled rejection escapes an HTTP request.
    state.completion.catch(() => {});
    return this.store.get_run(run.id);
  }
  async task(id, state, name, payload, stage) {
    let remaining = state.deadline - Date.now();
    if (remaining <= 0) throw fail("discovery_time_limit", 409);
    state.stage = stage;
    await this.store.checkpoint(id, stage, state.progress);
    remaining = state.deadline - Date.now();
    if (remaining <= 0) throw fail("discovery_time_limit", 409);
    const promise = this.pool.run(name, payload, undefined, {
      task_timeout_ms: Math.min(this.task_timeout_ms, remaining),
      on_progress: (progress) => {
        if (!this.active.has(id)) return;
        const old_phase = state.progress.phase;
        if (progress.phase === "survey")
          Object.assign(state.progress, {
            phase: "survey",
            survey_processed: progress.processed,
            survey_total: progress.total,
          });
        else if (progress.phase === "scan")
          Object.assign(state.progress, {
            phase: "scan",
            scan_processed: progress.processed,
            scan_total: progress.total,
          });
        else if (progress.phase === "rays")
          Object.assign(state.progress, {
            phase: "rays",
            ray_families_processed: progress.processed,
            ray_families_total: progress.total,
          });
        if (
          Date.now() - (state.last_progress_write || 0) >= 1000 ||
          old_phase !== state.progress.phase
        ) {
          state.last_progress_write = Date.now();
          const snapshot = JSON.parse(JSON.stringify(state.progress));
          state.progress_write = (state.progress_write || Promise.resolve())
            .then(() => this.store.checkpoint(id, stage, snapshot))
            .catch(() => {});
        }
      },
    });
    state.task_id = promise.task_id;
    try {
      return await promise;
    } finally {
      state.task_id = null;
      await state.progress_write;
    }
  }
  async execute(id, source, settings, state) {
    const orbitals = [];
    let limited = false;
    try {
      const result = await this.task(
        id,
        state,
        "orbital_survey_discovery",
        { parameter: source.parameter, settings },
        "discovering",
      );
      Object.assign(state.progress, {
        phase: "scan",
        attempts: result.attempts,
        survey_processed: result.samples,
        survey_total: result.samples,
        scan_processed: result.sampled_candidates,
        scan_total: result.sampled_candidates,
        expected_orbitals: result.candidates.length,
        scan_complete: true,
      });
      for (const candidate of result.candidates) {
        if (Date.now() >= state.deadline)
          throw fail("discovery_time_limit", 409);
        state.stage = "persisting";
        await this.store.checkpoint(id, state.stage, state.progress);
        candidate.discovery_metadata = {
          ...candidate.discovery_metadata,
          run_id: id,
        };
        const saved = await this.store.save_orbital(id, source, candidate);
        if (orbitals.some((orbital) => orbital.id === saved.id))
          throw fail("duplicate_survey_identity", 409);
        orbitals.push(saved);
        state.progress.orbital_count = orbitals.length;
      }
      state.progress.ray_orbitals_total = orbitals.length;
      state.progress.ray_orbitals_processed = 0;
      for (const orbital of orbitals) {
        const rays = await this.task(
          id,
          state,
          "orbital_landing_ratios",
          { parameter: source.parameter, orbital, settings },
          "calculating_rays",
        );
        state.stage = "persisting";
        await this.store.checkpoint(id, state.stage, state.progress);
        await this.store.save_rays(id, orbital, rays);
        state.progress.ratios += rays.ratios.length;
        state.progress.ray_orbitals_processed++;
        state.progress.ray_outcomes[rays.status] =
          (state.progress.ray_outcomes[rays.status] || 0) + 1;
        if (
          rays.metadata.search?.budget_reached ||
          [
            "unresolved",
            "period_limit",
            "closure_failed",
            "branch_changed",
            "family_limit",
            "no_rays",
          ].includes(rays.status)
        )
          limited = true;
      }
      state.progress.search_complete = !limited;
      state.progress.all_orbitals_discovered = false;
      const status = limited ? "partial" : "completed";
      await this.store.checkpoint(id, status, state.progress, status);
    } catch (error) {
      if (error.code === "job_not_active") return;
      const code = state.time_limited
        ? "discovery_time_limit"
        : error.code === "WORKER_POOL_OVERLOADED"
          ? "worker_queue_full"
          : error.code === "WORKER_TASK_CANCELLED"
            ? "worker_cancelled"
            : error.message === "Compute worker task timed out"
              ? "worker_time_limit"
              : error.code === "discovery_time_limit"
                ? error.code
                : "discovery_stage_failed";
      const status = orbitals.length ? "partial" : "failed";
      try {
        await this.store.checkpoint(
          id,
          status,
          {
            ...state.progress,
            search_complete: false,
            all_orbitals_discovered: false,
          },
          status,
          code,
        );
      } catch {
        /* An expired durable lease reports interruption if storage is unavailable. */
      }
    }
  }
  async cancel(id) {
    const run = await this.store.cancel(id);
    const state = this.active.get(id);
    if (state && run.status === "cancelled") this.pool.cancel(state.task_id);
    return run;
  }
}
