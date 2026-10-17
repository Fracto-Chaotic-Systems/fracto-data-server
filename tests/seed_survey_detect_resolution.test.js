import assert from "node:assert/strict";
import test from "node:test";
import {
  calculate_seed_survey,
  create_seed_survey_start_handler,
  start_seed_survey_job,
} from "../handlers/handle_orbital.js";

test("150-square survey covers both seed bounds and streams every row", () => {
  const seeds = [],
    rows = [];
  const survey = calculate_seed_survey(
    { x: 0, y: 0 },
    (_point, options) => {
      seeds.push(options.seed);
      return { pattern: 6, iteration: 123 };
    },
    (update) => rows.push(update),
    { resolution: 150 },
  );
  assert.equal(survey.resolution, 150);
  assert.equal(survey.total_samples, 22500);
  assert.equal(survey.canvas_buffer.length, 150);
  assert.ok(survey.canvas_buffer.every((column) => column.length === 150));
  assert.deepEqual(survey.canvas_buffer[149][149], [6, 123]);
  assert.deepEqual(seeds[0], { re: "-1.500000000000", im: "1.500000000000" });
  assert.deepEqual(seeds.at(-1), {
    re: "1.500000000000",
    im: "-1.500000000000",
  });
  assert.equal(rows.filter((row) => row.canvas_buffer_row).length, 150);
});

test("HTTP validation and worker submission preserve resolution 150", () => {
  let options, submitted;
  const response = {
    json(body) {
      return body;
    },
    status(code) {
      assert.equal(code, 200);
      return this;
    },
  };
  create_seed_survey_start_handler((_point, value) => {
    options = value;
    return {};
  })({ query: { re: "0", im: "0", resolution: "150" } }, response);
  assert.equal(options.resolution, 150);
  const job = start_seed_survey_job(
    { x: 0.123, y: 0.456 },
    {
      resolution: 150,
      worker_pool: {
        run(_task, payload) {
          submitted = payload;
          return new Promise(() => {});
        },
      },
    },
  );
  assert.equal(job.resolution, 150);
  assert.equal(job.total_samples, 22500);
  assert.equal(submitted.resolution, 150);
});
