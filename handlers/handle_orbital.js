import BigComplex from "@fracto/sdk/math/BigComplex.js";
import FractoCardinality from "@fracto/sdk/FractoCardinality.js";
import FractoFastCalc from "@fracto/sdk/FractoFastCalc.js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { data_compute_worker_pool, WorkerPoolOverloadedError } from "./worker_task_pool.js";

const seed_survey_jobs = new Map();
const SEED_SURVEY_JOB_TTL_MS = 15 * 60 * 1_000;
const SEED_SURVEY_MAX_JOBS = 16;

const prepare_derivation = (point) => {
  const P = new BigComplex(point.x, point.y);
  const q_minus = FractoFastCalc.calculate_big_cardioid_Q(point.x, point.y, -1);
  const Q_minus = new BigComplex(q_minus.x, q_minus.y);
  return { P, Q_minus };
};

const format_result = (point_list, Q_minus, cardinality, iterations) => {
  const negative_Q_minus = Q_minus.scale(-1);
  const mapped_list = point_list.map((point, step) => {
    const difference = point.add(negative_Q_minus);
    const offset = difference.magnitude();
    let scaled_difference = difference;
    if (offset < 0.000000000000001) {
      scaled_difference = difference.scale(10000000000000);
    }
    return {
      step,
      offset: offset.toString(),
      point: {
        re: point.re.toString(),
        im: point.im.toString(),
      },
      scaled_point: {
        re: scaled_difference.re.toString(),
        im: scaled_difference.im.toString(),
      },
    };
  });
  return {
    Q_minus,
    cardinality,
    iterations,
    point_list: mapped_list,
  };
};

const SEED_SURVEY_REAL_MIN = -1.5;
const SEED_SURVEY_REAL_MAX = 1.5;
const SEED_SURVEY_IMAGINARY_MIN = -1.5;
const SEED_SURVEY_IMAGINARY_MAX = 1.5;
const SEED_SURVEY_STEPS_PER_UNIT = 40;
const SEED_SURVEY_REAL_STEPS = Math.round(
  SEED_SURVEY_STEPS_PER_UNIT * (SEED_SURVEY_REAL_MAX - SEED_SURVEY_REAL_MIN),
);
const SEED_SURVEY_IMAGINARY_STEPS = Math.round(
  SEED_SURVEY_STEPS_PER_UNIT * (SEED_SURVEY_IMAGINARY_MAX - SEED_SURVEY_IMAGINARY_MIN),
);
const SEED_SURVEY_TOTAL_SAMPLES =
  (SEED_SURVEY_REAL_STEPS + 1) * (SEED_SURVEY_IMAGINARY_STEPS + 1);
const SEED_SURVEY_PROGRESS_INTERVAL = 8;
const SEED_SURVEY_CALCULATION_SETTINGS = {
  detector: "FractoCardinality",
  iterations: 4096,
  maximum_detection_iterations: 4096,
  adaptive_detection: false,
  seed_level: 0.00625,
};

/**
 * Survey the seed plane using the shared FractoCardinality detector.
 * Inconclusive results are retained separately from detected candidates.
 */
export const calculate_seed_survey = (
  parameter,
  calculate = FractoCardinality,
  on_progress = () => {},
) => {
  const started = performance.now();
  const stable_points = [];
  const unresolved_points = [];
  const outcome_counts = {
    non_singleton_candidate: 0,
    single_point_candidate: 0,
    escaped: 0,
    unresolved: 0,
    invalid_input: 0,
    numerical_failure: 0,
    other: 0,
  };
  const { Q_minus } = prepare_derivation(parameter);
  const negative_Q = Q_minus.scale(-1);
  let minimum_orbital_magnitude = Infinity;
  let maximum_orbital_magnitude = -Infinity;
  const grid_coordinate = (minimum, step) =>
    (minimum + step / SEED_SURVEY_STEPS_PER_UNIT).toFixed(3);
  let total_samples = 0;
  let reported_stable_point_count = 0;
  let reported_unresolved_point_count = 0;

  for (let re_step = 0; re_step <= SEED_SURVEY_REAL_STEPS; re_step++) {
    const seed_re = grid_coordinate(SEED_SURVEY_REAL_MIN, re_step);
    for (let im_step = 0; im_step <= SEED_SURVEY_IMAGINARY_STEPS; im_step++) {
      const seed_im = grid_coordinate(SEED_SURVEY_IMAGINARY_MIN, im_step);
      const calculation = calculate(parameter, {
        ...SEED_SURVEY_CALCULATION_SETTINGS,
        seed: { re: seed_re, im: seed_im },
      });
      const detector_result = Boolean(calculation?.detection);
      const pattern = Math.max(
        0,
        Number(
          detector_result
            ? calculation?.detection?.candidate_cardinality
            : calculation?.pattern,
        ) || 0,
      );
      const status = detector_result
        ? calculation.status === "cardinality_detected" && pattern === 1
          ? "single_point_candidate"
          : calculation.status === "cardinality_detected" && pattern > 1
            ? "cycle_candidate"
            : calculation.escaped
              ? "escaped"
              : calculation.status === "invalid_input"
                ? "invalid_input"
                : "unresolved"
        : calculation?.estimated
          ? "unresolved"
          : pattern === 0
            ? "escaped"
            : pattern === 1
              ? "single_point_candidate"
              : pattern > 1
                ? "cycle_candidate"
                : "other";
      const outcome = status === "cycle_candidate"
        ? pattern > 1 ? "non_singleton_candidate" : "single_point_candidate"
        : Object.hasOwn(outcome_counts, status) ? status : "other";
      outcome_counts[outcome]++;
      total_samples++;
      if (outcome === "unresolved") {
        unresolved_points.push({
          x: Number(seed_re),
          y: Number(seed_im),
          pattern,
          confidence: Number.isFinite(calculation?.detection?.confidence)
            ? calculation.detection.confidence
            : null,
          iterations: Number(calculation?.iterations ?? calculation?.iteration) || 0,
        });
      }
      if (pattern > 1 && status === "cycle_candidate") {
        const orbit_points = detector_result
          ? (calculation?.samples || []).slice(-pattern).map((sample) => ({
              x: sample.re,
              y: sample.im,
            }))
          : (calculation?.orbital_points || []).slice(0, pattern);
        if (orbit_points.length === pattern) {
          const orbital_magnitude = orbit_points.reduce((maximum, orbit_point) => {
            const distance = new BigComplex(orbit_point.x, orbit_point.y)
              .add(negative_Q)
              .magnitude()
              .toNumber();
            return Math.max(maximum, distance);
          }, 0);
          minimum_orbital_magnitude = Math.min(
            minimum_orbital_magnitude,
            orbital_magnitude,
          );
          maximum_orbital_magnitude = Math.max(
            maximum_orbital_magnitude,
            orbital_magnitude,
          );
          stable_points.push({
            x: Number(seed_re),
            y: Number(seed_im),
            pattern,
            confidence: Number.isFinite(calculation?.detection?.confidence)
              ? calculation.detection.confidence
              : null,
            iterations: Number(calculation?.iterations ?? calculation?.iteration) || 0,
          });
        }
      }
      if (
        total_samples % SEED_SURVEY_PROGRESS_INTERVAL === 0 ||
        total_samples === SEED_SURVEY_TOTAL_SAMPLES
      ) {
        on_progress({
          completed: total_samples,
          total: SEED_SURVEY_TOTAL_SAMPLES,
          stable_count: stable_points.length,
          stable_points: stable_points.slice(reported_stable_point_count),
          unresolved_points: unresolved_points.slice(reported_unresolved_point_count),
          outcome_counts: { ...outcome_counts },
          orbital_magnitude_range: stable_points.length
            ? { min: minimum_orbital_magnitude, max: maximum_orbital_magnitude }
            : null,
        });
        reported_stable_point_count = stable_points.length;
        reported_unresolved_point_count = unresolved_points.length;
      }
    }
  }

  return {
    real_min: SEED_SURVEY_REAL_MIN,
    real_max: SEED_SURVEY_REAL_MAX,
    imaginary_min: SEED_SURVEY_IMAGINARY_MIN,
    imaginary_max: SEED_SURVEY_IMAGINARY_MAX,
    step: 1 / SEED_SURVEY_STEPS_PER_UNIT,
    total_samples,
    stable_count: stable_points.length,
    outcome_counts,
    stable_points,
    unresolved_points,
    orbital_magnitude_range: stable_points.length
      ? {
          min: minimum_orbital_magnitude,
          max: maximum_orbital_magnitude,
        }
      : null,
    elapsed_ms: performance.now() - started,
    calculation_settings: SEED_SURVEY_CALCULATION_SETTINGS,
  };
};

const prune_seed_survey_jobs = () => {
  const now = Date.now();
  for (const [id, job] of seed_survey_jobs) {
    if (job.status !== "queued" && job.status !== "running" && now - job.updated_at > SEED_SURVEY_JOB_TTL_MS) {
      seed_survey_jobs.delete(id);
    }
  }
  while (seed_survey_jobs.size >= SEED_SURVEY_MAX_JOBS) {
    const oldest_finished = [...seed_survey_jobs.entries()].find(([, job]) =>
      job.status !== "queued" && job.status !== "running",
    );
    if (!oldest_finished) return false;
    seed_survey_jobs.delete(oldest_finished[0]);
  }
  return true;
};

const public_seed_survey_job = (job) => ({
  ...(job.result || {}),
  job_id: job.id,
  status: job.status,
  progress: job.progress,
  total_samples: job.result?.total_samples || job.progress.total,
  stable_count: job.result?.stable_count ?? job.progress.stable_count ?? 0,
  stable_points: job.result?.stable_points ?? job.progress.stable_points ?? [],
  unresolved_points: job.result?.unresolved_points ?? job.progress.unresolved_points ?? [],
  outcome_counts: job.result?.outcome_counts ?? job.progress.outcome_counts ?? {},
  orbital_magnitude_range: job.result?.orbital_magnitude_range ?? job.progress.orbital_magnitude_range ?? null,
  result: job.result,
  error: job.error,
});

export const start_seed_survey_job = (parameter, worker_pool = data_compute_worker_pool) => {
  prune_seed_survey_jobs();
  const focal_key = `${parameter?.x},${parameter?.y}`;
  for (const existing_job of seed_survey_jobs.values()) {
    if (existing_job.status !== "queued" && existing_job.status !== "running") continue;
    if (existing_job.focal_key === focal_key) return public_seed_survey_job(existing_job);
    existing_job.worker_pool?.cancel?.(existing_job.worker_task_id);
  }
  if (seed_survey_jobs.size >= SEED_SURVEY_MAX_JOBS) {
    throw new WorkerPoolOverloadedError();
  }
  const id = randomUUID();
  const job = {
    id,
    focal_key,
    worker_pool,
    worker_task_id: null,
    status: "queued",
    progress: { completed: 0, total: SEED_SURVEY_TOTAL_SAMPLES },
    result: null,
    error: null,
    updated_at: Date.now(),
  };
  seed_survey_jobs.set(id, job);
  const worker_task = worker_pool.run("orbital_seed_survey", { parameter }, undefined, {
    task_timeout_ms: 300_000,
    on_started: () => {
      if (!seed_survey_jobs.has(id)) return;
      job.status = "running";
      job.updated_at = Date.now();
    },
    on_progress: (progress) => {
      if (!seed_survey_jobs.has(id)) return;
      job.status = "running";
      const stable_points = job.progress.stable_points || [];
      const unresolved_points = job.progress.unresolved_points || [];
      stable_points.push(...(progress.stable_points || []));
      unresolved_points.push(...(progress.unresolved_points || []));
      job.progress = {
        ...progress,
        stable_points,
        unresolved_points,
      };
      job.updated_at = Date.now();
    },
  });
  job.worker_task_id = worker_task.task_id ?? null;
  worker_task.then((result) => {
    if (!seed_survey_jobs.has(id)) return;
    job.status = "completed";
    job.result = result;
    job.updated_at = Date.now();
  }).catch((error) => {
    if (!seed_survey_jobs.has(id)) return;
    if (error?.code === "WORKER_TASK_CANCELLED") {
      job.status = "cancelled";
      job.updated_at = Date.now();
      return;
    }
    job.status = "failed";
    job.error = error instanceof WorkerPoolOverloadedError
      ? "Compute capacity is busy; retry shortly"
      : error.message === "Compute worker task timed out"
        ? "Seed survey exceeded its worker time limit"
        : "Seed survey worker failed";
    job.updated_at = Date.now();
  });
  return public_seed_survey_job(job);
};

export const handle_seed_survey_job = (req, res) => {
  prune_seed_survey_jobs();
  const job = seed_survey_jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: "Seed survey was not found or has expired" });
  return res.status(200).json(public_seed_survey_job(job));
};

const retro_derivation = (point, limit) => {
  const point_data = prepare_derivation(point);
  const { P, Q_minus } = point_data;

  const negative_P = P.scale(-1);
  const under_radical = Q_minus.add(negative_P);
  const root_Q_minus_P = under_radical.sqrt();

  const point_list = [];
  point_list.push(Q_minus);
  let seed = root_Q_minus_P.scale(-1);
  const all_points = {};
  for (let i = 1; i <= limit; i++) {
    const seed_minus_P = seed.add(negative_P);
    const sqrt_seed_minus_P = seed_minus_P.sqrt();
    seed = sqrt_seed_minus_P.scale(-1);
    const seed_str = seed.toString();
    if (all_points[seed_str] && i > 10) {
      const cardinality = i - all_points[seed_str];
      return format_result(point_list, Q_minus, cardinality, i);
    }
    all_points[seed_str] = i;
    point_list.push(seed);
  }
  return format_result(point_list, Q_minus, 0, limit);
};

/**
 * Adapt FractoFastCalc's stable orbit to the point-series response shape.
 * The calculator may include a repeated closing point. The returned list is
 * normalized to the detected cardinality and then explicitly closed with a
 * duplicate of its first point for chart rendering.
 * @param {{x:number,y:number}} point Mandelbrot parameter.
 * @returns {object} Fast-calculated orbital series.
 */
const fast_pro_derivation = (
  point,
  calculate = FractoFastCalc.calc,
  cardinality_source = "legacy_fracto_fast_calc",
) => {
  const started = performance.now();
  const calculation = calculate(point.x, point.y);
  const cardinality = Math.max(0, Number(calculation?.pattern) || 0);
  const point_list = (calculation?.orbital_points || [])
    .slice(0, cardinality)
    .map((value) => new BigComplex(value.x, value.y));
  if (point_list.length > 0) {
    point_list.push(new BigComplex(point_list[0].re, point_list[0].im));
  }
  const { Q_minus } = prepare_derivation(point);
  const result = format_result(
    point_list,
    Q_minus,
    cardinality,
    calculation?.iteration || 0,
  );
  return {
    ...result,
    cardinality_source,
    elapsed_ms: performance.now() - started,
  };
};

export const handle_orbital = (req, res) => {
  console.log("handle_orbital", req.query);
  try {
    const re = parseFloat(req.query.re);
    const im = parseFloat(req.query.im);
    const limit = parseFloat(req.query.limit);
    const point = { x: re, y: im };
    const result = {
      ...retro_derivation(point, limit),
      cardinality_source: "legacy_retro_derivation",
    };
    res.status(200).json({ result });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error });
  }
};

export const handle_orbitals = (req, res, dependencies = {}) => {
  console.log("handle_orbitals", req.query);
  try {
    const re = parseFloat(req.query.re);
    const im = parseFloat(req.query.im);
    const limit = parseFloat(req.query.limit);
    const point = { x: re, y: im };
    const pro_derived = fast_pro_derivation(point);
    let seed_survey;
    try {
      seed_survey = (dependencies.start_survey || start_seed_survey_job)(point);
    } catch (error) {
      if (!(error instanceof WorkerPoolOverloadedError)) throw error;
      seed_survey = {
        status: "failed",
        progress: { completed: 0, total: SEED_SURVEY_TOTAL_SAMPLES },
        total_samples: SEED_SURVEY_TOTAL_SAMPLES,
        stable_count: 0,
        stable_points: [],
        error: "Compute capacity is busy; retry shortly",
      };
    }
    const result = { pro_derived, seed_survey };
    res.status(200).json({ result });
  } catch (error) {
    console.error("handle_orbitals", error.message);
    res.status(500).json({ error: error.message });
  }
};

// const test_point = {
//    x: -0.6897174395111918,
//    y: 0.27573049611632167,
// }
// const result = retro_derivation(test_point)
// console.log(result)
