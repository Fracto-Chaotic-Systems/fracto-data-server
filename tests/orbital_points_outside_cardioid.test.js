import assert from "node:assert/strict";
import test from "node:test";
import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
import { calculate_seed_survey } from "../handlers/handle_orbital.js";
import {
  handle_orbital_newton,
  refine_outside_cardioid_result,
} from "../handlers/handle_orbital_newton.js";

const point = { re: "0.2693785307", im: "0.5397724687" };
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

test("reported focal point returns four Newton-derived points rather than the raw calculator shape", () => {
  const res = response();
  handle_orbital_newton(
    { query: { ...point, newton_mode: "big_complex" } },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.cardinality, 4);
  assert.equal(
    res.body.cardinality_source,
    "fracto_fast_calc_outside_cardioid",
  );
  assert.equal(res.body.newton_big_complex.point_list.length, 4);
  assert.ok(
    res.body.newton_big_complex.point_list.every(
      (p) => Number.isFinite(Number(p.re)) && Number.isFinite(Number(p.im)),
    ),
  );
  assert.equal(res.body.newton_big_complex.cardinality_supplied, true);
  assert.equal(res.body.detection.candidate_cardinality, 4);
  assert.equal(res.body.domain, "outside_main_cardioid");
});

test("calculator-derived survey candidates populate the stable-point chart input and magnitude range", () => {
  const survey = calculate_seed_survey(
    { x: Number(point.re), y: Number(point.im) },
    undefined,
    undefined,
    { grid_size: 7 },
  );
  assert.ok(survey.stable_points.length > 0);
  assert.ok(
    survey.stable_points.every(
      (p) =>
        p.pattern === 4 && p.cardinality_source === "fracto_fast_calc_seeded",
    ),
  );
  assert.equal(survey.stable_points.length, survey.stable_count);
  assert.ok(Number.isFinite(survey.orbital_magnitude_range.min));
  assert.ok(Number.isFinite(survey.orbital_magnitude_range.max));
});

test("escaped, estimated, and detector responses do not silently become Newton candidates", () => {
  const escaped = { pattern: 0, iteration: 2 };
  assert.equal(refine_outside_cardioid_result(point, escaped), escaped);
  const estimated = { pattern: 4, estimated: true };
  assert.equal(refine_outside_cardioid_result(point, estimated), estimated);
  const detector = { detection: { candidate_cardinality: 4 } };
  assert.equal(refine_outside_cardioid_result(point, detector), detector);
  const calculation = FractoFastCalc.calc(Number(point.re), Number(point.im));
  const both = refine_outside_cardioid_result(point, calculation, {
    newton_mode: "both",
    newton_limit: 5,
  });
  assert.equal(both.newton_native.point_list.length, 4);
  assert.equal(both.newton_big_complex.point_list.length, 4);
});

test("explicit legacy cardinality is used directly with source preserved", () => {
  for (const coordinates of [point, { re: "0", im: "0" }]) {
    const res = response();
    handle_orbital_newton(
      {
        query: {
          ...coordinates,
          cardinality: "4",
          cardinality_source: "legacy_iterative",
          newton_mode: "big_complex",
        },
      },
      res,
    );
    assert.equal(res.code, 200);
    assert.equal(res.body.cardinality, 4);
    assert.equal(res.body.cardinality_source, "legacy_iterative");
    assert.equal(res.body.detection.status, "supplied_cardinality");
    assert.equal(res.body.newton_big_complex.cardinality, 4);
    assert.equal(res.body.newton_big_complex.point_list.length, 4);
    assert.equal(res.body.iterations, 0);
    assert.equal(res.body.two_point_calc_newton_fallback, undefined);
  }
});

test("invalid supplied cardinalities are rejected before refinement", () => {
  for (const cardinality of ["0", "-1", "2.5", "5001", "Infinity"]) {
    const res = response();
    handle_orbital_newton({ query: { ...point, cardinality } }, res);
    assert.equal(res.code, 400);
  }
});

test("main-cardioid interior refines the real legacy period instead of returning zero", () => {
  const point = { re: "0.2", im: "0.3" };
  const legacy = FractoFastCalc.calc(Number(point.re), Number(point.im));
  assert.equal(legacy.pattern, 1);
  const res = response();
  handle_orbital_newton(
    {
      query: {
        ...point,
        cardinality: String(legacy.pattern),
        cardinality_source: "legacy_iterative",
        newton_mode: "big_complex",
      },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.domain, "main_cardioid");
  assert.equal(res.body.cardinality, legacy.pattern);
  assert.equal(res.body.newton_big_complex.point_list.length, legacy.pattern);
  assert.equal(res.body.detection.status, "supplied_cardinality");
  assert.equal(res.body.cardinality_source, "legacy_iterative");
  assert.equal(res.body.iterations, 0);
});
