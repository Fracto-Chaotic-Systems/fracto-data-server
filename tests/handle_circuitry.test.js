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
  assert.equal(response.body.point_source, "fracto_fast_calc_outside_main_cardioid");
  assert.match(response.body.message, /outside the Mandelbrot set/);
});

test(
  "outside the main cardioid, circuitry uses the established fast calculator",
  () => {
    const response = invoke({
      re: "-1",
      im: "0",
    });
    assert.equal(response.code, 200);
    assert.equal(
      response.body.point_source,
      "fracto_fast_calc_outside_main_cardioid",
    );
    assert.equal(response.body.cardinality, 2);
    assert.equal(response.body.two_point_calc_newton_fallback, undefined);
  },
);

test("detector cardinality 2 automatically falls back to calc cardinality", () => {
  const response = invoke({
    re: "-0.6690634164",
    im: "0.0908537666",
    detector_iterations: "4096",
    interpolation: "radial_sweep",
  });
  const fallback = response.body.two_point_calc_newton_fallback;
  assert.equal(response.code, 200);
  assert.equal(response.body.detector.detection.candidate_cardinality, 2);
  assert.equal(fallback.detector_cardinality, 2);
  assert.equal(fallback.calc_cardinality, 1);
  assert.equal(fallback.newton_cardinality, 1);
  assert.equal(fallback.newton_point_count, 1);
  assert.equal(response.body.cardinality, 1);
  assert.equal(response.body.orbital_points.length, 1);
  assert.equal(
    response.body.point_source,
    "two_point_calc_newton_fallback",
  );
});

test("circuitry endpoint rejects invalid coordinates", () => {
  const response = invoke({ re: "not-a-number", im: "0" });
  assert.equal(response.code, 400);
  assert.match(response.body.error, /finite numbers/);
});

test("circuitry adapts an ambiguous short-window result before returning points", () => {
  const response = invoke({
    re: "0.3237686467",
    im: "0.0535461409",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.cardinality, 92);
  assert.equal(response.body.detector.detection.candidate_cardinality, 92);
  assert.deepEqual(response.body.detector.checked_horizons, [4096, 8192, 16384]);
  assert.equal(response.body.detector.adaptive_detection, true);
});

test("circuitry can opt into a fixed horizon for controlled comparisons", () => {
  const response = invoke({
    re: "0.3237686467",
    im: "0.0535461409",
    adaptive_detection: "false",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.cardinality, 10);
  assert.deepEqual(response.body.detector.checked_horizons, [4096]);
});
