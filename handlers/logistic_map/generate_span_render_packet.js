import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { db_connect, db_disconnect } from "../../mysql.js";
import { calculate_logistic_orbit } from "./calculator.js";
import { parse_legacy_span_catalog } from "./legacy_span_catalog.js";
import {
  approximate_primitive_cycle,
  logistic_cycle_multiplier,
} from "./review_span_interior.js";
import { finite_time_lyapunov_evidence } from "./review_span_edges.js";
import { initialize_logistic_map_span_review_sample } from "./initialize_span_catalog.js";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const query_promise = (connection, sql, values = []) =>
  new Promise((resolve_query, reject) => {
    connection.query(sql, values, (error, result) =>
      error ? reject(error) : resolve_query(result),
    );
  });

export const thin_render_points = (values, limit = 512) => {
  if (values.length <= limit) return values;
  if (limit <= 1) return [values[0]];
  return Array.from({ length: limit }, (_, index) =>
    values[Math.floor(index * (values.length - 1) / (limit - 1))],
  );
};

export const generate_exploratory_span_packet = ({
  catalog,
  source_order,
  sample_count = 1024,
  iteration_cap = 1_000_000,
  transient_limit = 10_000,
  render_point_limit = 512,
  lyapunov_iterations = 100_000,
  lyapunov_neutral_tolerance = 1e-4,
}) => {
  const span = catalog.records.find((row) => row.source_order === source_order);
  if (!span) throw new Error(`No legacy span exists at source order ${source_order}`);
  if (!Number.isInteger(sample_count) || sample_count < 2 || sample_count > 4096) {
    throw new Error("sample_count must be an integer from 2 through 4096");
  }
  if (!Number.isInteger(iteration_cap) || iteration_cap < 1 || iteration_cap > 1_000_000_000) {
    throw new Error("iteration_cap must be an integer from 1 through 1,000,000,000");
  }
  if (!Number.isInteger(transient_limit) || transient_limit < 0 || transient_limit > iteration_cap) {
    throw new Error("transient_limit must be an integer between zero and iteration_cap");
  }
  if (!Number.isInteger(render_point_limit) || render_point_limit < 2 || render_point_limit > 4096) {
    throw new Error("render_point_limit must be an integer from 2 through 4096");
  }
  const generation_id = `${catalog.source_version}-span-${String(source_order).padStart(4, "0")}-grid${sample_count}-cap${iteration_cap}-transient${transient_limit}-lyap${lyapunov_iterations}-r2`;
  const samples = [];
  for (let sample_index = 0; sample_index < sample_count; sample_index += 1) {
    const fraction = (sample_index + 0.5) / sample_count;
    const r = span.min_r + (span.max_r - span.min_r) * fraction;
    const result = calculate_logistic_orbit(String(r), {
      iteration_cap,
      transient_limit,
      retain_sample: true,
    });
    const cycle = result.cycle;
    const reduced_cycle = approximate_primitive_cycle(
      result.r.represented_value,
      cycle,
      result.settings?.cycle_tolerance ?? 1e-12,
    );
    const multiplier = reduced_cycle
      ? logistic_cycle_multiplier(result.r.represented_value, reduced_cycle.points)
      : null;
    const lyapunov = finite_time_lyapunov_evidence(
      result.r.represented_value,
      lyapunov_iterations,
      transient_limit,
    );
    const lyapunov_estimate = lyapunov.finite_time_lyapunov_estimate;
    const lyapunov_evidence = lyapunov_estimate > lyapunov_neutral_tolerance
      ? "positive_finite_time_evidence"
      : lyapunov_estimate < -lyapunov_neutral_tolerance
        ? "negative_finite_time_evidence"
        : "near_zero_finite_time_evidence";
    const outcome = result.status === "numerical_failure"
      ? "numerical_failure"
      : reduced_cycle && lyapunov_evidence === "positive_finite_time_evidence"
        ? "conflicting_cycle_candidate_and_positive_lyapunov"
        : !reduced_cycle
          ? "unresolved_sample"
          : Math.abs(multiplier) < 1 - 1e-8
            ? "finite_precision_attracting_cycle_candidate"
            : Math.abs(Math.abs(multiplier) - 1) <= 1e-8
              ? "near_neutral_cycle_candidate"
              : "non_attracting_cycle_candidate";
    const source_values = reduced_cycle?.points || result.sample.values;
    const point_kind = reduced_cycle ? "finite_precision_cycle_candidate" : "bounded_orbit_tail";
    const sample = {
      sample_index,
      fraction,
      r: result.r.represented_value,
      outcome,
      point_kind,
      machine_repeat_period: cycle?.period ?? null,
      candidate_period: reduced_cycle?.period ?? null,
      return_residual: reduced_cycle?.return_residual ?? null,
      max_repetition_gap: reduced_cycle?.max_repetition_gap ?? null,
      multiplier,
      multiplier_magnitude: multiplier === null ? null : Math.abs(multiplier),
      finite_time_lyapunov_estimate: lyapunov_estimate,
      finite_time_lyapunov_iterations: lyapunov_iterations,
      finite_time_lyapunov_evidence: lyapunov_evidence,
      cycle_validation_scope: cycle?.validation_scope ?? null,
      mathematical_proof: false,
      iterations_completed: result.iterations_completed,
      sample_start_iteration: reduced_cycle ? cycle.start_iteration : result.sample.start_iteration,
      sample_end_iteration: result.sample.end_iteration,
      render_points: thin_render_points(source_values, render_point_limit),
      settings: result.settings,
    };
    samples.push(sample);
  }
  const outcome_counts = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.outcome))]
      .map((outcome) => [outcome, samples.filter((sample) => sample.outcome === outcome).length]),
  );
  const body = {
    packet_schema_version: 1,
    packet_generation_id: generation_id,
    source: {
      source_version: catalog.source_version,
      source_sha256: catalog.source_sha256,
      source_file: catalog.source_file,
      source_order,
      legacy_regime: span.legacy_regime,
      legacy_count: span.legacy_count,
      classification_status: "unverified_legacy_observation",
    },
    range_index: {
      min_r: span.min_r,
      max_r: span.max_r,
      range_role: "exploratory_legacy_observation_window",
      bounds_are_verified_events: false,
      sample_positions: "equal-width-bin-midpoints; the reported endpoints are retained as context, not asserted as bifurcations",
    },
    calculation: {
      calculator: "calculate_logistic_orbit",
      precision: { backend: "number", significant_digits: 16 },
      iteration_cap,
      transient_limit,
      seed_policy: { type: "critical_point", x0: 0.5 },
      candidate_validation: "finite-precision repeat; approximate primitive period checked against cycle tolerance; multiplier is candidate evidence only",
      finite_time_lyapunov: {
        iterations: lyapunov_iterations,
        transient_discarded: transient_limit,
        near_zero_tolerance: lyapunov_neutral_tolerance,
        interpretation: "separate finite-time evidence only; positive estimates do not prove chaos and may conflict with finite-precision cycle candidates",
      },
      unresolved_samples: "bounded post-transient orbit tail, not labeled chaos",
      render_point_limit,
    },
    outcome_counts,
    samples,
  };
  const checksum = sha256(JSON.stringify(body));
  const packet = {
    ...body,
    checksum: { algorithm: "sha256", value: checksum },
  };
  return { generation_id, packet, packet_sha256: checksum, outcome_counts };
};

const persist_samples = async ({ packet, packet_sha256, generation_id, connection_factory }) => {
  await initialize_logistic_map_span_review_sample(connection_factory);
  const connection = connection_factory();
  let locked = false;
  try {
    const lock_result = await query_promise(connection,
      "SELECT GET_LOCK('fracto_logistic_span_review', 30) AS acquired");
    locked = Number(lock_result?.[0]?.acquired) === 1;
    if (!locked) throw new Error("Could not acquire the span review import lock; retry later");
    const existing = await query_promise(connection,
      "SELECT `packet_sha256`, COUNT(*) AS row_count FROM `logistic_map_span_review_sample` WHERE `generation_id` = ? GROUP BY `packet_sha256`",
      [generation_id]);
    if (existing.length) {
      if (existing.length !== 1 || existing[0].packet_sha256 !== packet_sha256 || Number(existing[0].row_count) !== packet.samples.length) {
        throw new Error("This review generation already exists with different or incomplete content; use a new generation id");
      }
      return { already_persisted: true };
    }
    await query_promise(connection, "START TRANSACTION");
    try {
      for (const sample of packet.samples) {
        await query_promise(connection,
          "INSERT INTO `logistic_map_span_review_sample` (`generation_id`, `source_version`, `source_sha256`, `source_order`, `packet_sha256`, `sample_index`, `r_value`, `outcome`, `candidate_period`, `cycle_multiplier`, `review_record_json`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [generation_id, packet.source.source_version, packet.source.source_sha256,
            packet.source.source_order, packet_sha256, sample.sample_index, sample.r,
            sample.outcome, sample.candidate_period, sample.multiplier,
            JSON.stringify(sample)]);
      }
      await query_promise(connection, "COMMIT");
      return { already_persisted: false };
    } catch (error) {
      await query_promise(connection, "ROLLBACK");
      throw error;
    }
  } finally {
    if (locked) await query_promise(connection,
      "SELECT RELEASE_LOCK('fracto_logistic_span_review')").catch(() => {});
    db_disconnect(connection);
  }
};

const make_index = async (index_path, new_entry, source_version) => {
  let entries = [];
  try {
    const previous = JSON.parse(await readFile(index_path, "utf8"));
    if (previous.source_version !== source_version) {
      throw new Error("Existing render index is for a different source version");
    }
    entries = previous.entries || [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  entries = entries.map((entry) => {
    const source_order = entry.source_order ?? Number(entry.generation_id.match(/-span-(\d+)-/)?.[1]);
    return {
      ...entry,
      source_order,
      active: source_order === new_entry.source_order ? false : entry.active,
    };
  });
  entries.push({ ...new_entry, active: true });
  entries.sort((a, b) => a.min_r - b.min_r || a.max_r - b.max_r);
  const body = { index_schema_version: 1, source_version, entries };
  const checksum = sha256(JSON.stringify(body));
  await writeFile(index_path, `${JSON.stringify({ ...body, checksum: { algorithm: "sha256", value: checksum } }, null, 2)}\n`, "utf8");
};

export const generate_span_render_packet_file = async ({
  source_path,
  source_order,
  output_dir,
  connection_factory = db_connect,
  ...options
}) => {
  if (!source_path) throw new Error("Supply the legacy span source file path");
  const absolute_path = resolve(source_path);
  const source_text = await readFile(absolute_path, "utf8");
  const catalog = parse_legacy_span_catalog(source_text, absolute_path);
  const generated = generate_exploratory_span_packet({ catalog, source_order, ...options });
  const directory = resolve(output_dir || "handlers/logistic_map/render_packets");
  await mkdir(directory, { recursive: true });
  const packet_name = `${generated.generation_id}.json`;
  const packet_path = join(directory, packet_name);
  const index_path = join(directory, `index-${catalog.source_version}.json`);
  const persisted = await persist_samples({
    packet: generated.packet,
    packet_sha256: generated.packet_sha256,
    generation_id: generated.generation_id,
    connection_factory,
  });
  await writeFile(packet_path, `${JSON.stringify(generated.packet, null, 2)}\n`, "utf8");
  await make_index(index_path, {
    generation_id: generated.generation_id,
    file: basename(packet_path),
    min_r: generated.packet.range_index.min_r,
    max_r: generated.packet.range_index.max_r,
    packet_sha256: generated.packet_sha256,
    sample_count: generated.packet.samples.length,
    outcome_counts: generated.outcome_counts,
    range_role: generated.packet.range_index.range_role,
    source_order,
  }, catalog.source_version);
  return {
    generation_id: generated.generation_id,
    packet_path,
    index_path,
    packet_sha256: generated.packet_sha256,
    sample_count: generated.packet.samples.length,
    outcome_counts: generated.outcome_counts,
    ...persisted,
  };
};

const is_main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (is_main) {
  const args = process.argv.slice(2);
  const value_after = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const source_path = args.find((arg) => !arg.startsWith("--"));
  try {
    const result = await generate_span_render_packet_file({
      source_path,
      source_order: Number(value_after("--source-order") || 0),
      sample_count: Number(value_after("--sample-count") || 1024),
      iteration_cap: Number(value_after("--iteration-cap") || 1_000_000),
      transient_limit: Number(value_after("--transient-limit") || 10_000),
      render_point_limit: Number(value_after("--render-point-limit") || 512),
      output_dir: value_after("--output-dir"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Exploratory span packet generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
