import test from "node:test";
import assert from "node:assert/strict";

import { detect_cardinality } from "../handlers/orbitals/cardinality_detection.js";
import { refine_orbital_points } from "../handlers/orbitals/newton_refinement.js";
import {
  build_circuitry_from_points,
  build_circuitry_pipeline,
} from "../handlers/orbitals/circuitry_pipeline.js";
import { get_cardioid_root } from "../handlers/orbitals/orbitals_utils.js";
import { newton_big_complex } from "../handlers/orbitals/newton_big_complex.js";
import { newton_big_complex_experimental } from "../handlers/orbitals/newton_big_complex_experimental.js";
import { run_newton_coarse_sweep } from "../handlers/orbitals/newton_coarse_sweep.js";
import {
  approximate_theta_rational,
  investigate_two_point_orbit,
} from "../handlers/orbitals/orbital_two.js";
import FractoUtil from "@fracto/sdk/FractoUtil.js";

const seven_point = { re: 0.1211937096, im: 0.6106129599 };

test("cardinality detection is independently callable", () => {
  const result = detect_cardinality(seven_point, { iterations: 256 });
  assert.equal(result.point.re, String(seven_point.re));
  assert.equal(result.point.im, String(seven_point.im));
  assert.ok(Array.isArray(result.samples));
  assert.equal(result.detection.candidate_cardinality, 7);
  assert.equal(result.status, "cardinality_detected");
});

test("Newton refinement accepts a supplied cardinality", () => {
  const result = refine_orbital_points(seven_point, 7, {
    newton_mode: "native",
    newton_limit: 1,
  });
  assert.equal(result.cardinality, 7);
  assert.equal(result.newton.cardinality_supplied, true);
  assert.equal(result.newton.diagnostics.supplied_cardinality, 7);
});

test("radial circuitry can begin from caller-supplied points and Q", () => {
  const points = [
    { re: 1, im: 0 },
    { re: 0, im: 1 },
    { re: -1, im: 0 },
    { re: 0, im: -1 },
  ];
  const result = build_circuitry_from_points(points, { re: 0, im: 0 }, {
    samples_per_interval: 4,
  });
  assert.equal(result.status, "success");
  assert.equal(result.body.point_source, "caller_supplied");
  assert.equal(result.body.cardinality, points.length);
  assert.equal(result.body.samples, points.length * 4 + 1);
  assert.deepEqual(result.body.Q, { re: 0, im: 0 });
  assert.equal(result.body.result.length, points.length * 4 + 1);
});

test("experimental Newton exits on stagnation without changing the established solver", () => {
  const point = { x: -0.7332213634, y: 0.0881246603 };
  const experimental = newton_big_complex_experimental(point, 25, 10);
  const established = newton_big_complex(point, 25, 10);

  assert.equal(experimental.status, "stagnated");
  assert.equal(experimental.cycles, 6);
  assert.equal(experimental.diagnostics.early_exit, true);
  assert.equal(experimental.diagnostics.exit_reason, "no_step_improvement");
  assert.equal(established.cycles, 25);
  assert.equal("status" in established, false);
});

test("two-point investigation preserves the established ordered points", () => {
  const points = [{ re: -1, im: 0 }, { re: 0, im: 0 }];
  const result = investigate_two_point_orbit({ re: -1, im: 0 }, points);
  assert.strictEqual(result.points, points);
  assert.deepEqual(result.parameterization, {
    status: "outside_main_cardioid",
    r: null,
    theta: null,
    theta_rational: null,
    max_cardinality: 2048,
  });
  assert.throws(
    () => investigate_two_point_orbit({ re: -1, im: 0 }, points.slice(0, 1)),
    RangeError,
  );
  assert.throws(
    () => investigate_two_point_orbit(
      { re: -1, im: 0 },
      [...points, { re: 1, im: 0 }],
    ),
    RangeError,
  );
});

test("theta approximation returns nearest reduced integer fractions below the cardinality cap", () => {
  assert.deepEqual(approximate_theta_rational(0.3), {
    numerator: 3,
    denominator: 10,
    value: 0.3,
    error: 0,
    max_denominator: 2047,
  });
  assert.deepEqual(approximate_theta_rational(0.2, 8), {
    numerator: 1,
    denominator: 5,
    value: 0.2,
    error: 0,
    max_denominator: 7,
  });
  const reduced = approximate_theta_rational(0.25);
  assert.equal(reduced.numerator, 1);
  assert.equal(reduced.denominator, 4);
  assert.equal(Number.isInteger(reduced.numerator), true);
  assert.equal(Number.isInteger(reduced.denominator), true);
  const high_denominator = approximate_theta_rational(1 / 997);
  assert.equal(high_denominator.numerator, 1);
  assert.equal(high_denominator.denominator, 997);
  assert.equal(high_denominator.max_denominator, 2047);
  assert.throws(() => approximate_theta_rational(0.2, 1), RangeError);
});

test("two-point investigation exposes r, theta, and reduced rational theta in cardioid", () => {
  const focal_point = FractoUtil.r_theta_to_P(0.8, 0.3);
  const points = [{ re: 2, im: 3 }, { re: 4, im: 5 }];
  const result = investigate_two_point_orbit(
    { re: focal_point.x, im: focal_point.y },
    points,
  );
  assert.strictEqual(result.points, points);
  assert.equal(result.parameterization.status, "available");
  assert.ok(Math.abs(result.parameterization.r - 0.8) < 1e-12);
  assert.ok(Math.abs(result.parameterization.theta - 0.3) < 1e-12);
  assert.equal(result.parameterization.theta_rational.numerator, 3);
  assert.equal(result.parameterization.theta_rational.denominator, 10);
  assert.equal(result.parameterization.theta_rational.value, 0.3);
  assert.ok(result.parameterization.theta_rational.error < 1e-12);
  assert.equal(result.parameterization.theta_rational.max_denominator, 2047);
  assert.equal(result.parameterization.theta_rational.denominator < 2048, true);
  assert.equal(result.newton_experiment.mode, "experimental_big_complex");
  assert.equal(result.newton_experiment.candidate_cardinality, 10);
  assert.equal(
    result.newton_experiment.result.diagnostics.supplied_cardinality,
    10,
  );
});

test("coarse Newton sweep refines only a small ranked candidate set", () => {
  const result = run_newton_coarse_sweep(
    { x: -0.75, y: 0.1 },
    {
      max_cardinality: 24,
      coarse_iterations: 2,
      candidate_count: 2,
      refinement_iterations: 2,
      include_cardinalities: [10],
    },
  );
  assert.equal(result.mode, "experimental_coarse_then_big_complex_sweep");
  assert.equal(result.status, "completed");
  assert.equal(result.settings.coarse_precision, "javascript_number");
  assert.equal(result.settings.refinement_precision_digits, 64);
  assert.equal(result.settings.max_cardinality, 24);
  assert.equal(result.coarse_candidates.length, 2);
  assert.ok(result.refined_candidates.length >= 2);
  assert.ok(result.refined_candidates.length <= 3);
  assert.ok(result.refined_candidates.some(({ cardinality }) => cardinality === 10));
  assert.ok(result.refined_candidates.every(({ result: candidate }) =>
    candidate.diagnostics.mode === "experimental_big_complex",
  ));
  assert.ok(result.timings.total_ms >= result.timings.coarse_ms);
});

test("two-point coarse sweep is opt-in and leaves established points unchanged", () => {
  const focal_point = FractoUtil.r_theta_to_P(0.8, 0.3);
  const points = [{ re: 2, im: 3 }, { re: 4, im: 5 }];
  const default_result = investigate_two_point_orbit(
    { re: focal_point.x, im: focal_point.y },
    points,
  );
  assert.equal("newton_sweep_experiment" in default_result, false);

  const experiment_result = investigate_two_point_orbit(
    { re: focal_point.x, im: focal_point.y },
    points,
    {
      newton_sweep_experiment: true,
      newton_sweep_max_cardinality: 24,
      newton_sweep_coarse_iterations: 2,
      newton_sweep_candidate_count: 2,
      newton_sweep_refinement_iterations: 2,
    },
  );
  assert.strictEqual(experiment_result.points, points);
  assert.equal(
    experiment_result.newton_sweep_experiment.mode,
    "experimental_coarse_then_big_complex_sweep",
  );
  assert.ok(
    experiment_result.newton_sweep_experiment.refined_candidates.some(
      ({ cardinality }) => cardinality === 10,
    ),
  );
});

test("circuitry routes apparent two-point results through the pass-through hook", () => {
  const result = build_circuitry_pipeline({ re: -1, im: 0 }, {
    interpolation: "radial_sweep",
    detector_iterations: 2048,
  });
  assert.equal(result.status, "success");
  assert.equal(result.body.detector.detection.candidate_cardinality, 2);
  assert.equal(result.body.cardinality, 2);
  assert.deepEqual(result.body.orbital_points, [
    { re: -1, im: 0 },
    { re: 0, im: 0 },
  ]);
  assert.equal(
    result.body.two_point_investigation.status,
    "outside_main_cardioid",
  );
});

test("a one-point orbit remains a renderable circuitry result", () => {
  const result = build_circuitry_pipeline({ re: 0, im: 0 }, {
    interpolation: "radial_sweep",
  });
  assert.equal(result.status, "success");
  assert.equal(result.body.cardinality, 1);
  assert.equal(result.body.samples, 1);
  assert.equal(result.body.orbital_points.length, 1);
  assert.equal(result.body.result.length, 1);
  assert.deepEqual(result.body.result[0].C, result.body.orbital_points[0]);
});


test("Q calculation remains independently available", () => {
  const Q = get_cardioid_root({ re: 0, im: 0 });
  assert.deepEqual(Q, { re: 0, im: 0 });
});
