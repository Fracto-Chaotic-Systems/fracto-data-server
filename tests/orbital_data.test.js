import assert from "node:assert/strict";
import test from "node:test";
import { WorkerTaskPool } from "../handlers/worker_task_pool.js";
import {
  canonical_orbital,
  same_orbital_cycle,
  orbital_closure_error,
} from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { validate_landing_families } from "@fracto/sdk/orbitals/FractoOrbitalDiscovery.js";
import {
  discovery_request,
  focal_identity,
} from "../handlers/orbital_data_contract.js";
import express from "express";
import { initial_checkpoint } from "../handlers/orbital_data_checkpoint.js";
const claimed = () => ({
  owned: true,
  token: "test",
  checkpoint: initial_checkpoint(),
  source: { id: "55", pattern: 1, parameter: { x: "0", y: "0" } },
  settings: discovery_request({ free_bailiwick_id: 55 }).settings,
});
import { create_orbital_data_router } from "../handlers/orbital_data_routes.js";
import { create_data_request_authorizer } from "../handlers/data_requests/authorization.js";
import { OrbitalDiscoveryJobs } from "../handlers/orbital_data_jobs.js";
import { OrbitalDataStore } from "../handlers/orbital_data_store.js";

const settings = discovery_request({
  free_bailiwick_id: 55,
  settings: { max_period: 1, max_angle_period: 3 },
}).settings;
const parameter = { x: "-0.15652016628927212", y: "1.032247108119819" };

test("actual worker tasks discover distinct same-period cycles and attach complete exact ray families", async () => {
  const pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 30000 });
  try {
    const result = await pool.run("orbital_discovery_batch", {
      parameter,
      period: 1,
      seeds: [
        { x: 0, y: 0 },
        { x: 1.5, y: 0 },
        { x: -1.5, y: 0 },
      ],
      settings,
    });
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.every((o) => o.period === 1));
    assert.equal(
      same_orbital_cycle(
        result.candidates[0].points,
        result.candidates[1].points,
      ),
      false,
    );
    for (const orbital of result.candidates) {
      assert.ok(
        Number(orbital_closure_error(parameter, orbital.points)) <= 1e-24,
      );
      const rays = await pool.run("orbital_landing_ratios", {
        parameter,
        orbital,
        settings,
      });
      assert.equal(rays.status, "rays_found");
      assert.ok(rays.ratios.length > 0);
      validate_landing_families(rays.ratios, orbital.period);
    }
    const ray_led = await pool.run("orbital_discovery_ray_batch", {
      parameter,
      period: 1,
      settings,
    });
    assert.ok(
      ray_led.candidates.some((o) =>
        result.candidates.some((existing) =>
          same_orbital_cycle(o.points, existing.points),
        ),
      ),
    );
  } finally {
    await pool.close();
  }
});

test("cycle identity reduces traversals and permits rotation but keeps distinct roots", () => {
  const c = { x: "-1", y: "0" };
  const points = [
    { re: "0", im: "0" },
    { re: "-1", im: "0" },
  ];
  const orbital = canonical_orbital(c, [...points, ...points]);
  assert.equal(orbital.period, 2);
  assert.ok(same_orbital_cycle(points, orbital.points));
  assert.equal(canonical_orbital(c, [{ re: "1", im: "0" }]), null);
  assert.equal(
    same_orbital_cycle([{ re: "0", im: "0" }], [{ re: "1e-15", im: "0" }]),
    false,
  );
  assert.equal(
    focal_identity({ x: "0.1000", y: "-0" }).focal_key,
    focal_identity({ x: "1e-1", y: "0" }).focal_key,
  );
  const ordered = ["0", "1", "2"].map((re) => ({ re, im: "0" }));
  assert.equal(
    same_orbital_cycle(ordered, [ordered[0], ordered[2], ordered[1]]),
    false,
  );
});

test("discovery accepts only allowlisted, bounded settings and complete landing families", () => {
  assert.throws(() =>
    discovery_request({ free_bailiwick_id: 55, request_key: 123 }),
  );
  for (const settings of [
    { grid_size: 2048 },
    { max_period: 0 },
    { constructor: 1 },
    { max_angle_period: 100 },
    { half_span: NaN },
  ])
    assert.throws(() => discovery_request({ free_bailiwick_id: 55, settings }));
  assert.throws(() =>
    discovery_request({ free_bailiwick_id: "55;DROP TABLE x" }),
  );
  assert.throws(() =>
    discovery_request({ free_bailiwick_id: 55, focal_point: { x: 0, y: 0 } }),
  );
  const ratio = {
    numerator: "1",
    denominator: "3",
    family_key: "1/3",
    angle_period: 2,
    point_index: 0,
    landing_error: 1e-9,
  };
  assert.throws(() => validate_landing_families([ratio], 1), /incomplete/);
  assert.throws(
    () =>
      validate_landing_families(
        [{ ...ratio, numerator: "2", denominator: "6" }],
        1,
      ),
    /invalid/,
  );
});

test("HTTP contracts reject invalid input, protect mutations, and redact storage errors", async () => {
  let starts = 0;
  const jobs = {
    start: async () => {
      starts++;
      return {};
    },
    store: {
      get: async () => {
        throw Object.assign(Error("private database details"), {
          code: "ER_NO_SUCH_TABLE",
        });
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/orbital-data",
    create_orbital_data_router({
      jobs,
      authorize: create_data_request_authorizer({ env: {} }),
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/orbital-data`;
  try {
    let response = await fetch(`${base}/discovery-jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example",
      },
      body: JSON.stringify({ free_bailiwick_id: 55 }),
    });
    assert.equal(response.status, 403);
    response = await fetch(`${base}/discovery-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        free_bailiwick_id: 55,
        settings: { max_period: 10000 },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(starts, 0);
    assert.equal((await fetch(`${base}/discovery-jobs/invalid`)).status, 400);
    assert.equal((await fetch(`${base}?focal_re=NaN&focal_im=0`)).status, 400);
    response = await fetch(`${base}/1`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "orbital_schema_pending",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("browser discovery accepts only a selected bailiwick and configured UI origin", async () => {
  const started = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/orbital-data",
    create_orbital_data_router({
      jobs: {
        start: async (body) => {
          started.push(body);
          return { id: "job" };
        },
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}/orbital-data/bailiwicks/55/discovery-jobs`;
  const origin =
    process.env.FRACTO_UI_ORIGIN ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const send = (request_origin, body) =>
    fetch(url, {
      method: "POST",
      headers: { origin: request_origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await send("https://untrusted.example", {})).status, 403);
    assert.equal((await send(origin, { free_bailiwick_id: 99 })).status, 400);
    assert.equal(
      (await send(origin, { settings: { max_period: 8 } })).status,
      400,
    );
    assert.equal(started.length, 0);
    assert.equal((await send(origin, {})).status, 202);
    assert.equal(started.length, 1);
    assert.equal(started[0].source_id, "55");
    assert.equal(started[0].settings.grid_size, 250);
    assert.equal(started[0].settings.iteration_limit, 100000);
    assert.equal(started[0].settings.max_angle_period, 24);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("source lookup accepts free, inline, and nodal table entries without changing core coordinates", async () => {
  for (const flags of [
    { is_inline: 0, is_node: 0 },
    { is_inline: 1, is_node: 0 },
    { is_inline: 0, is_node: 1 },
  ]) {
    let ended = false;
    const store = new OrbitalDataStore({
      open: async () => ({
        execute: async (sql, values) => {
          assert.equal(
            sql,
            "SELECT id,core_point,pattern FROM free_bailiwicks WHERE id=?",
          );
          assert.deepEqual(values, ["55"]);
          return [
            [
              {
                id: 55,
                core_point: JSON.stringify({
                  x: "0.1234567890123456789",
                  y: "0.2",
                }),
                pattern: 4,
                ...flags,
              },
            ],
          ];
        },
        end: async () => {
          ended = true;
        },
      }),
    });
    const result = await store.source("55");
    assert.equal(result.id, "55");
    assert.equal(result.parameter.x, "0.1234567890123456789");
    assert.equal(ended, true);
  }
});

test("worker admission failures become durable terminal outcomes without saving candidates", async () => {
  const row = { id: "run", status: "queued" };
  const store = {
    source: async () => ({
      id: "55",
      pattern: 1,
      parameter: { x: "0", y: "0" },
    }),
    lookup_run: async () => null,
    create_run: async () => ({ id: "run", reused: false }),
    claim_run: async () => claimed(),
    save_checkpoint: async () => {},
    get_run: async () => ({ ...row }),
    checkpoint: async (_id, stage, progress, status = "running", error_code) =>
      Object.assign(row, { stage, progress, status, error_code }),
  };
  const pool = {
    run: () =>
      Promise.reject(
        Object.assign(Error("full"), { code: "WORKER_POOL_OVERLOADED" }),
      ),
  };
  const jobs = new OrbitalDiscoveryJobs({ store, pool });
  await jobs.start(discovery_request({ free_bailiwick_id: 55 }));
  while (jobs.active.size)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "worker_queue_full");
  assert.equal(row.progress.orbital_count, 0);
  assert.equal(row.progress.all_orbitals_discovered, false);
});

test("each landing search publishes fresh counters before entering the worker queue", async () => {
  const row = { id: "run", status: "queued" };
  let saved = 0;
  const starts = [];
  const store = {
    source: async () => ({
      id: "55",
      pattern: 1,
      parameter: { x: "0", y: "0" },
    }),
    lookup_run: async () => null,
    create_run: async () => ({ id: "run", reused: false }),
    claim_run: async () => {
      const result = claimed();
      result.checkpoint.stage = "rays";
      result.checkpoint.orbitals = [
        { id: "1", period: 1, points: [] },
        { id: "2", period: 1, points: [] },
      ];
      Object.assign(result.checkpoint.progress, {
        ray_families_processed: 0,
        ray_families_total: 0,
      });
      return result;
    },
    save_checkpoint: async () => {},
    get_run: async () => ({ ...row }),
    checkpoint: async (_id, stage, progress, status = "running") =>
      Object.assign(row, { stage, progress: { ...progress }, status }),
    save_orbital: async () => ({ id: String(++saved), period: 1, points: [] }),
    save_rays: async () => {},
  };
  const pool = {
    run: (name, _payload, _callback, options) => {
      if (name === "orbital_survey_discovery")
        return Promise.resolve({
          candidates: [{}, {}],
          attempts: 2,
          samples: 4,
          sampled_candidates: 2,
        });
      starts.push({
        processed: row.progress.ray_families_processed,
        total: row.progress.ray_families_total,
      });
      options.on_progress({ phase: "rays", processed: 1024, total: 1024 });
      return Promise.resolve({
        ratios: [],
        status: "attracting",
        metadata: {},
      });
    },
  };
  const jobs = new OrbitalDiscoveryJobs({ store, pool });
  await jobs.start(discovery_request({ free_bailiwick_id: 55 }));
  while (jobs.active.size)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(row.status, "completed");
  assert.deepEqual(starts, [
    { processed: 0, total: 0 },
    { processed: 0, total: 0 },
  ]);
});

test("run deadline cancels a task even while it waits in the shared worker queue", async () => {
  const row = { id: "run", status: "queued" };
  let reject_task,
    cancelled = false;
  const store = {
    source: async () => ({
      id: "55",
      pattern: 1,
      parameter: { x: "0", y: "0" },
    }),
    lookup_run: async () => null,
    create_run: async () => ({ id: "run", reused: false }),
    claim_run: async () => claimed(),
    save_checkpoint: async () => {},
    get_run: async () => ({ ...row }),
    checkpoint: async (_id, stage, progress, status = "running", error_code) =>
      Object.assign(row, { stage, progress, status, error_code }),
  };
  const pool = {
    run: () => {
      const task = new Promise((_resolve, reject) => {
        reject_task = reject;
      });
      task.task_id = 123;
      return task;
    },
    cancel: (id) => {
      assert.equal(id, 123);
      cancelled = true;
      reject_task(
        Object.assign(Error("cancelled"), { code: "WORKER_TASK_CANCELLED" }),
      );
    },
  };
  const jobs = new OrbitalDiscoveryJobs({ store, pool, run_timeout_ms: 15 });
  await jobs.start(discovery_request({ free_bailiwick_id: 55 }));
  while (jobs.active.size)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "discovery_time_limit");
});

test("browser resume/cancel bind the job to its bailiwick and reject unsafe origins and payloads", async () => {
  const calls = [],
    id = "11111111-1111-4111-8111-111111111111";
  const app = express();
  app.use(express.json());
  app.use(
    "/orbital-data",
    create_orbital_data_router({
      jobs: {
        latest: async (source) => ({
          id,
          source_bailiwick_id: source,
          resumable: true,
        }),
        store: { get_run: async () => ({ id, source_bailiwick_id: "55" }) },
        resume: async (job) => {
          calls.push(["resume", job]);
          return { id: job };
        },
        cancel: async (job) => {
          calls.push(["cancel", job]);
          return { id: job };
        },
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/orbital-data`;
  const origin =
    process.env.FRACTO_UI_ORIGIN ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const send = (source, action, body = {}, request_origin = origin) =>
    fetch(`${base}/bailiwicks/${source}/discovery-jobs/${id}/${action}`, {
      method: "POST",
      headers: { origin: request_origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    for (const action of ["resume", "cancel"]) {
      assert.equal(
        (await send("55", action, {}, "https://untrusted.example")).status,
        403,
      );
      assert.equal((await send("56", action)).status, 404);
      assert.equal((await send("55", action, { checkpoint: {} })).status, 400);
    }
    assert.equal(calls.length, 0);
    assert.equal((await send("55", "resume")).status, 202);
    assert.equal((await send("55", "cancel")).status, 200);
    assert.deepEqual(calls, [
      ["resume", id],
      ["cancel", id],
    ]);
    const response = await fetch(`${base}/bailiwicks/55/discovery-job`);
    assert.equal((await response.json()).result.resumable, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
