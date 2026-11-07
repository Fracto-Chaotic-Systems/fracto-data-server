import { calculate_seed_survey } from "./handle_orbital.js";
import {
  scan_orbitals,
  SEED_SURVEY_DISCOVERY_OPTIONS,
} from "@fracto/sdk/orbitals/FractoSeedSurveyScan.js";
import { ORBIT_CLOSURE_TOLERANCE } from "@fracto/sdk/orbitals/FractoSeedSurveyConfirmation.js";

/** The same canvas sampling and shared scan used by Seed Surveys' detect page. */
export const calculate_orbital_survey_discovery = async (
  { parameter, settings },
  report = () => {},
) => {
  const focal_point = { x: Number(parameter.x), y: Number(parameter.y) };
  const total = settings.grid_size ** 2;
  report({ phase: "survey", processed: 0, total });
  const survey = calculate_seed_survey(
    focal_point,
    undefined,
    (progress) => {
      report({ phase: "survey", processed: progress.completed ?? 0, total });
    },
    {
      ...settings,
      canvas_size: settings.grid_size,
      sampling: "bounds",
      encoding: "rows",
    },
  );
  report({ phase: "survey", processed: total, total });
  let scanned = 0;
  const found = await scan_orbitals(
    { ...survey, ...settings, focal_point, sampling: "bounds" },
    {
      pause: async () => {},
      on_progress: ({ processed, total }) => {
        scanned = processed;
        report({ phase: "scan", processed, total });
      },
    },
  );
  const candidates = candidates_for(found, settings);
  return {
    candidates,
    attempts: scanned,
    samples: total,
    sampled_candidates: scanned,
  };
};

const candidates_for = (found, settings) =>
  found.slice(0, settings.max_orbitals).map((orbital, rank) => ({
    points: orbital.precise_points,
    period: orbital.points.length,
    precision_digits: settings.precision_digits,
    closure_tolerance: String(ORBIT_CLOSURE_TOLERANCE),
    identity_tolerance: String(ORBIT_CLOSURE_TOLERANCE),
    discovery_method: "seed_survey_scan",
    discovery_metadata: {
      algorithm: "seed-survey-scan-v1",
      rank,
      confidence: orbital.confidence,
      discovery_count: orbital.discovery_count,
      seed: orbital.seed,
      magnitude: orbital.magnitude,
      newton_cycles: orbital.cycles,
      scan_closure_error: orbital.closure_error,
      grid_size: settings.grid_size,
      half_span: settings.half_span,
      sampling: SEED_SURVEY_DISCOVERY_OPTIONS.sampling,
      iteration_limit: settings.iteration_limit,
      newton_iterations: settings.newton_iterations,
      precision_digits: settings.precision_digits,
    },
  }));

/** Checkpoint units reuse the exact full-survey implementation and shared scan. */
export const calculate_orbital_survey_rows = (
  { parameter, settings, row_start = 0 },
  report = () => {},
) => {
  const row_end = Math.min(settings.grid_size, row_start + 8);
  const survey = calculate_seed_survey(
    { x: Number(parameter.x), y: Number(parameter.y) },
    undefined,
    (progress) =>
      report({
        phase: "survey",
        processed: progress.completed,
        total: settings.grid_size ** 2,
      }),
    {
      ...settings,
      canvas_size: settings.grid_size,
      sampling: "bounds",
      encoding: "rows",
      row_start,
      row_end,
    },
  );
  return {
    rows: Array.from({ length: row_end - row_start }, (_, index) =>
      survey.canvas_buffer.map((column) => column[row_start + index]),
    ),
    next_row: row_end,
  };
};

export const calculate_orbital_survey_scan = async (
  { parameter, settings, rows, scan },
  report = () => {},
) => {
  const canvas_buffer = Array.from(
    { length: settings.grid_size },
    (_, column) => rows.map((row) => row[column]),
  );
  const state = {
    found: scan.found,
    tested_pixels: new Set(scan.tested_pixels),
  };
  let progress = { processed: state.tested_pixels.size, total: 0 };
  const found = await scan_orbitals(
    {
      ...settings,
      canvas_buffer,
      focal_point: {
        x: Number(parameter.x),
        y: Number(parameter.y),
      },
      sampling: "bounds",
    },
    {
      state,
      max_samples: 16,
      pause: async () => {},
      on_progress: (value) => {
        progress = value;
        report({ phase: "scan", ...value });
      },
    },
  );
  const done = progress.processed >= progress.total;
  return {
    scan: { found: state.found, tested_pixels: [...state.tested_pixels] },
    done,
    progress,
    candidates: done ? candidates_for(found, settings) : null,
  };
};
