import assert from "node:assert/strict";
import test from "node:test";

import { calculate_seed_survey } from "../handlers/handle_orbital.js";

for (const { name, parameter } of [
  { name: "inside", parameter: { x: 0, y: 0 } },
  { name: "outside", parameter: { x: 2, y: 0 } },
]) {
  test(`${name}-cardioid preview streams pattern/iteration rows for FractoColors`, () => {
    const progress = [];
    const survey = calculate_seed_survey(
      parameter,
      (_point, options) => options.seed.re === "-1.500000000000"
        ? { pattern: 0, iteration: 17 }
        : { pattern: 6, iteration: 123 },
      (update) => progress.push(update),
    );

    assert.equal(survey.uses_canvas_buffer, true);
    assert.equal(survey.outside_main_cardioid, name === "outside");
    assert.deepEqual(survey.canvas_buffer[0][0], [0, 17]);
    assert.deepEqual(progress[0].canvas_buffer_row.values[0], [0, 17]);
    assert.ok(progress.every(({ canvas_buffer_row }) => canvas_buffer_row));
  });
}
