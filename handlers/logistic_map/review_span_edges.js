import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { calculate_logistic_orbit } from "./calculator.js";
import { parse_legacy_span_catalog } from "./legacy_span_catalog.js";
import {
  approximate_primitive_cycle,
  logistic_cycle_multiplier,
} from "./review_span_interior.js";

const evaluate_r = (r, offset, iteration_cap, transient_limit) => {
  const result = calculate_logistic_orbit(String(r), {
    iteration_cap,
    transient_limit,
    retain_sample: false,
  });
  const cycle = result.cycle;
  const reduced = approximate_primitive_cycle(
    result.r.represented_value,
    cycle,
    result.settings?.cycle_tolerance ?? 1e-12,
  );
  const multiplier = reduced
    ? logistic_cycle_multiplier(result.r.represented_value, reduced.points)
    : null;
  return {
    offset,
    submitted_r: result.r.input,
    represented_r: result.r.represented_value,
    calculator_status: result.status,
    machine_repeat_period: cycle?.period ?? null,
    candidate_period: reduced?.period ?? null,
    machine_repeat_return_residual: cycle?.return_residual ?? null,
    candidate_return_residual: reduced?.return_residual ?? null,
    max_repetition_gap: reduced?.max_repetition_gap ?? null,
    multiplier,
    multiplier_magnitude: multiplier === null ? null : Math.abs(multiplier),
    validation_scope: cycle?.validation_scope ?? null,
    mathematical_proof: cycle?.mathematical_proof ?? false,
    iterations_completed: result.iterations_completed,
    settings: result.settings,
    timing: result.timing,
  };
};

export const finite_time_lyapunov_evidence = (r, iterations = 10_000_000, transient_limit = 10_000) => {
  let x = 0.5;
  let sum_log_slope = 0;
  for (let iteration = 0; iteration < iterations + transient_limit; iteration += 1) {
    const slope = r * (1 - 2 * x);
    x = r * x * (1 - x);
    if (iteration >= transient_limit) sum_log_slope += Math.log(Math.abs(slope));
  }
  return {
    represented_r: r,
    iterations,
    transient_discarded: transient_limit,
    finite_time_lyapunov_estimate: sum_log_slope / iterations,
    interpretation: "finite-time diagnostic only; neither positive values prove chaos nor non-positive values prove a stable periodic attractor",
  };
};

export const period_four_birth_bracket = () => {
  const exact_parameter = 1 + Math.sqrt(6);
  const lower_r = 3.44948974278;
  const upper_r = 3.44948974279;
  const period_two_multiplier = (r) => 4 + 2 * r - r * r;
  return {
    event_type: "period_doubling",
    transition: "stable period-2 cycle loses stability and a period-4 cycle is born",
    parameter_identity: "1 + sqrt(6)",
    lower_r,
    upper_r,
    exact_parameter,
    width: upper_r - lower_r,
    lower_period_two_multiplier: period_two_multiplier(lower_r),
    upper_period_two_multiplier: period_two_multiplier(upper_r),
    criterion: "the period-2 return multiplier crosses -1",
    source: "https://abel.math.harvard.edu/archive/118r_spring_05/handouts/feigenbaum.pdf",
    relation_to_legacy_lower_bound: "This known period-4 birth lies below the legacy span's reported min_r; the reported min_r itself is not the period-4 birth.",
  };
};

export const review_legacy_span_edges = ({
  catalog,
  source_order,
  local_iteration_cap = 1_000_000,
  endpoint_iteration_cap = 1_000_000_000,
  transient_limit = 10_000,
  endpoint_offsets = [-1e-6, -1e-8, -1e-10, 0, 1e-10, 1e-8, 1e-6],
  lyapunov_iterations = 10_000_000,
}) => {
  const span = catalog.records.find((row) => row.source_order === source_order);
  if (!span) throw new Error(`No legacy span exists at source order ${source_order}`);
  const left_edge_checks = endpoint_offsets.map((offset) => evaluate_r(
    span.min_r + offset, offset, local_iteration_cap, transient_limit,
  ));
  const right_offsets = [-1e-8, 0, 1e-8];
  const right_edge_checks = right_offsets.map((offset) => evaluate_r(
    span.max_r + offset, offset, endpoint_iteration_cap, transient_limit,
  ));
  const left_periods = new Set(left_edge_checks.map((check) => check.candidate_period));
  const left_edge_assessment = left_periods.size === 1 && !left_periods.has(null)
    ? "no_period_transition_observed_across_tested_neighborhood"
    : "transition_not_bracketed_by_current_samples";
  const right_edge_assessment = right_edge_checks.every((check) => check.candidate_period === null)
    ? "unresolved_at_iteration_cap_no_cycle_multiplier_available"
    : "transition_not_bracketed_by_current_samples";
  const lyapunov_parameters = [
    3.5699,
    3.569945672,
    3.56999,
    span.max_r - 1e-8,
    span.max_r,
    span.max_r + 1e-8,
  ];
  return {
    review_version: 1,
    source_version: catalog.source_version,
    source_sha256: catalog.source_sha256,
    source_order,
    legacy_span: {
      min_r: span.min_r,
      max_r: span.max_r,
      legacy_regime: span.legacy_regime,
      legacy_count: span.legacy_count,
      classification_status: "unverified_legacy_observation",
    },
    event_criteria: {
      period_doubling: "parent-cycle return multiplier equals -1",
      periodic_window_entry: "cycle return multiplier equals +1",
      end_of_cascade: "estimate from successive period-doubling parameters; not an exact finite-iteration chaos boundary",
      chaos: "finite-time diagnostics are reported separately and do not define an exact boundary",
    },
    left_edge: {
      tested_neighborhood: left_edge_checks,
      assessment: left_edge_assessment,
      event_type: null,
      note: "The reported lower bound has the same period-4 candidate on both sides at the tested offsets; its multiplier stays far from ±1. No bifurcation is bracketed at this legacy bound.",
    },
    right_edge: {
      tested_neighborhood: right_edge_checks,
      assessment: right_edge_assessment,
      event_type: null,
      note: "The calculator remains unresolved through the billion-iteration cap on both sides and at the reported upper bound. No cycle multiplier or event bracket is available; do not label this endpoint a chaos boundary.",
    },
    independently_identified_period_four_birth: period_four_birth_bracket(),
    separate_chaos_evidence: {
      kind: "finite_time_lyapunov_estimate",
      samples: lyapunov_parameters.map((r) => finite_time_lyapunov_evidence(r, lyapunov_iterations, transient_limit)),
      note: "Positive estimates near and above the reported upper bound are evidence consistent with chaos, kept separate from the edge/event assessment.",
    },
  };
};

export const review_legacy_span_edges_file = async ({
  source_path,
  source_order,
  output_path,
  ...options
}) => {
  if (!source_path) throw new Error("Supply the legacy span source file path");
  const absolute_path = resolve(source_path);
  const source_text = await readFile(absolute_path, "utf8");
  const catalog = parse_legacy_span_catalog(source_text, absolute_path);
  const report = review_legacy_span_edges({ catalog, source_order, ...options });
  if (output_path) await writeFile(resolve(output_path), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

const is_main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (is_main) {
  const args = process.argv.slice(2);
  const value_after = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  try {
    const report = await review_legacy_span_edges_file({
      source_path: args.find((arg) => !arg.startsWith("--")),
      source_order: Number(value_after("--source-order")),
      output_path: value_after("--output"),
    });
    console.log(JSON.stringify({
      output_path: value_after("--output") ? resolve(value_after("--output")) : undefined,
      source_order: report.source_order,
      left_edge: { assessment: report.left_edge.assessment, event_type: report.left_edge.event_type },
      right_edge: { assessment: report.right_edge.assessment, event_type: report.right_edge.event_type },
      independently_identified_period_four_birth: report.independently_identified_period_four_birth,
      chaos_evidence: report.separate_chaos_evidence.samples,
    }, null, 2));
  } catch (error) {
    console.error(`Logistic-map span edge review failed: ${error.message}`);
    process.exitCode = 1;
  }
}
