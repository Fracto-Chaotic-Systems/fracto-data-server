import test from "node:test";
import assert from "node:assert/strict";

import { handle_circuitry } from "../handlers/handle_circuitry.js";

const invoke = (query) => {
  const response = {
    code: null,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  handle_circuitry({ query }, response);
  return response;
};

test("circuitry endpoint preserves radial response contract", () => {
  const response = invoke({
    re: "0.1211937096",
    im: "0.6106129599",
    detector_iterations: "256",
    newton_limit: "1",
    interpolation: "radial_sweep",
  });
  assert.equal(response.code, 200);
  assert.ok(Array.isArray(response.body.result));
  assert.ok(Array.isArray(response.body.orbital_points));
  assert.equal(response.body.interpolation, "radial_sweep");
  assert.equal(response.body.cardinality, response.body.orbital_points.length);
  assert.equal(response.body.samples, response.body.result.length);
  assert.ok(response.body.Q);
  assert.equal(typeof response.body.detector_elapsed_ms, "number");
  assert.ok(response.body.point_source);
});

test("circuitry endpoint preserves the outside-set response", () => {
  const response = invoke({ re: "2", im: "0", detector_iterations: "32" });
  assert.equal(response.code, 200);
  assert.equal(response.body.orbit_status, "outside_mandelbrot_set");
  assert.equal(response.body.in_mandelbrot_set, false);
  assert.deepEqual(response.body.result, []);
  assert.deepEqual(response.body.orbital_points, []);
  assert.match(response.body.message, /outside the Mandelbrot set/);
});

test("circuitry endpoint rejects invalid coordinates", () => {
  const response = invoke({ re: "not-a-number", im: "0" });
  assert.equal(response.code, 400);
  assert.match(response.body.error, /finite numbers/);
});
