# Logistic-map regime-span migration plan

## Purpose and decision

This document records the migration plan for using the observed regime spans from the earlier bifurcation application as the organizing guide for Fracto's logistic-map calculations. It is deliberately separate from the logistic-map `README.md`, which describes the current calculator and broader mathematical background. This plan covers importing the legacy span catalog, reviewing each span and its edges with Fracto's current numerical methods, and eventually producing read-optimized files for rendering.

The selected direction is **regime-span-led, adaptive work**:

- The legacy spans identify promising areas where stable periodic behavior was observed and where interior calculations may converge relatively quickly.
- Fracto recalculates and verifies results using the current contract, arithmetic, and validation rules. Legacy labels and boundaries remain hypotheses until reviewed.
- Calculation effort is concentrated inside known spans, around their edges, and in nearby regions where stability may begin or end.
- A low-cost scan across the wider parameter range remains necessary to discover stable windows absent from the legacy catalog. The legacy list must not become an assumption that all stable regions have already been found.
- During review, MySQL holds the span catalog and mutable verification state. After verification, immutable, versioned packets can be generated for fast rendering, following the general read-optimized pattern used elsewhere in Fracto.
- The standalone legacy orbit-point records are not part of the initial import. They would have to be recalculated or independently verified, are large and irregular, and lack sufficient provenance to serve as trusted results. Retain an archival/reference copy outside runtime dependencies while migration decisions are in progress.

The initial migration is intentionally narrow: import the **1,167 span definitions** from the legacy `regimes/spans.json` into a table, preserve their source representation, and audit the import. Do not begin numerical edge review or generate render packets in that first step.

## Scope and non-goals

This effort covers:

1. Importing the legacy span catalog without silently changing its meaning.
2. Auditing its ranges and classification fields.
3. Defining and recording interior verification and left/right edge review.
4. Referring to stable cycle and bifurcation evidence using explicit numerical criteria.
5. Generating versioned rendering packets only after review data is adequate.

The first stages do not:

- Import all per-parameter orbit arrays or the legacy `non_span` files into Fracto's live store.
- Treat a legacy `regime`, `count`, or endpoint as verified mathematical truth.
- Declare chaos solely because a finite computation did not find a cycle.
- Change the current global parameter addressing scheme or claim full coverage from the legacy catalog.
- Replace the standalone diagnostic calculator, expose a new public API, or add UI rendering before the catalog and verification workflow are defined.

## What the legacy catalog contains

The inspected legacy project is under `D:\react-apps\src\bifurq`. Its `regimes/spans.json` contains 1,167 objects with fields resembling:

```json
{
  "min_r": 3.5000157834898675,
  "max_r": 3.570063016267453,
  "width": 0.0700472327775854,
  "regime": 2,
  "count": 17716
}
```

The catalog covers observed subintervals in approximately `[3.5, 4)`. It is irregularly sampled and organized around observed spans, rather than uniform cells. The list includes 22 distinct legacy regime labels. The `count` field can be much larger than a plausible orbit period; preserve it as the raw legacy count field and **do not interpret it as cycle cardinality** until its source semantics are confirmed. The `regime` field is also a legacy label, not a verified period. Its exact semantics must be documented from the legacy code and checked against recalculated interiors before Fracto uses it as a classification.

The same directory also has 32 `regime_*.json` files with 106,004 parameter-to-point-list records, and 64 `non_span_*.json.json` files with 63,829 parameter-to-count/seed records. These datasets total roughly 143 MiB with the span catalog. They are not included in the first migration: they are nonuniform individual observations, use a different detection method, and omit enough run provenance that bulk promotion would be unsafe. They may remain offline reference material for comparisons or future seed experiments, but the span catalog is the initial migration input.

The legacy detector rounds iterates into string keys and limits search/period behavior differently from Fracto's exact-checkpoint calculator. Its stored results can help explain why a span was identified, but cannot substitute for recalculation. In particular, a matching image or matching period label is not a verification result.

## Terminology and evidence model

Use these concepts separately in storage and UI:

- **Legacy span:** the interval and labels as imported, unchanged.
- **Candidate span:** an interval being investigated because the legacy catalog or Fracto's own scan suggests stable behavior.
- **Verified interior:** one or more recalculated `r` values inside the interval with a validated cycle candidate and recorded settings.
- **Verified stable range:** an interval for which the relevant cycle branch and endpoints have been reviewed to the chosen parameter precision.
- **Boundary bracket:** lower and upper `r` values enclosing a transition, including precision and numerical evidence. Store a bracket rather than claiming an exact real-number boundary from finite calculations.
- **Boundary event:** a classified event such as a saddle-node entry, period-doubling (flip), cascade-accumulation estimate, crisis, or unknown/unresolved transition.
- **Chaotic evidence:** finite numerical evidence such as sustained nonperiodic behavior and a positive finite-time Lyapunov estimate. It is not a proof that every nearby real parameter is chaotic.
- **Unresolved:** evidence or resource limits do not support a verified classification. This is a valid result state and must not be rewritten as “chaos.”

An interval's legacy bounds, the currently verified stable range, and a later render-packet range may differ. Keep each value and its provenance distinct. Preserve whether endpoint inclusion is known; do not assume the old minimum/maximum values define exact closed or half-open boundaries.

## Numerical criteria for reviewing span edges

For the logistic map

```text
f_r(x) = r * x * (1 - x)
```

and a verified period-`p` orbit `x[0] ... x[p-1]`, calculate the return multiplier

```text
M_p = product(i = 0..p-1, r * (1 - 2 * x[i]))
```

which is the derivative of `f_r` iterated `p` times at a cycle point. The cycle is attracting when `|M_p| < 1`, subject to numerical tolerance and validation. A period-doubling/flip transition is associated with `M_p = -1`; the period-`p` cycle then loses stability while a period-`2p` cycle can become stable. A periodic window can begin through a saddle-node/tangent event associated with `M_p = +1`.

These events are not interchangeable with “the onset of chaos.” A stable period-`p` branch ending at a flip does not mean chaos immediately follows: stable doubled cycles may follow it. To estimate the end of a period-doubling cascade, locate successive flip parameters `r_n` for periods `p, 2p, 4p, ...` and estimate their accumulation point from the shrinking intervals. Feigenbaum scaling is useful as a convergence diagnostic, not as a substitute for calculated brackets. Periodic windows occur within chaotic parameter regions, so chaos is not a permanent one-time transition across `[3, 4)`.

The main logistic-map cascade accumulates near `r = 3.56994567...`; other stable windows have their own cascades and accumulation estimates. The value for the main cascade must not be copied as the edge of an unrelated legacy span. Mathematical background and the multiplier criteria are summarized in the logistic-map README and its cited sources.

For a finite workflow, an “edge” is therefore represented by a bracket and an event classification, for example:

- `period_doubling`: a verified `p`-cycle branch approaches `M_p = -1`, and `2p` behavior is checked on the other side;
- `saddle_node_entry`: a candidate periodic window begins around `M_p = +1`;
- `cascade_accumulation_estimate`: multiple successive period doublings support an estimated return to chaotic behavior;
- `crisis_or_other_transition`: a different change in the attractor is supported by evidence;
- `unknown` or `unresolved`: insufficient evidence to assign a boundary type.

The software should not infer any one of these solely from a failed exact-repeat search, an iteration cap, or a visually empty plot. Near neutral multipliers, finite-time convergence can be extremely slow; preserve the cap, transient, seed, precision, tolerance, and outcome with each review.

## Proposed storage design

### Catalog table

Create an immutable-source catalog table in the data server's database, tentatively `logistic_map_span_catalog`. It should contain at least:

- stable row ID;
- source/catalog version and source file identity;
- source array ordinal, so each original entry can be traced even if two entries are identical;
- original `min_r`, `max_r`, `width`, `regime`, and `count` values;
- a lossless representation of the original JSON values or raw numeric text, in addition to numeric columns used for range searches;
- import timestamp and source checksum.

Use numeric columns appropriate for ordered range lookup, but do not rely on a rounded floating representation as the only preserved source value. Keep the original file as an archived source artifact. The migration must test round-trip behavior before finalizing precision/scale. Do not normalize overlapping or nested legacy intervals during import.

The source catalog is immutable after import. A future catalog correction or new upstream observation becomes a new source version, not an in-place rewrite that erases what the earlier app supplied.

### Review data

Keep mutable verification state separate from the source catalog, either in a review table or an append-only review model. A review needs to identify:

- the catalog span and review revision;
- current status (`pending`, `interior_checked`, `edges_bracketed`, `verified`, `needs_refinement`, or `rejected`);
- one or more interior `r` checks and their detected periods;
- left and right edge brackets, event types, inclusion convention, and supporting observations;
- arithmetic backend/precision, seed policy, cap, transient, tolerances, algorithm version, and timestamps;
- links to individual calculation results or packets, without copying large point arrays into every review row.

Where the two edges require different evidence, represent each edge independently rather than packing both into a single ambiguous status. Preserve prior review revisions for auditability. Do not store a single boolean `verified=true` without saying what was verified and at what resolution.

### Render packets

After review, generate immutable, versioned packet files grouped/indexed by parameter interval. A packet should contain the verified samples needed to draw that range, their statuses and render metadata, plus a manifest with schema/algorithm version, range identity, generation ID, and checksum. File naming and range addressing must be deterministic and must preserve exact interval identity; display decimals are not identity keys.

The database remains the editable source for catalog and review workflow. Packets are derived read-optimized output and can be regenerated. The UI should fetch only packets covering the visible range/resolution, not bundle the entire legacy dataset into the browser. Do not generate or publish packets from pending or merely legacy-labeled spans.

## Staged implementation plan

### Stage 1 — Import and audit the legacy span catalog

1. Add a data-server schema migration for the catalog table only.
2. Add an explicit, repeatable import command that reads a supplied `spans.json` file; do not hard-code the developer's `D:\react-apps` path into the service.
3. Parse and validate the expected fields, record the file checksum/version, and import exactly 1,167 source entries without dropping duplicates.
4. Make import idempotent by source version/checksum and ordinal; a retry must not duplicate rows or overwrite another source version.
5. Produce a summary of imported count, rejected rows, missing fields, numeric round-trip differences, duplicate rows, overlaps, nesting, and gaps.
6. Add tests for a clean import, rerun, malformed input, duplicate values at different ordinals, boundary values, and exact source-value preservation.

**Acceptance:** the catalog row count matches the source; every source entry can be reconstructed/audited; source labels remain explicitly legacy; importing changes no calculator behavior and creates no render files.

### Stage 2 — Audit structure and define review order

1. Sort intervals numerically without changing source order in storage.
2. Report duplicates, strict overlaps, nested intervals, touching endpoints, and gaps.
3. Determine from source code/documentation what `regime` means; keep an “unknown legacy meaning” label until this is checked.
4. Choose an initial review order that starts with spans having simple, quickly verified interior cycles, then proceeds to narrower and higher-period spans.
5. Record the rule for selecting interior anchors. Do not use midpoint alone if the interval may contain multiple nested regime branches; use multiple interior points when needed.

**Acceptance:** every catalog row has an audit disposition, but no ranges are merged or corrected without recorded evidence.

### Stage 3 — Add review record and multiplier evidence

1. Extend calculation output with the cycle multiplier and stable/neutral/unstable assessment, with a documented numerical tolerance. Compute it from the ordered cycle points and use numerically appropriate accumulation for large periods.
2. Add a review record format that preserves the exact `r` text, cycle period, ordered point set or reference, return residual, multiplier, precision, seed, iteration settings, detector version, and wall-clock diagnostics.
3. Run one or more interior calculations for a selected span. Require primitive-period, return-residual, and attracting-multiplier checks before using that cycle as an edge anchor.
4. Keep higher precision/Newton as separate refinement evidence. Newton may solve/sharpen `f_r^p(x)-x=0`, but must not replace residual, primitive-period, or multiplier checks.

**Acceptance:** an interior review can distinguish verified attracting cycle, neutral/near-boundary candidate, unresolved, and numerical failure, with settings and provenance available for reproduction.

### Stage 4 — Refine individual edges

1. Select one legacy span with a verified interior and make it the pilot; do not launch all 1,167 reviews simultaneously.
2. For each endpoint, sample successively closer `r` values on both sides, reusing a nearby cycle only as a starting hypothesis. Every candidate must be validated for the requested `r`.
3. Maintain a bracket with known outcomes on each side. Refine by bisection or a root method once the relevant event equation and branch are identified.
4. For a period-`p` edge, test whether the transition is a flip (`M_p` approaches `-1`), a saddle-node entry (`M_p` approaches `+1`), or another event. Check the adjacent parameter side for period `2p` or another stable cycle before describing a transition as chaotic.
5. If the goal is the end of a doubling cascade, continue the `p, 2p, 4p, ...` sequence and estimate the accumulation point from multiple measured bifurcation intervals. Store the estimate and bracket separately from any exact edge value.
6. For chaotic-return evidence, record finite-time indicators and observation length. A positive finite-time Lyapunov estimate or sustained unresolved orbit is evidence, not a proof of chaos. Preserve `unresolved` when the evidence is inadequate.
7. Store the original legacy endpoint, the verified bracket, the estimated boundary if available, endpoint inclusion convention, and the evidence/settings that support them.

**Acceptance:** the pilot span's interior and both edges have explicit, reproducible review records. Its status may remain unresolved; no forced classification is allowed to satisfy completion.

### Stage 5 — Scale review and handle nested structure

1. After the pilot validates the data model and tools, process remaining spans in bounded jobs through the worker system.
2. Prioritize interiors and easy boundaries; schedule near-neutral/high-period and ambiguous spans for higher-precision refinement.
3. Detect nested regime changes inside broad legacy spans and create child review intervals rather than flattening all child regimes into one label.
4. Maintain a low-cost discovery pass outside known spans so previously unrecorded stable windows can be added as new candidate spans.
5. Allow reviewed spans to have `verified`, `partial`, `rejected`, or `unresolved` outcomes. Record why a span was stopped or revisited.

### Stage 6 — Generate and serve rendering packets

1. Define packet schema and deterministic interval/range addressing after the verified sample needs are known.
2. Build packets only from accepted review revisions; include candidate/unresolved overlays only if their render status is explicit.
3. Write to a new generation, verify packet manifests/checksums, and atomically publish the generation pointer after checks pass.
4. Implement viewport/range lookup and lazy loading in the UI; distinguish legacy span bounds, Fracto-verified stable ranges, boundaries under review, and unresolved regions visually.
5. Keep the prior packet generation available for rollback. Rebuild packets from catalog/review data rather than editing generated packet files manually.

**Acceptance:** rendering can load a verified range without loading the complete catalog or legacy point files, and packet generation is reproducible from the selected review generation.

### Stage 7 — Operations and recovery

- Keep migrations backward-compatible with running versions; deployment ordering and rollback behavior must be documented.
- Make imports and review jobs resumable and idempotent. A worker restart must not silently mark unfinished edges verified.
- Record active job, attempt, and failure reason without storing misleading partial results as complete.
- Provide a dry-run mode for imports and packet generation, and publish a concise report before promotion.
- Preserve source file checksums, schema version, algorithm version, and packet generation IDs so the entire chain can be traced.
- Keep the last known-good generation until the replacement passes manifest, spot-check, and UI range-load verification.

## Review and rendering quality rules

- A legacy span is a **priority hint**, not a correctness claim.
- An interior cycle does not prove every point in the interval has the same period.
- A period-`p` cycle becoming unstable does not by itself mean chaos; test the doubled branch and any nested stable regime.
- Never infer chaos from an iteration cap, no repeated binary64 state, or a rendering gap alone.
- Preserve unresolved and marginal states; do not optimize for a lower unresolved count at the cost of false classifications.
- Compare cycle point sets up to cyclic rotation for independent recalculations; do not require chaotic trajectories to match point-for-point.
- Generated packets are derived output. The catalog and review records retain the evidence and provenance needed to regenerate them.
- Keep numerical resolution, parameter bracket width, cycle residual tolerance, multiplier tolerance, and chaotic-evidence window as separate quantities; do not collapse them into one generic “accuracy” number.

## Decisions still open

Resolve these before the corresponding implementation stage, not during import:

1. Final database/table names and database migration numbering.
2. The exact source archive and transfer mechanism for `spans.json` on deployment systems.
3. Numeric precision/scale and raw-token preservation strategy for legacy endpoints.
4. The verified meaning of legacy `regime`, `count`, and endpoint inclusion.
5. Review status vocabulary and whether review history is append-only or versioned rows.
6. The first pilot span and the parameter precision required for its boundary bracket.
7. Multiplier accumulation method/tolerance for large periods and near-neutral cycles.
8. Operational definition and evidence fields for “chaotic return,” distinct from “unresolved.”
9. Packet record layout, range addressing, compression, and publication-pointer mechanism.
10. How newly discovered spans outside the legacy catalog are added and prioritized.

## Immediate next action

Implement only **Stage 1**: create the catalog migration and repeatable, dry-runnable import of the 1,167 legacy span definitions, then report a source-to-table audit. Do not add numerical review, public routes, UI behavior, or generated files as part of that first step.
