import { createHash } from "node:crypto";
import { basename } from "node:path";

export const LEGACY_SPAN_SOURCE_VERSION = "bifurq-spans-v1";

// Return array member source slices, retaining each original object's exact JSON.
const array_object_slices = (text) => {
  const slices = [];
  let cursor = 0;
  while (/\s|,/.test(text[cursor] || "")) cursor += 1;
  if (text[cursor] !== "[") throw new Error("Source catalog must be a JSON array");
  cursor += 1;
  while (cursor < text.length) {
    while (/\s|,/.test(text[cursor] || "")) cursor += 1;
    if (text[cursor] === "]") {
      cursor += 1;
      if (text.slice(cursor).trim()) throw new Error("Unexpected data after source array");
      return slices;
    }
    const start = cursor;
    if (text[cursor] !== "{") throw new Error(`Catalog entry ${slices.length} must be an object`);
    let depth = 0;
    let in_string = false;
    let escaped = false;
    for (; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (in_string) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') in_string = false;
        continue;
      }
      if (char === '"') in_string = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        cursor += 1;
        slices.push(text.slice(start, cursor));
        break;
      }
    }
    if (depth !== 0 || in_string) throw new Error(`Catalog entry ${slices.length} is incomplete`);
  }
  throw new Error("Source catalog array is not closed");
};

const validate_record = (record, order) => {
  const numeric_fields = ["min_r", "max_r", "width", "regime", "count"];
  for (const field of numeric_fields) {
    if (!Object.hasOwn(record, field) || !Number.isFinite(record[field])) {
      throw new Error(`Catalog entry ${order} has a missing or invalid ${field}`);
    }
  }
  if (record.min_r >= record.max_r || record.width <= 0) {
    throw new Error(`Catalog entry ${order} has invalid bounds or width`);
  }
  if (!Number.isInteger(record.regime)) throw new Error(`Catalog entry ${order} has a non-integer regime`);
  if (!Number.isSafeInteger(record.count) || record.count < 0) {
    throw new Error(`Catalog entry ${order} has an invalid legacy count`);
  }
};

export const parse_legacy_span_catalog = (text, source_file = "spans.json") => {
  const source_sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  const raw_records = array_object_slices(text);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length !== raw_records.length) {
    throw new Error("Source catalog entries could not be preserved in order");
  }
  const records = parsed.map((record, source_order) => {
    validate_record(record, source_order);
    return {
      source_order,
      min_r: record.min_r,
      max_r: record.max_r,
      width: record.width,
      legacy_regime: record.regime,
      legacy_count: record.count,
      source_record_json: raw_records[source_order],
    };
  });
  return {
    source_version: LEGACY_SPAN_SOURCE_VERSION,
    source_sha256,
    source_file: basename(source_file),
    records,
  };
};

/** Report catalog geometry without rewriting or classifying legacy rows. */
export const summarize_legacy_span_catalog = (records) => {
  const sorted = [...records].sort((a, b) => a.min_r - b.min_r || a.max_r - b.max_r);
  let duplicate_bounds = 0;
  let overlaps = 0;
  let nested = 0;
  let gaps = 0;
  const seen = new Set();
  let furthest_max = -Infinity;
  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    const key = `${row.min_r}\u0000${row.max_r}`;
    if (seen.has(key)) duplicate_bounds += 1;
    seen.add(key);
    if (i > 0 && row.min_r < furthest_max) overlaps += 1;
    if (i > 0 && row.max_r <= furthest_max) nested += 1;
    if (i > 0 && row.min_r > sorted[i - 1].max_r) gaps += 1;
    furthest_max = Math.max(furthest_max, row.max_r);
  }
  return { imported_count: records.length, rejected_count: 0, duplicate_bounds, overlaps, nested, gaps };
};

const audit_row = (row) => ({
  source_order: row.source_order,
  min_r: row.min_r,
  max_r: row.max_r,
  width: row.width,
  legacy_regime: row.legacy_regime,
  legacy_count: row.legacy_count,
});

/** Record geometry and width findings without changing source rows. */
export const audit_legacy_span_catalog = (catalog) => {
  const rows = catalog.records;
  const sorted = [...rows].sort((a, b) => a.min_r - b.min_r || a.max_r - b.max_r || a.source_order - b.source_order);
  const duplicate_groups_by_bounds = new Map();
  for (const row of rows) {
    const key = `${row.min_r}\u0000${row.max_r}`;
    const group = duplicate_groups_by_bounds.get(key) || [];
    group.push(row);
    duplicate_groups_by_bounds.set(key, group);
  }
  const duplicate_bound_groups = [...duplicate_groups_by_bounds.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ bounds: { min_r: group[0].min_r, max_r: group[0].max_r }, entries: group.map(audit_row) }));

  const overlap_pairs = [];
  const touching_pairs = [];
  const gaps = [];
  for (let left_index = 0; left_index < sorted.length; left_index += 1) {
    const left = sorted[left_index];
    for (let right_index = left_index + 1; right_index < sorted.length; right_index += 1) {
      const right = sorted[right_index];
      if (right.min_r >= left.max_r) break;
      {
        const exact_duplicate = left.min_r === right.min_r && left.max_r === right.max_r;
        const right_contains = right.min_r <= left.min_r && right.max_r >= left.max_r;
        const left_contains = left.min_r <= right.min_r && left.max_r >= right.max_r;
        const kind = exact_duplicate ? "duplicate_bounds"
          : right_contains || left_contains ? "nested"
            : "partial_overlap";
        overlap_pairs.push({
          kind,
          left: audit_row(left),
          right: audit_row(right),
          intersection: { min_r: right.min_r, max_r: Math.min(left.max_r, right.max_r) },
        });
      }
    }
    for (let right_index = left_index + 1; right_index < sorted.length; right_index += 1) {
      const right = sorted[right_index];
      if (right.min_r > left.max_r) break;
      if (right.min_r === left.max_r) {
        touching_pairs.push({ left: audit_row(left), right: audit_row(right), boundary_r: left.max_r });
      }
    }
  }
  let union_end = null;
  let union_row = null;
  for (const row of sorted) {
    if (union_end !== null && row.min_r > union_end) {
      gaps.push({ left: audit_row(union_row), right: audit_row(row), min_r: union_end, max_r: row.min_r });
    }
    if (union_end === null || row.max_r > union_end) {
      union_end = row.max_r;
      union_row = row;
    }
  }

  const width_inconsistencies = rows.flatMap((row) => {
    const calculated_width = row.max_r - row.min_r;
    const delta = row.width - calculated_width;
    const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(row.min_r), Math.abs(row.max_r), Math.abs(row.width));
    return Math.abs(delta) > tolerance
      ? [{ ...audit_row(row), calculated_width, width_delta: delta, tolerance }]
      : [];
  });

  return {
    audit_version: 1,
    source_version: catalog.source_version,
    source_sha256: catalog.source_sha256,
    source_file: catalog.source_file,
    source_entry_count: rows.length,
    summary: {
      duplicate_bound_groups: duplicate_bound_groups.length,
      duplicate_bound_entries: duplicate_bound_groups.reduce((sum, group) => sum + group.entries.length, 0),
      overlapping_pairs: overlap_pairs.length,
      nested_pairs: overlap_pairs.filter((pair) => pair.kind === "nested").length,
      partial_overlap_pairs: overlap_pairs.filter((pair) => pair.kind === "partial_overlap").length,
      touching_pairs: touching_pairs.length,
      gaps: gaps.length,
      width_inconsistencies: width_inconsistencies.length,
    },
    findings: {
      duplicate_bound_groups,
      overlap_pairs,
      touching_pairs,
      gaps,
      width_inconsistencies,
    },
  };
};
