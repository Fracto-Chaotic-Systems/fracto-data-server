import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  audit_legacy_span_catalog,
  parse_legacy_span_catalog,
  summarize_legacy_span_catalog,
  LEGACY_SPAN_SOURCE_VERSION,
} from "../handlers/logistic_map/legacy_span_catalog.js";
import {
  initialize_logistic_map_span_catalog,
  initialize_logistic_map_span_review_sample,
  LOGISTIC_MAP_SPAN_CATALOG_DEFINITION,
  LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION,
} from "../handlers/logistic_map/initialize_span_catalog.js";
import {
  logistic_cycle_multiplier,
  review_span_interior,
} from "../handlers/logistic_map/review_span_interior.js";
import {
  period_four_birth_bracket,
  review_legacy_span_edges,
} from "../handlers/logistic_map/review_span_edges.js";
import {
  generate_exploratory_span_packet,
  thin_render_points,
} from "../handlers/logistic_map/generate_span_render_packet.js";

const archive_path = fileURLToPath(new URL("../handlers/logistic_map/legacy_spans_bifurq_v1.json", import.meta.url));

test("archived legacy catalog is imported in source order with legacy semantics intact", async () => {
  const source = await readFile(archive_path, "utf8");
  const catalog = parse_legacy_span_catalog(source, archive_path);
  assert.equal(catalog.source_version, LEGACY_SPAN_SOURCE_VERSION);
  assert.equal(catalog.records.length, 1167);
  assert.equal(catalog.records[0].source_order, 0);
  assert.equal(catalog.records.at(-1).source_order, 1166);
  assert.equal(catalog.records[0].legacy_regime, 2);
  assert.equal(catalog.records[0].legacy_count, 17716);
  assert.deepEqual(JSON.parse(catalog.records[0].source_record_json), JSON.parse(source)[0]);
  assert.match(catalog.records[0].source_record_json, /"min_r"\s*:\s*3\.5000157834898675/);
  assert.equal(Object.hasOwn(catalog.records[0], "cycle_cardinality"), false);
  assert.equal(catalog.records[0].min_r, JSON.parse(source)[0].min_r);
  assert.equal(catalog.source_sha256.length, 64);
});

test("legacy catalog parser rejects malformed and semantically invalid records", () => {
  assert.throws(() => parse_legacy_span_catalog("[{"), /incomplete|JSON/);
  assert.throws(() => parse_legacy_span_catalog('[{"min_r":3,"max_r":3,"width":1,"regime":1,"count":1}]'), /invalid bounds/);
  assert.throws(() => parse_legacy_span_catalog('[{"min_r":3,"max_r":4,"width":1,"regime":1,"count":1.5}]'), /invalid legacy count/);
});

test("source order retains identical entries as distinct catalog rows", () => {
  const source = '[{"min_r":3,"max_r":3.5,"width":0.5,"regime":2,"count":17},{"min_r":3,"max_r":3.5,"width":0.5,"regime":2,"count":17}]';
  const catalog = parse_legacy_span_catalog(source);
  assert.deepEqual(catalog.records.map((row) => row.source_order), [0, 1]);
  assert.equal(summarize_legacy_span_catalog(catalog.records).duplicate_bounds, 1);
});

test("catalog audit records duplicates, overlap kinds, touching, gaps, and width discrepancies without editing rows", () => {
  const source = JSON.stringify([
    { min_r: 1, max_r: 4, width: 3, regime: 2, count: 10 },
    { min_r: 1, max_r: 4, width: 3, regime: 3, count: 11 },
    { min_r: 2, max_r: 3, width: 1, regime: 4, count: 12 },
    { min_r: 3.5, max_r: 5, width: 1.5, regime: 5, count: 13 },
    { min_r: 5, max_r: 6, width: 1, regime: 6, count: 14 },
    { min_r: 7, max_r: 8, width: 2, regime: 7, count: 15 },
  ]);
  const catalog = parse_legacy_span_catalog(source);
  const report = audit_legacy_span_catalog(catalog);
  assert.equal(report.summary.duplicate_bound_groups, 1);
  assert.equal(report.summary.nested_pairs, 2);
  assert.equal(report.summary.partial_overlap_pairs, 2);
  assert.equal(report.summary.touching_pairs, 1);
  assert.equal(report.summary.gaps, 1);
  assert.deepEqual(report.findings.width_inconsistencies.map((row) => row.source_order), [5]);
  assert.equal(report.findings.overlap_pairs.some((pair) => pair.kind === "duplicate_bounds"), true);
  assert.equal(catalog.records[0].source_order, 0);
  assert.equal(catalog.records[0].max_r, 4);
});

test("archived catalog audit is versioned and retains references to all involved source ordinals", async () => {
  const source = await readFile(archive_path, "utf8");
  const report = audit_legacy_span_catalog(parse_legacy_span_catalog(source, archive_path));
  assert.equal(report.source_entry_count, 1167);
  assert.equal(report.source_version, LEGACY_SPAN_SOURCE_VERSION);
  assert.equal(report.source_sha256.length, 64);
  for (const group of report.findings.duplicate_bound_groups) {
    for (const row of group.entries) assert.ok(Number.isInteger(row.source_order));
  }
  for (const pair of report.findings.overlap_pairs) {
    assert.ok(Number.isInteger(pair.left.source_order));
    assert.ok(Number.isInteger(pair.right.source_order));
  }
});

test("pilot interior calculations report finite-precision periods and multipliers without promoting legacy metadata", async () => {
  const source = await readFile(archive_path, "utf8");
  const catalog = parse_legacy_span_catalog(source, archive_path);
  const review = review_span_interior({ catalog, source_order: 0, iteration_cap: 1_000_000, transient_limit: 10_000 });
  assert.deepEqual(review.calculations.map((calculation) => calculation.machine_repeat_period), [4, 8, 8]);
  assert.deepEqual(review.calculations.map((calculation) => calculation.candidate_period), [4, 4, 8]);
  assert.ok(review.calculations.every((calculation) => calculation.calculator_status === "cycle_candidate"));
  assert.ok(review.calculations.every((calculation) => calculation.cycle_validation_scope === "finite_precision"));
  assert.ok(review.calculations.every((calculation) => calculation.mathematical_proof === false));
  assert.ok(review.calculations.every((calculation) => calculation.multiplier_magnitude < 1));
  assert.equal(review.calculations[1].primitive_period_validation, "reduced_within_tolerance");
  assert.ok(review.calculations[1].max_repetition_gap <= 1e-12);
  assert.equal(review.legacy_span.legacy_regime, 2);
  assert.equal(review.legacy_span.classification_status, "unverified_legacy_observation");
  assert.equal(logistic_cycle_multiplier(3.5, []), null);
});

test("edge review leaves unbracketed endpoints unresolved and keeps chaos evidence separate", async () => {
  const source = await readFile(archive_path, "utf8");
  const catalog = parse_legacy_span_catalog(source, archive_path);
  const report = review_legacy_span_edges({
    catalog,
    source_order: 0,
    local_iteration_cap: 50_000,
    endpoint_iteration_cap: 50_000,
    endpoint_offsets: [-1e-8, 0, 1e-8],
    lyapunov_iterations: 100,
  });
  assert.equal(report.left_edge.event_type, null);
  assert.equal(report.left_edge.assessment, "no_period_transition_observed_across_tested_neighborhood");
  assert.equal(report.right_edge.assessment, "unresolved_at_iteration_cap_no_cycle_multiplier_available");
  assert.ok(report.separate_chaos_evidence.samples.every((sample) => sample.finite_time_lyapunov_estimate !== undefined));
  assert.ok(report.right_edge.tested_neighborhood.every((sample) => sample.candidate_period === null));
});

test("known period-four birth bracket straddles the parent period-two multiplier at -1", () => {
  const bracket = period_four_birth_bracket();
  assert.ok(bracket.lower_r < bracket.exact_parameter);
  assert.ok(bracket.exact_parameter < bracket.upper_r);
  assert.ok(bracket.lower_period_two_multiplier > -1);
  assert.ok(bracket.upper_period_two_multiplier < -1);
  assert.equal(bracket.event_type, "period_doubling");
});

test("exploratory packet uses midpoint samples, labels unverified bounds, and includes unresolved orbit data", async () => {
  const source = await readFile(archive_path, "utf8");
  const catalog = parse_legacy_span_catalog(source, archive_path);
  const generated = generate_exploratory_span_packet({
    catalog,
    source_order: 0,
    sample_count: 4,
    iteration_cap: 100,
    transient_limit: 10,
    render_point_limit: 16,
  });
  const packet = generated.packet;
  assert.equal(packet.range_index.bounds_are_verified_events, false);
  assert.equal(packet.samples.length, 4);
  assert.ok(packet.samples.every((sample) => sample.r > packet.range_index.min_r && sample.r < packet.range_index.max_r));
  assert.ok(packet.samples.every((sample) => sample.render_points.length <= 16));
  assert.ok(packet.samples.some((sample) => sample.outcome === "unresolved_sample" && sample.point_kind === "bounded_orbit_tail"));
  assert.ok(packet.samples.every((sample) => sample.mathematical_proof === false));
  assert.ok(packet.samples.every((sample) => Number.isFinite(sample.finite_time_lyapunov_estimate)));
  assert.ok(packet.samples.every((sample) => [
    "positive_finite_time_evidence",
    "negative_finite_time_evidence",
    "near_zero_finite_time_evidence",
  ].includes(sample.finite_time_lyapunov_evidence)));
  assert.deepEqual(packet.checksum, { algorithm: "sha256", value: generated.packet_sha256 });
  const body = { ...packet };
  delete body.checksum;
  assert.equal(generated.packet_sha256, createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex"));
  assert.equal(packet.packet_generation_id, generated.generation_id);
  assert.equal(thin_render_points([0, 1, 2, 3, 4], 3).length, 3);
});

test("schema stores source version, checksum, source order, original object, and explicit legacy fields", async (t) => {
  const statements = [];
  const connection = {
    query(sql, callback) { statements.push(sql); callback(null, []); },
    end(callback) { callback(); },
  };
  t.mock.method(console, "log", () => {});
  await initialize_logistic_map_span_catalog(() => connection);
  const create = statements[0];
  assert.match(create, /`source_version` VARCHAR/);
  assert.match(create, /`source_sha256` CHAR\(64\)/);
  assert.match(create, /`source_order` INT UNSIGNED/);
  assert.match(create, /`legacy_regime` INT/);
  assert.match(create, /`legacy_count` BIGINT UNSIGNED/);
  assert.match(create, /`source_record_json` LONGTEXT/);
  assert.match(create, /UNIQUE INDEX `uq_logistic_span_source_order`/);
  assert.equal(LOGISTIC_MAP_SPAN_CATALOG_DEFINITION.table, "logistic_map_span_catalog");
});

test("review-sample schema stores immutable packet identity and mutable per-r outcomes", async () => {
  const statements = [];
  const connection = {
    query(sql, callback) {
      statements.push(sql);
      if (sql.startsWith("SHOW COLUMNS")) callback(null, []);
      else callback(null, []);
    },
    end(callback) { callback(); },
  };
  await initialize_logistic_map_span_review_sample(() => connection);
  const create_sql = statements[0];
  assert.match(create_sql, /`generation_id` VARCHAR\(160\)/);
  assert.match(create_sql, /`packet_sha256` CHAR\(64\)/);
  assert.match(create_sql, /`source_order` INT UNSIGNED/);
  assert.match(create_sql, /`outcome` VARCHAR\(64\)/);
  assert.match(create_sql, /`review_record_json` LONGTEXT/);
  assert.match(create_sql, /UNIQUE INDEX `uq_logistic_span_review_generation_sample`/);
  assert.equal(LOGISTIC_MAP_SPAN_REVIEW_SAMPLE_DEFINITION.table, "logistic_map_span_review_sample");
});

test("review-sample initializer widens an existing outcome column for explicit evidence labels", async () => {
  const statements = [];
  const connection = {
    query(sql, callback) {
      statements.push(sql);
      if (sql.startsWith("SHOW COLUMNS")) callback(null, [{ Field: "outcome", Type: "varchar(32)" }]);
      else callback(null, []);
    },
    end(callback) { callback(); },
  };
  await initialize_logistic_map_span_review_sample(() => connection);
  assert.ok(statements.some((sql) => sql.includes("MODIFY COLUMN `outcome` VARCHAR(64)")));
});
