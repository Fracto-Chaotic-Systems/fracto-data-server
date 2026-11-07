import { fail, discovery_request } from "./orbital_data_contract.js";
import { data_compute_worker_pool } from "./worker_task_pool.js";
import { OrbitalDataStore } from "./orbital_data_store.js";

/** Work advances only after its durable checkpoint commits. Tokens fence old owners. */
export class OrbitalDiscoveryJobs {
  constructor({
    store = new OrbitalDataStore(),
    pool = data_compute_worker_pool,
    max_jobs = 4,
    run_timeout_ms = 7200000,
    task_timeout_ms = 3600000,
  } = {}) {
    Object.assign(this, {
      store,
      pool,
      max_jobs,
      run_timeout_ms,
      task_timeout_ms,
    });
    this.active = new Map();
    this.pending_starts = 0;
  }
  async latest(source_id) {
    const source = await this.store.source(source_id);
    return this.store.latest_job(
      source,
      discovery_request({ free_bailiwick_id: source_id }),
    );
  }
  async start(request) {
    const source = await this.store.source(request.source_id);
    const existing = await this.store.lookup_run(source, request);
    if (existing) {
      const row = await this.store.get_run(existing);
      if (
        row.status === "completed" ||
        (row.status === "partial" && !row.resumable)
      )
        return row;
      return this.resume(existing);
    }
    return this.admit(async () => {
      const run = await this.store.create_run(source, request);
      return this.launch(run.id);
    });
  }
  async resume(id) {
    const previous = this.active.get(id);
    if (previous) {
      const run = await this.store.get_run(id);
      if (["queued", "running"].includes(run.status)) throw fail("bailiwick_busy", 409);
      this.pool.cancel(previous.task_id);
      await previous.completion;
    }
    return this.admit(() => this.launch(id));
  }
  async admit(operation) {
    if (
      this.active.size + this.pending_starts >= this.max_jobs ||
      (this.pool.slots?.every((slot) => slot.job) &&
        this.pool.queue.length >= this.pool.max_queue)
    )
      throw fail("worker_queue_full", 503);
    this.pending_starts++;
    try {
      return await operation();
    } finally {
      this.pending_starts--;
    }
  }
  async launch(id) {
    const claimed = await this.store.claim_run(id);
    if (!claimed.owned) return this.store.get_run(id);
    const state = {
      task_id: null,
      stage: "queued",
      token: claimed.token,
      affinity: `orbital:${id}:${claimed.token}`,
      progress: claimed.checkpoint.progress,
      deadline: Date.now() + this.run_timeout_ms,
    };
    this.active.set(id, state);
    state.deadline_timer = setTimeout(() => {
      state.time_limited = true;
      this.pool.cancel(state.task_id);
    }, this.run_timeout_ms);
    state.deadline_timer.unref?.();
    state.timer = setInterval(() => {
      this.store.heartbeat(id, state.token).catch((error) => {
        if (error.code === "job_not_active") this.pool.cancel(state.task_id);
      });
    }, 20000);
    state.timer.unref?.();
    state.completion = this.execute(
      id,
      claimed.source,
      claimed.settings,
      state,
      claimed.checkpoint,
    ).finally(() => {
      clearInterval(state.timer);
      clearTimeout(state.deadline_timer);
      this.pool.release?.(state.affinity);
      if (this.active.get(id) === state) this.active.delete(id);
    });
    state.completion.catch(() => {});
    return this.store.get_run(id);
  }
  async task(id, state, name, payload, stage) {
    let remaining = state.deadline - Date.now();
    if (remaining <= 0) throw fail("discovery_time_limit", 409);
    state.stage = stage;
    await this.store.checkpoint(
      id,
      stage,
      state.progress,
      "running",
      null,
      state.token,
    );
    remaining = state.deadline - Date.now();
    if (remaining <= 0) throw fail("discovery_time_limit", 409);
    const promise = this.pool.run(name, payload, undefined, {
      affinity: state.affinity,
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
            .then(() =>
              this.store.checkpoint(
                id,
                stage,
                snapshot,
                "running",
                null,
                state.token,
              ),
            )
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

  async execute(id, source, settings, state, checkpoint) {
    const cp = checkpoint;
    const commit = () => this.store.save_checkpoint(id, cp, state.token);
    try {
      while (cp.stage !== "done") {
        if (Date.now() >= state.deadline)
          throw fail("discovery_time_limit", 409);
        if (cp.stage === "survey") {
          const batch = await this.task(
            id,
            state,
            "orbital_survey_rows",
            {
              parameter: source.parameter,
              settings,
              row_start: cp.survey_rows.length,
            },
            "discovering",
          );
          cp.survey_rows.push(...batch.rows);
          Object.assign(state.progress, {
            phase: "survey",
            survey_processed: batch.next_row * settings.grid_size,
            survey_total: settings.grid_size ** 2,
          });
          if (batch.next_row === settings.grid_size) cp.stage = "scan";
          await commit();
          continue;
        }
        if (cp.stage === "scan") {
          const batch = await this.task(
            id,
            state,
            "orbital_survey_scan",
            {
              parameter: source.parameter,
              settings,
              rows: cp.survey_rows,
              scan: cp.scan,
            },
            "discovering",
          );
          cp.scan = batch.scan;
          Object.assign(state.progress, {
            phase: "scan",
            scan_processed: batch.progress.processed,
            scan_total: batch.progress.total,
            attempts: batch.progress.processed,
          });
          if (batch.done) {
            cp.candidates = batch.candidates;
            cp.stage = "persisting";
            Object.assign(state.progress, {
              expected_orbitals: cp.candidates.length,
              scan_complete: true,
            });
            // Ranking is final; only its selected candidates are needed from here.
            cp.survey_rows = null;
            cp.scan = null;
          }
          await commit();
          continue;
        }
        if (cp.stage === "persisting") {
          if (cp.persist_index < cp.candidates.length) {
            state.stage = "persisting";
            await this.store.checkpoint(
              id,
              state.stage,
              state.progress,
              "running",
              null,
              state.token,
            );
            const candidate = cp.candidates[cp.persist_index];
            candidate.discovery_metadata = {
              ...candidate.discovery_metadata,
              run_id: id,
            };
            const saved = await this.store.save_orbital(
              id,
              source,
              candidate,
              state.token,
            );
            if (cp.orbitals.some((orbital) => orbital.id === saved.id))
              throw fail("duplicate_survey_identity", 409);
            cp.orbitals.push(saved);
            cp.persist_index++;
            state.progress.orbital_count = cp.orbitals.length;
          } else {
            cp.stage = "rays";
            Object.assign(state.progress, {
              phase: "rays",
              ray_orbitals_total: cp.orbitals.length,
              ray_orbitals_processed: cp.ray_index,
              ray_families_processed: 0,
              ray_families_total: 0,
            });
          }
          await commit();
          continue;
        }
        if (cp.stage !== "rays") throw fail("checkpoint_invalid_phase", 409);
        if (cp.ray_index === cp.orbitals.length) {
          cp.stage = "done";
          await commit();
          continue;
        }
        const orbital = cp.orbitals[cp.ray_index];
        if (!cp.ray_result) {
          const result = await this.task(
            id,
            state,
            "orbital_landing_ratios",
            {
              parameter: source.parameter,
              orbital,
              settings,
              checkpoint: cp.ray_state,
              work_limit: 1,
            },
            "calculating_rays",
          );
          if (result.checkpoint) {
            cp.ray_state = result.checkpoint;
            Object.assign(state.progress, {
              phase: "rays",
              ray_families_processed: result.progress.processed,
              ray_families_total: result.progress.total,
            });
            await commit();
            continue;
          }
          // Commit the completed calculation before publishing ratios. A crash
          // during/after SQL publication only replays an idempotent save.
          cp.ray_result = result;
          await commit();
        }
        state.stage = "persisting";
        await this.store.checkpoint(
          id,
          state.stage,
          state.progress,
          "running",
          null,
          state.token,
        );
        await this.store.save_rays(id, orbital, cp.ray_result, state.token);
        const rays = cp.ray_result;
        state.progress.ratios += rays.ratios.length;
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
          cp.limited = true;
        cp.ray_index++;
        cp.ray_state = null;
        cp.ray_result = null;
        Object.assign(state.progress, {
          ray_orbitals_processed: cp.ray_index,
          ray_families_processed: 0,
          ray_families_total: 0,
        });
        await commit();
      }
      Object.assign(state.progress, {
        search_complete: !cp.limited,
        all_orbitals_discovered: false,
      });
      const status = cp.limited ? "partial" : "completed";
      await this.store.checkpoint(
        id,
        status,
        state.progress,
        status,
        null,
        state.token,
      );
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
              : [
                    "discovery_time_limit",
                    "checkpoint_size_limit",
                    "checkpoint_version_mismatch",
                  ].includes(error.code)
                ? error.code
                : "discovery_stage_failed";
      const status = cp.orbitals.length ? "partial" : "failed";
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
          state.token,
        );
      } catch {
        /* The durable checkpoint remains usable after storage recovery. */
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
