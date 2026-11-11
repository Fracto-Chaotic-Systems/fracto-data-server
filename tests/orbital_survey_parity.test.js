import assert from "node:assert/strict";
import test from "node:test";
import { WorkerTaskPool } from "../handlers/worker_task_pool.js";
import { discovery_request } from "../handlers/orbital_data_contract.js";
import { calculate_seed_survey } from "../handlers/handle_orbital.js";
import { scan_orbitals as ui_scan } from "../../fracto-ui/src/pages/assets/surveys/SeedSurveyScan.js";
import {
  scan_orbitals,
  SEED_SURVEY_DISCOVERY_OPTIONS,
} from "@fracto/sdk/orbitals/FractoSeedSurveyScan.js";
import { same_orbital_cycle } from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { OrbitalDataStore } from "../handlers/orbital_data_store.js";

test("pattern-7 worker discovery matches the Seed Surveys full-resolution scan, independently of the legacy period cap", async () => {
  assert.equal(ui_scan, scan_orbitals);
  const parameter = { x: "0.4568228752647291", y: "0.34775866293208374" };
  const focal_point = { x: Number(parameter.x), y: Number(parameter.y) };
  const settings = discovery_request({
    free_bailiwick_id: 65,
    settings: { max_period: 1 },
  }).settings;
  const survey = calculate_seed_survey(focal_point, undefined, undefined, {
    ...SEED_SURVEY_DISCOVERY_OPTIONS,
    canvas_size: settings.grid_size,
    encoding: "rows",
  });
  const expected = await ui_scan(
    { ...survey, ...settings, focal_point, sampling: "bounds" },
    { pause: async () => {} },
  );
  const pool = new WorkerTaskPool({ size: 1, task_timeout_ms: 60000 });
  try {
    const result = await pool.run("orbital_survey_discovery", {
      parameter,
      settings,
    });
    assert.equal(settings.max_orbitals, 100);
    assert.equal(result.candidates.length, expected.length);
    assert.ok(result.candidates.length > 10 && result.candidates.length <= 100);
    assert.deepEqual(
      result.candidates
        .slice(0, 10)
        .map((o) => o.discovery_metadata.discovery_count),
      [49, 40, 14, 6, 6, 3, 2, 2, 1, 1],
    );
    for (const [rank, actual] of result.candidates.entries()) {
      assert.equal(actual.period, expected[rank].points.length);
      if (rank < 10) assert.ok(actual.discovery_metadata.confidence > 0.999999);
      assert.equal(actual.discovery_metadata.rank, rank);
      assert.equal(
        actual.discovery_metadata.confidence,
        expected[rank].confidence,
      );
      assert.ok(
        same_orbital_cycle(
          actual.points,
          expected[rank].precise_points,
          "1e-7",
        ),
      );
    }
  } finally {
    await pool.close();
  }
});

test("latest survey hides historical results until recalculated and returns per-run confirmation metadata", async () => {
  let queries = 0;
  const stale = new OrbitalDataStore({
    open: async () => ({
      execute: async () => [queries++ === 0 ? [] : [{ id: 1 }]],
      end: async () => {},
    }),
  });
  assert.deepEqual((await stale.latest_survey({ x: "0", y: "0" })).result, []);
  queries = 0;
  const current = new OrbitalDataStore({
    open: async () => ({
      execute: async () => [
        queries++ === 0
          ? [
              {
                id: "run",
                progress: JSON.stringify({
                  catalog_coverage: { max_denominator: 7 },
                }),
              },
            ]
          : [
              {
                id: 2,
                free_bailiwick_id: 65,
                ray_metadata: null,
                discovery_metadata: { rank: 9 },
                run_metadata: JSON.stringify({ rank: 0, confidence: 1 }),
              },
            ],
      ],
      end: async () => {},
    }),
  });
  const result = await current.latest_survey({ x: "0", y: "0" });
  assert.equal(result.stale, false);
  assert.equal(result.run_id, "run");
  assert.deepEqual(result.coverage, { max_denominator: 7 });
  assert.equal(result.result[0].discovery_metadata.rank, 0);
});
