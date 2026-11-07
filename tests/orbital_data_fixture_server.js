import express from "express";
import { WorkerTaskPool } from "../handlers/worker_task_pool.js";
import {
  OrbitalDataStore,
  open_orbital_database,
} from "../handlers/orbital_data_store.js";
import { OrbitalDiscoveryJobs } from "../handlers/orbital_data_jobs.js";
import { create_orbital_data_router } from "../handlers/orbital_data_routes.js";
import { create_data_request_authorizer } from "../handlers/data_requests/authorization.js";
import { create_orbital_database_pool } from "../handlers/orbital_data_database.js";
import { setTimeout as pause } from "node:timers/promises";

// This isolated HTTP service is launched only by the opt-in verification command.
if (
  process.send &&
  /^fracto_orbital_verify_[a-f0-9]{12}$/.test(
    process.env.ORBITAL_VERIFY_SCHEMA || "",
  )
) {
  const target_pool = await create_orbital_database_pool(
    process.env.ORBITAL_VERIFY_SCHEMA,
  );
  const open = () => target_pool.getConnection();
  const pool = new WorkerTaskPool({ size: 2 });
  const store = new OrbitalDataStore({
    open,
    source_open: open_orbital_database,
  });
  const jobs = new OrbitalDiscoveryJobs({ store, pool });
  const delay = Math.min(
    1000,
    Number(process.env.ORBITAL_VERIFY_CHECKPOINT_DELAY_MS || 0),
  );
  if (delay > 0) {
    const compute = pool.run.bind(pool),
      save = store.save_checkpoint.bind(store);
    pool.run = (name, payload, callback, options = {}) => {
      process.send({
        event: "task",
        name,
        orbital_id: payload.orbital?.id,
        processed:
          payload.checkpoint?.processed ??
          payload.scan?.tested_pixels?.length ??
          0,
      });
      return compute(name, payload, callback, {
        ...options,
        on_started: (worker) => {
          options.on_started?.(worker);
          process.send({ event: "worker", affinity: options.affinity, ...worker });
        },
      });
    };
    store.save_checkpoint = async (id, checkpoint, token) => {
      await save(id, checkpoint, token);
      process.send({
        event: "checkpoint",
        id,
        stage: checkpoint.stage,
        scan_count: checkpoint.scan?.tested_pixels?.length ?? 0,
        ray_index: checkpoint.ray_index,
        ray_processed: checkpoint.ray_state?.processed ?? 0,
        ray_count: checkpoint.ray_state?.rays?.length ?? 0,
      });
      await pause(delay);
    };
  }
  const app = express();
  app.use(express.json());
  app.use(
    "/orbital-data",
    create_orbital_data_router({
      jobs,
      authorize: create_data_request_authorizer({ env: {} }),
    }),
  );
  const server = app.listen(0, "127.0.0.1", () =>
    process.send({ port: server.address().port }),
  );
  process.on("SIGTERM", async () => {
    for (const [id] of jobs.active) await jobs.cancel(id).catch(() => {});
    await pool.close();
    await target_pool.end();
    server.close(() => process.exit(0));
  });
}
