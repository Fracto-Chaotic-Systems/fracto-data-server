import assert from "node:assert/strict";
import test from "node:test";
import { WorkerTaskPool } from "../handlers/worker_task_pool.js";
import { discovery_request } from "../handlers/orbital_data_contract.js";
import {
  initial_checkpoint,
  encode_checkpoint,
  decode_checkpoint,
} from "../handlers/orbital_data_checkpoint.js";
import {
  find_dynamic_rays,
  SEED_SURVEY_RAY_OPTIONS,
} from "@fracto/sdk/orbitals/FractoDynamicRays.js";
import { newton_big_complex } from "@fracto/sdk/orbitals/FractoNewtonBigComplex.js";
import { scan_orbitals } from "@fracto/sdk/orbitals/FractoSeedSurveyScan.js";
import { OrbitalDiscoveryJobs } from "../handlers/orbital_data_jobs.js";
import { OrbitalDataStore } from "../handlers/orbital_data_store.js";
import { ORBITAL_CALCULATION_VERSION } from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";

const roundtrip = async (cp) => decode_checkpoint(await encode_checkpoint(cp));

test("job lookup matches the bailiwick ID regardless of new coordinates or settings", async () => {
  const queries = [];
  const store = new OrbitalDataStore({
    open: async () => ({
      execute: async (sql, values) => {
        queries.push({ sql, values });
        if (sql.includes("id<>?")) return [[]];
        assert.ok(sql.includes("r.source_bailiwick_id=?"));
        assert.deepEqual(values, ["65"]);
        return [[{ id: "original-checkpoint" }]];
      },
      end: async () => {},
    }),
  });
  const request = discovery_request({
    free_bailiwick_id: "65",
    settings: { max_families: 19 },
  });
  assert.equal(
    await store.lookup_run(
      { id: "65", parameter: { x: "0", y: "0" }, pattern: 1 },
      request,
    ),
    "original-checkpoint",
  );
  assert.equal(queries.length, 2);
});

test("a separate job manager cannot claim a live owner or create another run for the same bailiwick", async () => {
  const locks = [];
  const store = new OrbitalDataStore({
    open: async () => ({
      execute: async (sql, values) => {
        if (sql.includes("GET_LOCK")) {
          locks.push(values[0]);
          return [[{ acquired: 1 }]];
        }
        if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
        if (sql.startsWith("SELECT source_bailiwick_id"))
          return [[{ source_bailiwick_id: "65" }]];
        if (sql.includes("id<>?")) return [[{ id: "other-active-run" }]];
        assert.fail(sql);
      },
      beginTransaction: async () => {},
      rollback: async () => {},
      end: async () => {},
    }),
  });
  const source = { id: "65", parameter: { x: "0", y: "0" }, pattern: 1 };
  const request = discovery_request({
    free_bailiwick_id: "65",
    request_key: "another",
    settings: { max_families: 19 },
  });
  await assert.rejects(store.claim_run("old-checkpoint"), {
    code: "bailiwick_busy",
    status: 409,
  });
  await assert.rejects(store.create_run(source, request), {
    code: "bailiwick_busy",
    status: 409,
  });
  assert.equal(locks.length, 2);
  assert.equal(
    locks[0],
    locks[1],
    "creation and claiming share the same database mutex",
  );
});

test("legacy stopped jobs retain results but never claim resumability without a checkpoint", async () => {
  const row = {
    id: "legacy",
    status: "cancelled",
    source_bailiwick_id: 55,
    settings: "{}",
    progress: "{}",
    calculation_version: ORBITAL_CALCULATION_VERSION,
    execution_token: null,
    lease_active: 0,
  };
  const store = new OrbitalDataStore({
    open: async () => ({
      execute: async (sql) => {
        if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
        if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
        if (sql.includes("id<>?")) return [[]];
        if (sql.startsWith("UPDATE")) return [{ affectedRows: 0 }];
        if (sql.includes("FROM orbital_discovery_checkpoints")) return [[]];
        if (sql.includes("FROM orbital_discovery_results"))
          return [[{ orbital_id: 7, discovery_metadata: null }]];
        if (sql.includes("FROM orbital_discovery_runs")) return [[row]];
        assert.fail(sql);
      },
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      end: async () => {},
    }),
  });
  const result = await store.get_run("legacy");
  assert.equal(result.resumable, false);
  assert.equal(result.resume_count, 0);
  assert.equal(result.checkpoint_phase, null);
  assert.equal(result.results.length, 1);
  await assert.rejects(
    store.claim_run("legacy"),
    (e) => e.code === "checkpoint_unavailable",
  );
  assert.equal(row.status, "cancelled");
});

test("a finished ray calculation survives failed SQL publication without being calculated again", async () => {
  let durable = initial_checkpoint(),
    generation = 0,
    calculations = 0,
    publications = 0;
  durable.stage = "rays";
  durable.orbitals = [{ id: "1", period: 1, points: [] }];
  const row = { id: "run", status: "cancelled" };
  const source = { id: "55", parameter: { x: "0", y: "0" }, pattern: 1 };
  const settings = discovery_request({
    free_bailiwick_id: 55,
    settings: { catalog_max_denominator: 0 },
  }).settings;
  const store = {
    get_run: async () => ({ ...row }),
    claim_run: async () => ({
      owned: true,
      token: String(++generation),
      checkpoint: await roundtrip(durable),
      source,
      settings,
    }),
    checkpoint: async (
      _id,
      stage,
      progress,
      status = "running",
      error_code,
      token,
    ) => {
      assert.equal(token, String(generation));
      Object.assign(row, { stage, progress, status, error_code });
    },
    save_checkpoint: async (_id, cp, token) => {
      assert.equal(token, String(generation));
      durable = await roundtrip(cp);
    },
    save_rays: async () => {
      if (++publications === 1) throw Error("injected publication failure");
    },
  };
  const pool = {
    run: () => {
      calculations++;
      return Promise.resolve({
        status: "attracting",
        ratios: [],
        metadata: {},
      });
    },
  };
  let jobs = new OrbitalDiscoveryJobs({ store, pool });
  await jobs.resume("run");
  while (jobs.active.size)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(row.status, "partial");
  assert.ok(durable.ray_result);
  jobs = new OrbitalDiscoveryJobs({ store, pool });
  await jobs.resume("run");
  while (jobs.active.size)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(row.status, "completed");
  assert.equal(calculations, 1);
  assert.equal(publications, 2);
  assert.equal(durable.ray_index, 1);
  assert.equal(durable.stage, "done");
});

test("busy admission cannot create orphan calculation records", async () => {
  let created = 0;
  const store = {
    source: async () => ({}),
    lookup_run: async () => null,
    create_run: async () => {
      created++;
      return { id: "new" };
    },
  };
  const jobs = new OrbitalDiscoveryJobs({ store, pool: {}, max_jobs: 1 });
  jobs.active.set("busy", {});
  await assert.rejects(
    jobs.start(discovery_request({ free_bailiwick_id: 55 })),
    (e) => e.code === "worker_queue_full",
  );
  assert.equal(created, 0);
});

test("actual checkpoint worker units preserve the full pattern-7 scan and discovery-count ranking", async () => {
  const parameter = { x: "0.4568228752647291", y: "0.34775866293208374" };
  const settings = discovery_request({ free_bailiwick_id: 65 }).settings;
  const pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 60000 });
  let cp = initial_checkpoint();
  try {
    const baseline = await pool.run("orbital_survey_discovery", {
      parameter,
      settings,
    });
    while (cp.survey_rows.length < settings.grid_size) {
      const batch = await pool.run("orbital_survey_rows", {
        parameter,
        settings,
        row_start: cp.survey_rows.length,
      });
      cp.survey_rows.push(...batch.rows);
      cp = await roundtrip(cp);
    }
    let result;
    do {
      result = await pool.run("orbital_survey_scan", {
        parameter,
        settings,
        rows: cp.survey_rows,
        scan: cp.scan,
      });
      cp.scan = result.scan;
      cp = await roundtrip(cp);
    } while (!result.done);
    assert.deepEqual(result.candidates, baseline.candidates);
    assert.equal(cp.scan.tested_pixels.length, baseline.attempts);
    assert.ok(result.candidates.length > 10);
  } finally {
    await pool.close();
  }
});

test("scan checkpoints retain groups outside the top 100 and never recount tested pixels", async () => {
  const size = 32;
  const survey = {
    canvas_buffer: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => [2, 1]),
    ),
    half_span: 1.5,
    sampling: "bounds",
    focal_point: { x: 0, y: 0 },
  };
  let visits = 0;
  const refine = () => {
    const index = visits++;
    return {
      points: [{ x: index < 256 ? index : 255, y: 0 }],
      confidence: 0.8,
    };
  };
  let cp = initial_checkpoint();
  while (cp.scan.tested_pixels.length < size * size) {
    const state = {
      found: cp.scan.found,
      tested_pixels: new Set(cp.scan.tested_pixels),
    };
    await scan_orbitals(survey, {
      state,
      max_samples: 16,
      refine,
      pause: async () => {},
    });
    cp.scan = { found: state.found, tested_pixels: [...state.tested_pixels] };
    cp = await roundtrip(cp);
  }
  const state = {
    found: cp.scan.found,
    tested_pixels: new Set(cp.scan.tested_pixels),
  };
  const result = await scan_orbitals(survey, {
    state,
    refine,
    pause: async () => {},
  });
  assert.equal(visits, 1024);
  assert.equal(result.length, 100);
  assert.equal(result[0].points[0].x, 255);
  assert.equal(result[0].discovery_count, 769);
});

test("ray-family checkpoints retain accepted families and match uninterrupted search exactly", async () => {
  const parameter = { x: "0", y: "0" };
  const root = newton_big_complex(parameter, 80, 3, {
    precision_digits: 64,
    seed: { x: Math.cos((2 * Math.PI) / 7), y: Math.sin((2 * Math.PI) / 7) },
  });
  const orbital = {
    points: root.point_list.map((p) => ({ x: Number(p.re), y: Number(p.im) })),
  };
  const options = {
    ...SEED_SURVEY_RAY_OPTIONS,
    max_angle_period: 3,
    retain_geometry: false,
  };
  const baseline = await find_dynamic_rays(parameter, orbital, options);
  assert.equal(baseline.status, "rays_found");
  let cp = initial_checkpoint(),
    result,
    units = 0;
  do {
    result = await find_dynamic_rays(parameter, orbital, {
      ...options,
      state: cp.ray_state || undefined,
      max_work_units: 1,
    });
    if (result.status === "checkpoint") {
      units++;
      assert.equal(result.state.processed, units);
      cp.ray_state = result.state;
      cp = await roundtrip(cp);
    }
  } while (result.status === "checkpoint");
  assert.equal(units, baseline.search.candidates);
  assert.deepEqual(result, baseline);
  await assert.rejects(
    find_dynamic_rays(parameter, orbital, {
      ...options,
      tolerance: 1e-5,
      state: cp.ray_state,
    }),
    /checkpoint/,
  );
});
