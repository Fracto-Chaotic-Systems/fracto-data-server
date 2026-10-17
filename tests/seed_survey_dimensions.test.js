import assert from "node:assert/strict";
import test from "node:test";
import {
  calculate_seed_survey,
  create_seed_survey_start_handler,
  start_seed_survey_job,
  handle_seed_survey_job,
  survey_dimensions,
} from "../handlers/handle_orbital.js";
import { WorkerTaskPool } from "../handlers/worker_task_pool.js";

const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

for (const encoding of ["rows", "packed"]) {
  for (const sampling of ["bounds", "centers"]) {
    test(`arbitrary 7-square grid on 350-square canvas: ${sampling}/${encoding}`, () => {
      const seeds = [],
        updates = [];
      const result = calculate_seed_survey(
        { x: 0, y: 0 },
        (_point, options) => {
          seeds.push(options.seed);
          return { pattern: 6, iteration: 123 };
        },
        (update) => updates.push(update),
        { grid_size: 7, canvas_size: 350, sampling, encoding },
      );
      assert.equal(result.total_samples, 49);
      assert.equal(result.grid_size, 7);
      assert.equal(result.canvas_size, 350);
      assert.equal(result.encoding, encoding);
      assert.equal(result.sampling, sampling);
      assert.equal(result.render_mode, encoding === "packed");
      assert.equal(
        Number(seeds[0].re),
        sampling === "bounds" ? -1.5 : Number((-1.5 + 1.5 / 7).toFixed(12)),
      );
      assert.equal(updates.length, 7);
      if (encoding === "rows") assert.equal(result.canvas_buffer[6].length, 7);
      else assert.equal(updates[0].render_row_data.length, 7 * 13);
    });
  }
}

test("single sample uses the center and grid can exceed display size", () => {
  let seed;
  const result = calculate_seed_survey(
    { x: 0, y: 0 },
    (_point, options) => {
      seed = options.seed;
      return { pattern: 0, iteration: 2 };
    },
    undefined,
    { grid_size: 1, canvas_size: 500 },
  );
  assert.deepEqual(seed, { re: "0.000000000000", im: "0.000000000000" });
  assert.equal(result.step, 0);
  assert.equal(result.total_samples, 1);
  assert.equal(
    survey_dimensions({ grid_size: 11, canvas_size: 3 }).grid_size,
    11,
  );
});

test("legacy resolution requests retain defaults without constraining new grid sizes", () => {
  assert.equal(survey_dimensions({ resolution: 1024 }).encoding, "packed");
  assert.equal(survey_dimensions({ resolution: 1024 }).sampling, "centers");
  assert.equal(survey_dimensions({ grid_size: 1024 }).encoding, "rows");
  assert.equal(survey_dimensions({ resolution: 153 }).grid_size, 153);
});

test("endpoint validates independent dimensions and options before submitting work", () => {
  let submitted;
  const handler = create_seed_survey_start_handler((_point, options) => {
    submitted = options;
    return {};
  });
  const valid = response();
  handler(
    {
      query: {
        re: "0",
        im: "0",
        grid_size: "23",
        canvas_size: "351",
        sampling: "centers",
        encoding: "packed",
      },
    },
    valid,
  );
  assert.equal(valid.code, 200);
  assert.equal(submitted.grid_size, 23);
  assert.equal(submitted.canvas_size, 351);
  for (const invalid of [
    { grid_size: "0" },
    { grid_size: "-1" },
    { grid_size: "1.5" },
    { grid_size: "Infinity" },
    { grid_size: "1025" },
    { canvas_size: "0" },
    { canvas_size: "1.5" },
    { canvas_size: "16385" },
    { grid_size: "23", resolution: "24" },
    { sampling: "other" },
    { encoding: "other" },
  ]) {
    submitted = null;
    const res = response();
    handler({ query: { re: "0", im: "0", ...invalid } }, res);
    assert.equal(res.code, 400);
    assert.equal(submitted, null);
  }
});

test("dimension capacity limits are configurable", () => {
  const old_grid = process.env.FRACTO_SURVEY_MAX_GRID_SIZE;
  const old_canvas = process.env.FRACTO_SURVEY_MAX_CANVAS_SIZE;
  try {
    process.env.FRACTO_SURVEY_MAX_GRID_SIZE = "1100";
    process.env.FRACTO_SURVEY_MAX_CANVAS_SIZE = "20000";
    assert.equal(
      survey_dimensions({ grid_size: 1051, canvas_size: 18000 }).grid_size,
      1051,
    );
  } finally {
    if (old_grid === undefined) delete process.env.FRACTO_SURVEY_MAX_GRID_SIZE;
    else process.env.FRACTO_SURVEY_MAX_GRID_SIZE = old_grid;
    if (old_canvas === undefined)
      delete process.env.FRACTO_SURVEY_MAX_CANVAS_SIZE;
    else process.env.FRACTO_SURVEY_MAX_CANVAS_SIZE = old_canvas;
  }
});

test("real worker and polling preserve arbitrary packed dimensions and canvas metadata", async () => {
  const pool = new WorkerTaskPool({
    size: 1,
    max_queue: 1,
    task_timeout_ms: 30000,
  });
  try {
    const progress = [];
    const result = await pool.run(
      "orbital_seed_survey",
      {
        parameter: { x: 2, y: 0 },
        grid_size: 3,
        canvas_size: 351,
        sampling: "centers",
        encoding: "packed",
        iteration_limit: 100000,
      },
      undefined,
      { on_progress: (update) => progress.push(update) },
    );
    assert.equal(result.grid_size, 3);
    assert.equal(result.canvas_size, 351);
    assert.equal(result.total_samples, 9);
    assert.equal(progress.length, 3);
    let payload;
    const job = start_seed_survey_job(
      { x: 2.125, y: 0 },
      {
        grid_size: 3,
        canvas_size: 351,
        encoding: "packed",
        worker_pool: {
          run(_task, value, _callback, options) {
            payload = value;
            options.on_progress(progress[0]);
            return Promise.resolve(result);
          },
        },
      },
    );
    assert.equal(payload.grid_size, 3);
    assert.equal(payload.canvas_size, 351);
    const res = response();
    handle_seed_survey_job(
      { params: { job_id: job.job_id }, query: { after_row: "0" } },
      res,
    );
    assert.equal(res.body.grid_size, 3);
    assert.equal(res.body.canvas_size, 351);
    assert.equal(
      Buffer.from(res.body.render_batch.data, "base64").length,
      3 * 13,
    );
  } finally {
    await pool.close();
  }
});
