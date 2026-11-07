# Persistent orbital discovery

The Orbital points page and Seed Surveys Detect use the same SDK scan:
`FractoSeedSurveyScan.js`, with the same confirmation, grouping and ranking.
The data service runs it in the existing compute worker pool, stores each
independent cycle, then calculates its Julia external-ray landing ratios.
Only the selected `free_bailiwicks.core_point` is processed. No backfill runs.

Apply migrations 007, 008 and `009_orbital-survey-metadata.sql` through the
normal database runner. Migration 009 adds nullable confirmation metadata to
headers and run memberships; it does not alter historical points or ratios.
The five data-service-owned tables are documented in `SCHEMA.md`.

## Shared numerical workflow

1. Generate the same 250×250 bounds-sampled seed survey over [-1.5,1.5]²
   with the existing `calculate_seed_survey` / FractoCardinality infrastructure
   and 100,000 iterations.
2. Visit every positive-pattern cell in row-major order. Recalculate its seeded
   pattern with FractoFastCalc; refine with the existing BigComplex Newton
   solver (80 iterations, 64 decimal digits). There is no fixed-period sweep
   or period-4 discovery filter.
3. Apply the shared Seed Surveys closure (1e-7), magnitude, confidence,
   repeated-traversal reduction and 0.01 geometric grouping rules. Keep the
   best-confidence representative in each group; rank the top 100 by discovery
   count, then original group ID. Confidence is a numerical heuristic.
4. Preserve the Newton decimal coordinates and independently check every
   transition before storage. Compare complete cycles modulo rotation at 1e-7;
   grouping a scan result and identifying a persisted cycle are separate steps.
5. Store all selected orbitals before ray calculation. Use the shared
   `SEED_SURVEY_RAY_OPTIONS` profile: tolerance 1e-6, depth 128–512, up to
   16,000 points per ray, 256-digit terminal verification, angle periods up to
   24, and at most 1,024 families per orbital. Seed Surveys uses this profile too.
   Native geometry remains native; the precision check is not an assertion that
   the entire trace uses Decimal arithmetic.
6. Persist only complete exact doubling families whose endpoints and forward
   dynamics pass SDK validation. Map indices to the stored point order. An
   attracting orbit remains an orbital without landing ratios; ray limitations
   never remove discovered orbitals.

The calculation version is `orbital-discovery-v2`. Legacy fixed-period and
ray-led SDK/worker operations remain available to their existing callers but
do not add candidates to this shared survey pipeline.

## HTTP contract

Routes inherit enabled-user authentication. Private start/cancel routes also
use the existing internal data-editor authorization. The browser action uses
the configured UI Origin guard and never exposes a service credential.

- POST `/orbital-data/bailiwicks/:id/discovery-jobs` with `{}`: start the
  standard shared workflow for one selected source, returning 202 `{result:run}`.
  Arbitrary settings, coordinates and additional body fields are rejected.
- POST `/orbital-data/discovery-jobs` (private): accepts
  `{free_bailiwick_id,request_key?,settings?}`. A request key reuses a run
  with identical version/source snapshot/settings and conflicts on changed inputs.
- GET `/orbital-data/discovery-jobs/:uuid`: durable status and progress.
- POST `/orbital-data/discovery-jobs/:uuid/cancel` (private): retain committed
  results and prevent subsequent publication.
- GET `/orbital-data?focal_re=...&focal_im=...&view=survey`: latest terminal
  v2 survey membership in scan rank order, with per-run discovery metadata.
  Returns `{result,stale,run_id?,calculation_version}`. If only older results
  exist, returns an empty list with `stale:true` so the UI offers recalculation.
  Historical data remains stored and accessible through the ordinary API.
- GET `/orbital-data?focal_re=...&focal_im=...&limit=100&after=123`:
  historical headers, exact normalized parameter, ID cursor, limit 1–100.
- GET `/orbital-data/:id`: joined ordered progression, exact decimal coordinate
  strings, complete ratios, source ID, tolerances, version, ray metadata and
  discovery metadata. Rational numerator/denominator values are integer strings.

The source table accepts free, inline and nodal entries. Coordinates come from
`core_point`, not display settings; source records are never modified. Headers
retain their primary `free_bailiwick_id`; run memberships preserve additional
provenance. Existing cycle coordinates and order remain stable on rediscovery.

Terminal statuses: `completed`, `partial`, `failed`, `cancelled`,
`interrupted`; active statuses: `queued`, `running`. Stages are
`discovering`, `persisting`, `calculating_rays`, or lifecycle status.
Progress reports survey samples, scan seeds, stored orbital count, current
angle-family search, completed ray orbitals and outcomes. Discovery metadata
records rank, confidence, discovery count, seed and numerical settings.
SQL/connection errors are returned as sanitized codes.

## Bounds

| Setting | Default | Allowed |
| --- | --- | --- |
| grid_size | 250 | 2–1024 per axis |
| half_span | 1.5 | 0.01–2 |
| precision_digits | 64 | 64–256 |
| newton_iterations | 80 | 10–100 |
| iteration_limit | 100000 | 100000–10000000 |
| max_angle_period | 24 | 1–24 |
| max_families | 1024 | 1–4096 |
| max_orbitals | 100 | 1–100; shared scan returns at most 100 |
| max_period | 4096 | 1–4096; legacy diagnostic setting, does not filter survey periods |

Unknown fields and invalid values return 400. At most four local runs are
admitted. Each task allows up to one hour, bounded by the run's two-hour
wall-clock deadline. Existing worker queue limits, cancellation, replacement
and metrics remain active. Queue overload returns 503 or becomes a durable
terminal worker outcome if it happens after admission.

`completed` means configured work finished, not exhaustive discovery of every
cycle or ray. Unresolved/limited ray outcomes produce `partial`; attracting
and neutral classifications are explicit outcomes. Previous validated rays
survive an unsuccessful repeat calculation.

## Durability

Database and HTTP operations stay outside workers. Short transactions commit
a header, its points and run membership atomically, and complete ray results
atomically. A per-focal MySQL advisory lock serializes cycle comparison and
insertion; a run-row lock guards cancellation. Run leases renew every 20 seconds;
polling an expired 120-second lease reports interruption. Restart never silently
resumes abandoned work. New explicit runs reuse existing cycles.

## Verification

`node --test tests/orbital_data.test.js tests/orbital_survey_parity.test.js`
from the data service tests contracts and actual worker parity without MySQL.
The pattern-7 regression uses core point 65 and asserts the ranked period-7 results,
rankings, confidence and counts against the shared Seed Surveys scan.

From the root, `node scripts/verify_seed_survey_orbitals.js 65` explicitly starts
one real application run and verifies discovery → storage → HTTP retrieval
against Seed Surveys, including complete validated ray families. Migrations
must already be applied. It retains data and writes evidence to
`/tmp/fracto-seed-survey-verification.json` (optional second argument).
An optional third argument resumes verification of an existing run UUID without
starting another calculation. No catalog scan occurs.

`node scripts/benchmark_orbital_survey.js 65 250 1` is read-only: scan one source,
then optionally time rays for a zero-based ranked orbital index.

The older disposable/application verifiers also cover lifecycle/storage contracts;
their diagnostic settings are intentionally smaller than the browser defaults.
