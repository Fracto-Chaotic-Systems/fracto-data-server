# Logistic-map regime-span migration plan

## Purpose and decision

This document records the migration plan for using the observed regime spans from the earlier bifurcation application as an organizing guide for Fracto's logistic-map calculations. It is deliberately separate from the logistic-map `README.md`, which describes the current calculator and broader mathematical background. It tracks completed catalog/import work, the current exploratory packet prototype, and remaining review, persistence, and rendering work.

The selected direction is **regime-span-led, adaptive work**:

- The legacy spans identify promising areas where stable periodic behavior was observed and where interior calculations may converge relatively quickly.
- Fracto recalculates and records numerical evidence using the current contract, arithmetic, and validation rules. Legacy labels remain hypotheses until reviewed; legacy bounds are useful observation-window limits, not presumed exact boundaries.
- Calculation effort is concentrated inside known spans and across transitions of interest. Boundary brackets are optional research results, not a prerequisite for viewing or studying a transition; including unresolved or chaotic-looking samples in the frame is acceptable when their evidence labels remain clear.
- A low-cost scan across the wider parameter range remains necessary to discover stable windows absent from the legacy catalog. The legacy list must not become an assumption that all stable regions have already been found.
- MySQL holds the imported span catalog and the generated per-parameter review samples. Exploratory immutable, versioned packets can be generated before exact boundaries are settled. A production persistence and distribution strategy for those files has not been selected.
- The standalone legacy orbit-point records are not part of the initial import. They would have to be recalculated or independently verified, are large and irregular, and lack sufficient provenance to serve as trusted results. Retain an archival/reference copy outside runtime dependencies while migration decisions are in progress.

The initial migration is intentionally narrow: import the **1,167 span definitions** from the legacy `regimes/spans.json` into a table, preserve their source representation, and audit the import. Do not begin numerical edge review or generate render packets in that first step.

## Scope and non-goals

This effort covers:

1. Importing the legacy span catalog without silently changing its meaning.
2. Auditing its ranges and classification fields.
3. Defining and recording interior verification and left/right edge review.
4. Referring to stable cycle and bifurcation evidence using explicit numerical criteria.
5. Generating explicitly exploratory versioned packets from useful observation windows, then later deciding which reviewed data merits a durable rendering release.

The current implementation still does not:

- Import all per-parameter orbit arrays or the legacy `non_span` files into Fracto's live store.
- Treat a legacy `regime`, `count`, or endpoint as verified mathematical truth.
- Declare chaos solely because a finite computation did not find a cycle.
- Change the current global parameter addressing scheme or claim full coverage from the legacy catalog.
- Serve generated packets through a runtime API or render them in the UI. The existing level-one diagnostic API is separate and remains process-local.

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

Keep mutable evidence separate from the immutable source catalog. **Implemented so far:** `logistic_map_span_review_sample` stores one record per parameter sample associated with a packet generation. It is not yet a general span/edge review-history model. A fuller review model may identify:

- the catalog span and review revision;
- current status (`pending`, `interior_checked`, `edges_bracketed`, `verified`, `needs_refinement`, or `rejected`);
- one or more interior `r` checks and their detected periods;
- left and right edge brackets, event types, inclusion convention, and supporting observations;
- arithmetic backend/precision, seed policy, cap, transient, tolerances, algorithm version, and timestamps;
- links to individual calculation results or packets, without copying large point arrays into every review row.

Where the two edges require different evidence, represent each edge independently rather than packing both into a single ambiguous status. Preserve prior review revisions for auditability. Do not store a single boolean `verified=true` without saying what was verified and at what resolution.

### Render packets

Generate immutable, versioned packet files grouped/indexed by parameter interval. Exploratory packets may be generated directly from recalculations before edge review is complete; they must label the window as exploratory and preserve each sample's evidence state. A later verified release should be based on accepted review records. Packets contain sampled results and render metadata plus a manifest with schema version, range identity, generation ID, and checksum. Current pilot naming is deterministic for its input settings, but the general hierarchical range-addressing scheme is still open.

The database currently retains a copy of each generated sample record, while the packet is generated from live calculations in the same run; packet files are derived read-optimized output. A UI should eventually fetch only packets covering the visible range/resolution, not bundle the full legacy dataset. For this study, exact span boundaries are not a prerequisite for useful rendering: a legacy range is an observation window intended to expose the transition and may include chaotic or unresolved samples. Do not assign a unique, definitive boundary where the classification depends on an arbitrary convention. Keep window identity and evidence labels explicit; unresolved samples are not automatically chaos, and finite-precision cycle candidates are not proofs. Exploratory packets are diagnostic, not verified mathematical classifications. Later work can refine interesting portions without delaying a broad view until every edge has a bracket.

## Staged implementation plan

### Stage 1 — Import and audit the legacy span catalog

1. Add a data-server schema initializer for the catalog table. **Implemented:** `initialize_span_catalog.js` creates the catalog and per-parameter review-sample tables idempotently at service startup without seeding rows.
2. Add an explicit, repeatable import command that reads a supplied `spans.json` file; do not hard-code the developer's `D:\react-apps` path into the service. **Implemented:** `import_legacy_span_catalog.js` accepts the source path as an argument.
3. Parse and validate the expected fields, record the file checksum/version, and import exactly 1,167 source entries without dropping duplicates. **Implemented:** the archive is `legacy_spans_bifurq_v1.json`; parsing retains the exact source object text and zero-based order. `legacy_regime` and `legacy_count` retain unverified legacy meanings.
4. Make import idempotent by source version/checksum and ordinal; a retry must not duplicate rows or overwrite another source version. **Implemented:** a database advisory lock, source-version/checksum/count check, unique source-version/order key, and transaction prevent duplicate or conflicting imports.
5. Produce a summary of imported count, rejected rows, missing fields, numeric round-trip differences, duplicate rows, overlaps, nesting, and gaps. **Partially implemented:** dry-run reports entry count, duplicate bounds, overlaps, nesting, and gaps. Malformed rows fail with their source ordinal before any writes. Numeric values remain queryable as `DOUBLE`, while exact source objects are preserved in `LONGTEXT` and the original file is archived. A dedicated round-trip-difference report is not yet implemented.
6. Add tests for a clean import, rerun, malformed input, duplicate values at different ordinals, boundary values, and exact source-value preservation. **Partially implemented:** parser/archive/order/schema/malformed/duplicate-preservation tests are present; database-backed first-import and rerun integration tests still require a test database.

**Acceptance:** the archived source contains 1,167 entries; every table row preserves its source array ordinal and exact source object; source labels remain explicitly legacy; importing changes no calculator behavior and creates no render files. Database row-count and retry acceptance requires running the explicit import against the intended database.

### Stage 2 — Audit structure and define review order

1. Sort intervals numerically without changing source order in storage. **Implemented in the audit tool:** numerical ordering is temporary and source rows remain unchanged.
2. Report duplicates, strict overlaps, nested intervals, touching endpoints, and gaps. **Implemented:** `audit_legacy_span_catalog.js` records every duplicate-bound group and overlapping pair (duplicate, nested, or partial), touching pair, interval-union gap, and width inconsistency in a checksum-bound JSON report.
3. Determine from source code/documentation what `regime` means; keep an “unknown legacy meaning” label until this is checked.
4. Choose an initial review order that starts with spans where interior behavior is informative, then proceeds to narrower and higher-period spans; treat legacy labels and cycle detections as candidates until their evidence is reviewed.
5. Record the rule for selecting interior anchors. Do not use midpoint alone if the interval may contain multiple nested regime branches; use multiple interior points when needed.

**Acceptance:** findings are recorded with source ordinals and the source checksum; no ranges are merged or corrected without recorded evidence. The report is structural only and does not verify the legacy regime label or interval endpoints.

### Stage 3 — Add review record and multiplier evidence

1. Extend calculation output with the cycle multiplier and stable/neutral/unstable assessment, with a documented numerical tolerance. Compute it from the ordered cycle points and use numerically appropriate accumulation for large periods. **Pilot implemented:** `review_span_interior.js` computes the return multiplier and applies a `1e-8` neutral band for the pilot report.
2. Add a review record format that preserves the exact `r` text, cycle period, ordered point set or reference, return residual, multiplier, precision, seed, iteration settings, detector version, and wall-clock diagnostics. **Partially implemented:** `span_interior_review_bifurq_v1.json` records the interior pilot, and `logistic_map_span_review_sample` stores per-parameter records for generated packets. A general append-only span/edge review history is still future work.
3. Run one or more interior calculations for a selected span. Require primitive-period, return-residual, and attracting-multiplier checks before using that cycle as an edge anchor. **Pilot completed for source order 0:** the machine repeat periods were 4, 8, and 8, but tolerance-reducing the midpoint's repeated points identifies a period-4 candidate; reviewed candidate periods are 4, 4, and 8. All three multiplier magnitudes are below one. These results are finite-precision evidence, not exact-real proofs, and are not yet used as edge anchors.
4. Keep higher precision/Newton as separate refinement evidence. Newton may solve/sharpen `f_r^p(x)-x=0`, but must not replace residual, primitive-period, or multiplier checks.

**Acceptance:** an interior review distinguishes finite-precision cycle candidates, near-neutral candidates, unresolved results, and numerical failures, with settings and provenance available for reproduction. The current Number backend does not establish mathematically verified real-valued cycles.

**Pilot finding:** source order 0 has bounds approximately `[3.50001578349, 3.57006301627]` and legacy label 2. At quarter, midpoint, and three-quarter positions, the machine repeat periods were 4, 8, and 8; tolerance-reduced candidate periods are 4, 4, and 8, with multipliers approximately `-0.40782448`, `-0.79542030`, and `0.20445726`. The midpoint reduction is necessary because the machine's eight states repeat within `1.45e-15` after four steps. This supports the legacy span as a location for attracting periodic behavior, but it does not represent one uniform period. The legacy label remains semantically unverified.

### Stage 4 — Refine individual edges

1. Select one legacy span with useful interior observations and make it the pilot; do not launch all 1,167 reviews simultaneously. **Pilot selected:** source order 0; its interior evidence is recorded separately from the immutable catalog.
2. For each endpoint, sample successively closer `r` values on both sides, reusing a nearby cycle only as a starting hypothesis. Every candidate must be validated for the requested `r`.
3. Maintain a bracket with known outcomes on each side. Refine by bisection or a root method once the relevant event equation and branch are identified.
4. For a period-`p` edge, test whether the transition is a flip (`M_p` approaches `-1`), a saddle-node entry (`M_p` approaches `+1`), or another event. Check the adjacent parameter side for period `2p` or another stable cycle before describing a transition as chaotic.
5. If the goal is the end of a doubling cascade, continue the `p, 2p, 4p, ...` sequence and estimate the accumulation point from multiple measured bifurcation intervals. Store the estimate and bracket separately from any exact edge value.
6. For chaotic-return evidence, record finite-time indicators and observation length. A positive finite-time Lyapunov estimate or sustained unresolved orbit is evidence, not a proof of chaos. Preserve `unresolved` when the evidence is inadequate.
7. Store the original legacy endpoint, the verified bracket, the estimated boundary if available, endpoint inclusion convention, and the evidence/settings that support them.

**Status:** optional and incomplete exploratory work. The existing edge script/report samples neighborhoods of the reported endpoints and includes one analytic period-4 birth bracket; it does not establish either legacy endpoint as an event. Additional edge brackets may help investigate particular transitions, but completing both ends of every legacy window is not required before rendering or studying the window.

**Pilot edge result — incomplete:** samples from `min_r - 1e-6` through `min_r + 1e-6` all produced period-4 candidates with multipliers near `-0.0308`, so no transition is bracketed at the reported lower bound. The period-4 birth itself is separately bracketed at `[3.44948974278, 3.44948974279]` from the analytic identity `r = 1 + sqrt(6)` and parent period-2 multiplier crossing `-1`; that event lies below the legacy bound and does not validate it. At `max_r` and `±1e-8`, Fracto remained unresolved at the 1-billion iteration cap, leaving no return multiplier for an event test. Ten-million-iteration Lyapunov estimates around `max_r` were positive (~`0.0119`), recorded only as finite-time chaos evidence. Therefore neither legacy endpoint is accepted as an exact event boundary; the upper end-of-cascade estimate still needs successive Fracto doubling brackets. Periodic windows and cascades remain possible in the surrounding region.

### Stage 5 — Scale review and handle nested structure

1. After the pilot validates the data model and tools, process remaining spans in bounded jobs through the worker system.
2. Prioritize informative interiors and transitions; refine a boundary when it helps answer a study question, and schedule near-neutral/high-period or ambiguous samples for higher-precision work when available.
3. Detect nested regime changes inside broad legacy spans and create child review intervals rather than flattening all child regimes into one label.
4. Maintain a low-cost discovery pass outside known spans so previously unrecorded stable windows can be added as new candidate spans.
5. Allow reviewed spans to have `verified`, `partial`, `rejected`, or `unresolved` outcomes. Record why a span was stopped or revisited.

### Stage 6 — Generate and serve rendering packets

1. Define packet schema and deterministic interval/range addressing. **Partially implemented:** the pilot schema has a generation ID, range index, SHA-256 checksum, and a midpoint grid for one legacy span; the general hierarchical addressing scheme is not implemented.
2. Build either (a) exploratory packets from identified source windows with candidate/unresolved statuses explicit, or (b) verified packets from accepted review revisions. Never mark a legacy bound as an event or an unresolved orbit as chaos.
3. Write a new generation, verify its checksum, and update the JSON range index. **Implemented in the local generator:** packet JSON and index are written and checksummed, and conflicting database records for a generation are rejected. Atomic publication across MySQL, packet file, and index is not implemented.
4. Implement viewport/range lookup and lazy loading in the UI; distinguish legacy span bounds, Fracto-verified stable ranges, boundaries under review, and unresolved regions visually.
5. Preserve prior generations where the selected persistence mechanism supports it. The local index retains inactive pilot generations; no durable artifact store, deployment distribution, or rollback procedure exists yet. Rebuild packets by running the generator rather than editing generated files manually.

**Acceptance:** a future rendering path can load an explicitly labeled exploratory or verified range without loading the complete catalog or legacy point files. Packet generation must preserve uncertainty labels and provenance. Runtime packet lookup, UI rendering, and durable distribution remain unimplemented; exploratory output does not require settled boundaries.

**Exploratory pilot implemented locally:** source order 0 has a 4,096-midpoint packet with a 1,000,000 iteration cap, 10,000 transient, and separate 100,000-step Lyapunov diagnostic. It contains 4,091 finite-precision attracting-cycle candidates and 5 unresolved samples; an earlier 1,024-point generation is retained in the local index as inactive history. Results are inserted into `logistic_map_span_review_sample`; checksummed JSON packets and a source-version range index are written under `render_packets/`. That directory is Git-ignored while the persistence strategy is pending, so these files are not guaranteed to exist after a fresh checkout. The legacy range is explicitly an exploratory observation window, not an event boundary. Unresolved orbit tails and finite-time evidence have distinct outcome labels. This is not a verified mathematical classification release or a public UI integration.

### Stage 7 — Operations and recovery

- Keep migrations backward-compatible with running versions; deployment ordering and rollback behavior must be documented.
- Make imports and review jobs resumable and idempotent. A worker restart must not silently mark unfinished edges verified.
- Record active job, attempt, and failure reason without storing misleading partial results as complete.
- Catalog import has a dry-run mode. Packet generation currently has no dry-run mode; adding one and producing a promotion report remain incomplete.
- Preserve source file checksums, schema version, algorithm version, and packet generation IDs so the entire chain can be traced.
- Keep the last known-good generation until a future persistence and serving workflow can verify manifests, spot checks, and UI range loading. The current local generator does not yet provide that operational guarantee.

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

## Current implementation status

The initial import-and-audit phase is implemented in code and covered by parser/schema tests; a database-backed import and retry test still requires a test database. Interior and endpoint pilot reports exist. Exploratory packet generation and sample persistence are implemented for one legacy window, but packet persistence outside the local ignored directory, cross-store atomic publication, production rendering/service endpoints, UI integration, and generalized span/edge review history remain incomplete. See Stages 3–7 for outstanding work and acceptance conditions.
