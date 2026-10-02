import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { calculate_logistic_orbit } from "./calculator.js";
import { parse_legacy_span_catalog } from "./legacy_span_catalog.js";

export const logistic_cycle_multiplier = (r, points) => {
  if (!Number.isFinite(r) || !Array.isArray(points) || points.length === 0) return null;
  return points.reduce((product, x) => product * r * (1 - 2 * x), 1);
};

export const approximate_primitive_cycle = (r, cycle, tolerance) => {
  if (!cycle) return null;
  const { period, points } = cycle;
  for (let candidate_period = 1; candidate_period <= period; candidate_period += 1) {
    if (period % candidate_period !== 0) continue;
    let return_state = points[0];
    for (let i = 0; i < candidate_period; i += 1) return_state = r * return_state * (1 - return_state);
    const return_residual = Math.abs(return_state - points[0]);
    let max_repetition_gap = 0;
    for (let i = 0; i < points.length; i += 1) {
      max_repetition_gap = Math.max(max_repetition_gap, Math.abs(points[i] - points[i % candidate_period]));
    }
    if (return_residual <= tolerance && max_repetition_gap <= tolerance) {
      return {
        period: candidate_period,
        points: points.slice(0, candidate_period),
        return_residual,
        max_repetition_gap,
        tolerance,
        validation: candidate_period === period ? "no_smaller_divisor_within_tolerance" : "reduced_within_tolerance",
      };
    }
  }
  return null;
};

export const review_span_interior = ({
  catalog,
  source_order,
  fractions = [0.25, 0.5, 0.75],
  iteration_cap = 1_000_000,
  transient_limit = 10_000,
  neutral_tolerance = 1e-8,
}) => {
  const span = catalog.records.find((row) => row.source_order === source_order);
  if (!span) throw new Error(`No legacy span exists at source order ${source_order}`);
  if (!fractions.length || fractions.some((fraction) => !Number.isFinite(fraction) || fraction <= 0 || fraction >= 1)) {
    throw new Error("Interior fractions must be finite values strictly between 0 and 1");
  }
  const calculations = fractions.map((fraction) => {
    const represented_r = span.min_r + (span.max_r - span.min_r) * fraction;
    const result = calculate_logistic_orbit(String(represented_r), {
      iteration_cap,
      transient_limit,
      retain_sample: false,
    });
    const points = result.cycle?.points || [];
    const primitive_candidate = approximate_primitive_cycle(
      result.r.represented_value,
      result.cycle,
      result.settings?.cycle_tolerance ?? 1e-12,
    );
    const candidate_points = primitive_candidate?.points || [];
    const multiplier = primitive_candidate
      ? logistic_cycle_multiplier(result.r.represented_value, candidate_points)
      : null;
    const magnitude = multiplier === null ? null : Math.abs(multiplier);
    const stability = magnitude === null ? "unresolved"
      : Math.abs(magnitude - 1) <= neutral_tolerance ? "near_neutral_candidate"
        : magnitude < 1 ? "attracting_candidate"
          : "non_attracting_candidate";
    return {
      fraction,
      submitted_r: result.r.input,
      represented_r: result.r.represented_value,
      calculator_status: result.status,
      machine_repeat_period: result.cycle?.period ?? null,
      candidate_period: primitive_candidate?.period ?? null,
      machine_cycle_points: points,
      primitive_candidate_points: candidate_points,
      machine_repeat_return_residual: result.cycle?.return_residual ?? null,
      return_residual: primitive_candidate?.return_residual ?? null,
      max_repetition_gap: primitive_candidate?.max_repetition_gap ?? null,
      primitive_period_validation: primitive_candidate?.validation ?? "no_candidate",
      cycle_validation_scope: result.cycle?.validation_scope ?? null,
      mathematical_proof: result.cycle?.mathematical_proof ?? false,
      multiplier,
      multiplier_magnitude: magnitude,
      stability,
      neutral_tolerance,
      iterations_completed: result.iterations_completed,
      settings: result.settings,
      timing: result.timing,
    };
  });
  return {
    review_version: 1,
    source_version: catalog.source_version,
    source_sha256: catalog.source_sha256,
    source_file: catalog.source_file,
    source_order,
    legacy_span: {
      min_r: span.min_r,
      max_r: span.max_r,
      width: span.width,
      legacy_regime: span.legacy_regime,
      legacy_count: span.legacy_count,
      classification_status: "unverified_legacy_observation",
    },
    method: {
      calculator: "calculate_logistic_orbit",
      multiplier: "product(r * (1 - 2 * x_k)) over returned cycle points",
      multiplier_interpretation: "finite-precision candidate evidence; not a proof for the exact real-valued map",
      approximate_primitive_period: "test each divisor of the machine repeat period; require both the reduced return residual and every repeated point gap to be within the calculator cycle tolerance",
    },
    calculations,
    interpretation: "Interior samples describe only their represented parameter values. Different candidate periods within this legacy interval mean its label must not be used as a uniform cycle-period classification.",
  };
};

export const review_span_interior_file = async ({
  source_path,
  source_order,
  fractions = [0.25, 0.5, 0.75],
  output_path,
  ...options
}) => {
  if (!source_path) throw new Error("Supply the legacy span source file path");
  const absolute_path = resolve(source_path);
  const source_text = await readFile(absolute_path, "utf8");
  const catalog = parse_legacy_span_catalog(source_text, absolute_path);
  const review = review_span_interior({ catalog, source_order, fractions, ...options });
  if (output_path) await writeFile(resolve(output_path), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  return review;
};

const is_main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (is_main) {
  const args = process.argv.slice(2);
  const value_after = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  try {
    const source_order_text = value_after("--source-order");
    const fractions_text = value_after("--fractions");
    const result = await review_span_interior_file({
      source_path: args.find((arg) => !arg.startsWith("--")),
      source_order: Number(source_order_text),
      fractions: fractions_text ? fractions_text.split(",").map(Number) : [0.25, 0.5, 0.75],
      iteration_cap: Number(value_after("--iteration-cap") || 1_000_000),
      transient_limit: Number(value_after("--transient-limit") || 10_000),
      output_path: value_after("--output"),
    });
    const summary = {
      source_order: result.source_order,
      source_sha256: result.source_sha256,
      calculations: result.calculations.map(({ fraction, represented_r, calculator_status, candidate_period, multiplier, multiplier_magnitude, stability, iterations_completed }) => ({
        fraction, represented_r, calculator_status, candidate_period, multiplier, multiplier_magnitude, stability, iterations_completed,
      })),
    };
    console.log(JSON.stringify(value_after("--output") ? { output_path: resolve(value_after("--output")), ...summary } : result, null, 2));
  } catch (error) {
    console.error(`Logistic-map span interior review failed: ${error.message}`);
    process.exitCode = 1;
  }
}
