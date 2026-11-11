# Persistent orbital discovery

## Independent lifecycle states

The SDK's `FractoLandingAssignments.js` now validates representative-ray landing
assignments using inverse-branch neighborhoods, a fresh streamed representative
arc and q+1 terminal transport samples. Its versioned compact result can mark
assignments verified while leaving paths missing. Numerical ambiguities remain
pending, with deeper attempts and an explicit optional full-tracing fallback.
This is numerical validation rather than an interval certificate. New service
jobs dispatch it through the compact investigation contract; the legacy
full-geometry investigation contract remains available for historical jobs.

Migration 016 adds nullable `orbital_progressions.lifecycle_state`. The shared
SDK contract is `FractoOrbitalLifecycle.js`, version `orbital-lifecycle-v1`.
It records three independent axes:

- `orbital`: pending, validated, unresolved. Only validated orbitals are selectable.
- `assignments`: pending, partial, verified, unresolved, not_applicable. This describes
  the published landing assignments, not exhaustive catalog coverage.
- `paths`: unknown, missing, tracing, partial, cached, stale, failed, cancelled,
  with cached/required ray counts, exact target-identity hash and numerical profile.

A validated orbital remains selectable with pending assignments, missing paths,
or failed/cancelled path generation. Verified ratios do not imply cached paths.
Cached/partial states require validated orbital/assignment evidence, actual ray
counts and an accuracy profile. Detail reads mark cache evidence stale when exact
coordinates or ratio targets change. Existing `ray_status` remains a compatibility
field for landing-search outcomes; it is not a path-cache status.

Header/detail responses add `lifecycle_state` and derived `selectable`. Saves update
state in the same transaction as orbital, ratio or path evidence. Old null states
normalize on read: stored orbitals are validated, `rays_found` assignments are
verified, and path availability is unknown. Old caches remain usable; no backfill
or numerical recalculation occurs. Pending assignments are not published into the
existing validated `orbital_landing_ratios` table.

New checkpoints include `discovery_strategy`; historical format-1/2 checkpoints
bind to their original stored settings on claim, preserving the cursor and input
fingerprint. Strategy changes fail closed. Current IDs are `survey-period-rays-v1`
and `survey-catalog-full-rays-v1`. The new `catalog-representative-rays-v1` ID
uses solver version `catalog-representative-discovery-v1` and path policy
`on_selection`, with its own numerical identity and checkpoint signature. Existing
jobs keep their original workflow.

`npm run test:orbital-lifecycle` checks independent selectability, old-row
normalization, invalid state combinations, cache identity/quality and checkpoint
strategy compatibility. Enable `FRACTO_DB_INTEGRATION=1` for persisted state,
legacy checkpoint and process-death recovery checks in a disposable schema.

## Catalog investigation ledger

Large validated families use migration 015's `orbital_ray_cache_chunks` through
`orbital_ray_cache_codec.js`. The former 20 MiB inline/base64 envelope rejected
family 1/163 (162 rays), leaving the cursor at 233. Larger outcomes and orbital
path caches now store lossless gzip bytes in content-addressed chunks no larger
than 8 MiB, with an atomic JSON manifest in the original row. Both ledger reloads
and the Julia path API transparently reconstruct these values, verifying chunk
hashes, aggregate hash, exact sizes and the existing 96 MiB inflated limit.
Smaller values retain their original inline representation. Browser write-body
limits and numerical validation remain unchanged. Chunks and manifest commit in
one transaction; immutable deduplication retains shared chunks without automatic
deletion. Completed family attempts also tolerate already-queued heartbeats,
while unknown or superseded ownership remains fenced.

Migration `013_orbital-family-investigations.sql` adds
`orbital_family_investigations` and `orbital_family_investigation_attempts`.
`handlers/orbital_family_investigations.js` implements the SDK persistence
provider and the opt-in `discover_persisted_catalog_orbitals(parameter, options)`
adapter. Resumable jobs use this ledger as described below; coverage UI is a
subsequent integration step. No new HTTP mutation routes are required.

The immutable identity includes exact normalized focal coordinates, canonical
catalog family, catalog/solver versions, and numerical settings. It excludes
the catalog's maximum denominator, run-level family count, requested geometry
visibility, and existing-orbital snapshot. Expanding a catalog reuses completed
families; changing numerical settings creates a separate retained investigation.
The solver version is `catalog-orbital-discovery-v1`.

`prepare` idempotently creates pending rows. Atomic `claim` transitions pending
or expired work to investigating, with a unique attempt token and a default
300-second lease. Competing live owners receive busy. `heartbeat` can renew a
live token; an executor running a long family must renew before expiry.
Expired/canceled attempts remain in the history, and late owners cannot renew
or publish. `complete` atomically saves an outcome and attempt evidence; replay
after a lost acknowledgement is idempotent. Cancellation/error release returns
unfinished work to pending. No calculation occurs while a SQL row lock is held.

Validated outcomes retain canonical decimal points, complete landing-ratio
families, refinement evidence, and compressed ray geometry. The persistence
boundary independently rechecks decimal closure, exact angle transport,
assignments, geometry, terminal precision, and endpoint dynamics. Payloads use
the existing bounded gzip/JSON codec. Attempt history retains compact evidence
without duplicating large geometry. A validated result is never downgraded.
Unresolved results are reused until `retry_unresolved: true` is requested or the
profile/solver version changes. Recorded failure never means a family cannot land.

`attach_orbital(context, orbital_id)` transfers validated geometry into the
existing `orbital_ray_paths` cache _after_ that orbital and its ratios have been
published by the normal owner-controlled workflow. It locks and verifies the
current stored focal point, whole-cycle identity, and ratio assignments, remaps
indices under cyclic rotation, merges quality-preserving paths, and links the
ledger row atomically. The stored identity tolerance is bounded by the survey
contract; individual ray endpoints must still meet the stricter path-cache
profile. Missing ratios or changed targets fail without overwriting the cache.
Deleting a linked orbital clears only the link, retaining investigation evidence.

```js
const result = await discover_persisted_catalog_orbitals(parameter, {
  catalog,
  existing_orbitals,
  max_work_units: 2,
  state: previousCheckpoint,
});
```

Unit tests: `node --test test/orbital_family_investigations.test.js` from the root.
The opt-in `FRACTO_DB_INTEGRATION=1` test
`test/orbital_family_investigations.integration.test.js` creates and removes a
unique disposable schema. It verifies two-connection claims, fencing, history,
reload/cache hits, profile separation, and geometry attachment without writing
application orbital rows.

## Existing survey workflow

The Orbital points page and Seed Surveys Detect use the same SDK scan:
`FractoSeedSurveyScan.js`, with the same confirmation, grouping and ranking.
The data service runs it in the existing compute worker pool, stores each
independent cycle, then calculates its Julia external-ray landing ratios.
Only the selected `free_bailiwicks.core_point` is processed. No backfill runs.

Apply migrations 007–010 through the
normal database runner. Migration 009 adds nullable confirmation metadata to
headers and run memberships; it does not alter historical points or ratios.
Migration 010 adds durable checkpoints and execution fencing without backfill.
The data-service-owned tables are documented in `SCHEMA.md`.

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
- POST `/orbital-data/bailiwicks/:id/discovery-jobs/rediscover` with `{}`:
  start a fresh catalog-only run using current defaults. Verified family evidence
  is reused; unresolved families are retried. Older stopped jobs are marked as
  superseded for automatic selection, retaining their checkpoints and results.
  Active work blocks a second run. The same UI Origin guard applies.
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

| Setting           | Default | Allowed                                                           |
| ----------------- | ------- | ----------------------------------------------------------------- |
| grid_size         | 250     | 2–1024 per axis                                                   |
| half_span         | 1.5     | 0.01–2                                                            |
| precision_digits  | 64      | 64–256                                                            |
| newton_iterations | 80      | 10–100                                                            |
| iteration_limit   | 100000  | 100000–10000000                                                   |
| max_angle_period  | 24      | 1–24                                                              |
| max_families      | 1024    | 1–4096                                                            |
| max_orbitals      | 100     | 1–100; shared scan returns at most 100                            |
| max_period        | 4096    | 1–4096; legacy diagnostic setting, does not filter survey periods |

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
resumes stopped work without an explicit start/resume action. The browser offers
Resume for canceled/interrupted/failed checkpointed jobs, including jobs with
already stored results. It reattaches to active work after page reload.

Checkpoints commit before the next work unit: eight survey rows, sixteen positive
seed refinements, or one complete angle family. A restart may repeat the current
unfinished unit. Completed units are never counted twice. The full scan grouping
state (including groups outside the top 100), tested pixels, Decimal point
strings and stable group IDs are retained until final ranking. Final candidates
and persistence indices then replace the raw survey/scan buffers.

For rays, the checkpoint retains the numerical assessment, exact family cursor,
accepted complete families and rejection counters. Completed orbital calculations
are checkpointed before SQL publication; a crash during publication replays the
idempotent save, not the ray calculation. Finished orbitals are skipped.

An atomic run-row claim issues a fresh private execution token. All checkpoint,
progress, point, ratio and heartbeat writes require that token and a live lease.
A stale worker cannot publish after a new owner claims the run. Concurrent resume
requests receive one admission and HTTP 409 `bailiwick_busy` for competitors.
Canceled work stays stopped until explicitly resumed.
A dead process's ownership expires after at most 120 seconds; there is no takeover
of a live lease. Every resumed attempt receives a fresh bounded runtime budget.

Checkpoint format 2 uses bounded gzip JSON (64 MiB raw, under 16 MiB compressed),
with both a calculation-profile signature and the run input fingerprint. Changed
settings, focal parameters, or incompatible calculation versions cannot silently
mix with saved progress. Older jobs without checkpoints retain their stored data
but must start a fresh run; unavailable/incompatible checkpoints return 409.
Compatible format-1 checkpoints upgrade on load and retain their original work.

POST `/orbital-data/discovery-jobs/:uuid/resume` is private and accepts only
`{}`. Reposting an existing request key also resumes unfinished checkpointed
work when idle. A fresh private request key starts a separate calculation only
when that bailiwick has no active lease. Browser start without a key resumes an
unfinished checkpoint for the same bailiwick ID, retaining its original source
snapshot/settings, otherwise creates a new run. Coordinates and settings do not
define job identity. GET lookup can monitor an active job; start/resume cannot
take it over. Admission and claiming serialize across servers on a per-bailiwick
MySQL advisory lock, released after the short database operation.

The first compute batch reserves a physical pool worker for the entire execution,
including gaps for checkpoint and database writes. All subsequent survey, scan,
and ray batches use that worker. Different bailiwicks may use other workers or
wait in the bounded queue. Failure ends the execution rather than silently
moving batches; explicit resume may assign a replacement using its durable
checkpoint. Completion, cancellation, and failure release the reservation.

GET `/orbital-data/bailiwicks/:id/discovery-job` returns the latest matching
unfinished job or null. Browser POST
`/orbital-data/bailiwicks/:id/discovery-jobs/:uuid/resume` and `.../cancel`
require configured UI Origin, an empty body, and a matching source ID. Run
responses add `resumable`, `resume_count`, and `checkpoint_phase`; private
execution tokens and checkpoint payloads are never returned.

Completed/ordinary bounded-partial work is not automatically recalculated.
Partial work caused by interruption/error remains resumable. No source edit or
checkpoint backfill is performed.

## Resumable catalog jobs

Apply migrations through 016 before enabling the updated coordinator. New jobs
default to `catalog-representative-rays-v1`: they start directly at the catalog,
skipping the grid survey, scan, and full-family path calculation. Each family
uses the adaptive representative solver and compact assignment validation.
Closed primitive cycles are published even if assignment validation is pending;
only verified families publish ratios. Matching cycles preserve stored coordinates
and survey evidence. Discovery does not write or invalidate path geometry.
Existing survey-ranked results retain their ranking when reused.

Historical jobs keep their original route: settings with a positive catalog bound
and no strategy tag use `survey-catalog-full-rays-v1`; settings predating catalog
support use `survey-period-rays-v1`. They retain survey and full-path publication.
New compact jobs use format-3 checkpoints with a separate strategy signature;
historical format-1/2 checkpoints remain readable. Switching a checkpoint's
strategy is rejected rather than discarding its cursor or reinterpreting its data.

Defaults are `catalog_max_denominator: 255`, `catalog_max_families: 1024`, and
`catalog_retry_unresolved: 0`. A private request can choose an inclusive bound
within the bundled catalog, reduce the work budget, request unresolved retries,
or set the denominator bound to zero for the legacy route. Larger bounds require
preprocessing and installing an expanded catalog first. Old jobs whose stored
settings lack these fields retain the legacy route and input fingerprint.

Catalog checkpoints retain a configuration signature, family cursor, counts,
matched orbital IDs, and finalization cursor. Workers calculate representative
rays, Newton candidates, and assignment validation; SQL stays in the coordinator.
Each family outcome commits to the ledger before publishing cycle membership
and verified ratios. Only after publication does the family cursor advance.
Replaying an interrupted publication reuses the ledger and idempotent storage.
Cache hits skip calculation. Unresolved/budget-limited work is reported as partial;
even exhausted bounds do not claim that all mathematical orbitals are known.

Compact ledger identities bind the exact parameter, family, discovery solver,
assignment version, and both numerical profiles. Run budgets and catalog expansion
do not invalidate earlier families. These entries cannot reuse full-family solver
entries. On write and cache read, the coordinator rechecks cycle closure, inverse
trap bounds, Decimal transport, exact angle mappings, and error limits without
retracing. Stream summaries retain numerical evidence, not interval certification.
No full-family fallback is enabled. Pending assignments retain their reason and
closed candidate; they cannot overwrite ratios already verified elsewhere.
Full path generation and caching remain separate selection-time work.

### Confirmation-limit repair

Representative confirmation revision 2 fixes a precision stall: the ray endpoint
could keep converging while the computed orbital hit a rounding floor. More
inverse depth could not remove that error. The solver now raises precision
within the existing ceiling, re-evaluates the same ray at the same depth, and
repeats Newton and the unchanged approach/closure checks. Independent compact
assignment validation still decides whether ratios can be published. The 512
depth cap and 16,000-sample budget are unchanged; full-family fallback stays off.

Compact outcomes retain `confirmation_revision` (missing means 1). Old validated
outcomes remain reusable. Old unresolved `confirmation_depth_limit` outcomes
are reclaimed on the next investigation even without a general unresolved-retry
flag; current-revision bounded failures are cached normally, avoiding retry loops.
Solver identities, profiles, request fingerprints and checkpoint signatures stay
compatible. No schema migration or backfill is needed.

Old format-3 jobs with affected failures become resumable even if their checkpoint
is `done`. Resume commits a targeted retry queue before starting a worker, keeps
the forward family cursor and verified membership, and replaces each old failure
count exactly once after publication. Cancellation, lease replacement, process
death and publication failures retain this queue. The repaired result is cached
before publication, so a failed SQL publication never repeats the calculation.
The read response exposes `confirmation_repair_available`; the UI offers Resume
discovery and reports retry progress separately from the investigated-family count.
Existing selected path caches remain independent of the repair.

`node scripts/verify_catalog_confirmation.js --full` verified all 412 families and
all 13,231 unit-circle ratios after this fix, with no unresolved cases and maximum
analytic coordinate error about 1.3e-15. Each discovery used one continuing ray;
no sibling rays or full geometry were generated. Eight of the formerly failing
families needed 128-digit candidates, and `1/211` and `1/227` needed 256 digits.
They confirmed at depths 156–284, below the unchanged limit. Evidence is saved
to `logs/catalog_confirmation_full_verification.json`.

## Selection-time paths

The Study Points view loads `GET /orbital-data/:id/ray-paths` only for its selected
orbital. Complete compatible caches skip the worker; partial caches retain whole
validated doubling families and trace only missing families. Switching selection
terminates computation and rejects late results. Completed family saves may finish
under their original immutable identity. Empty/pending ratio sets show point boxes
without searching for additional ratios or starting path work.

`trace_known_dynamic_rays` independently checks exact stored cycles and traces
only their supplied ratio families, including catalog angle periods above 24.
It retains the established closure, connectedness, repelling-target, precision,
landing and endpoint-dynamics checks. Geometry is generated to at least
`angle_period + 40` inverse levels, subject to the shared maximum depth and point
budget; ambiguous families remain unresolved. Progress counts individual rays,
while overlays and cache writes accept complete validated families only.

Path PUTs are bounded at 96 MiB, matching the existing compressed/chunk-backed
cache. The route has this body-parser allowance by default; unrelated JSON routes
remain at 25 MiB. An explicit `FRACTO_JSON_BODY_LIMIT` overrides both. Every write
compares current stored targets and updates path lifecycle evidence transactionally.
Discovery's compact family ledger remains independent of path availability.

`test/sdk_selected_catalog_paths.test.js` verifies complete selection-time curves
for the period-58 and period-162 cases. With `FRACTO_DB_INTEGRATION=1`,
`test/orbital_selected_paths.integration.test.js` verifies the large family's
upload, database round trip and lifecycle using connection-local temporary tables.
The compact-job integration test confirms that only the selected orbital gains
geometry after discovery, leaving all unselected orbital caches missing.

Migration 014 adds job-owner fields to family leases. Job and family heartbeats
renew ownership during calculation. A replacement execution of the same expired
job immediately reclaims its abandoned family lease; other live jobs cannot.
Superseded execution tokens cannot publish. Cancellation releases unfinished
family work while retaining committed outcomes and paths for resume.

Progress includes `catalog_processed`, `catalog_total`, `catalog_families`,
`catalog_max_denominator`, `catalog_accepted`, `catalog_unresolved`, and
`catalog_cache_hits`. Counts describe the bounded investigation, not completeness.

`progress.catalog_coverage` persists the denominator report with every catalog
checkpoint: inclusive maximum, family budget, investigated/validated/unresolved/
uninvestigated counts, cache hits, fully investigated denominator prefix, and
`bound_exhausted`. Per-denominator records include family totals and divisor
candidate periods. Unresolved details retain family keys and numerical reasons.
An exhausted bound can still contain unresolved families. These describe the
selected job and numerical profile, not every investigation ever performed for
the focal point. Existing checkpoints reconstruct denominator counts from their
cursor; old unresolved results may lack individual reasons.

The latest terminal survey response includes `coverage` from that run's saved
progress, or null for older results. UI reloads retain the report, and active or
resumable job progress takes precedence. No database migration or backfill is
required for reporting; completed historical runs are not recalculated.

`npm run test:orbital-catalog-jobs` from the root checks publication recovery,
cancellation/resume, additional cycles, and old checkpoint compatibility. With
`FRACTO_DB_INTEGRATION=1`, it also checks real MySQL ownership replacement,
worker calculations, path publication, survey preservation, legacy settings,
and cache reuse in a disposable schema.

## Verification

`npm run data:orbital:catalog-only:benchmark` from the root verifies the current
representative-job pipeline in a disposable schema for c=0, c=-1 and stored core
65 (application rows are read only). Default denominator bound 31 contains 26
families. Cold jobs cancel after two families and resume without repeated work;
fresh warm jobs must use zero solver tasks. Closed cycles, complete published
families, membership, persisted coverage and empty discovery path caches are
checked independently. Full-family reference results compare every shared
angle-to-point assignment and record any unresolved differences explicitly.
The selected orbital then generates and persists its paths; reload verifies the
cache and lifecycle without tracing or populating other orbitals' path caches.

Evidence is `logs/catalog_only_jobs_benchmark.json`. Use `--max-denominator 255
--case unit_circle --reference none --output logs/catalog_only_full_catalog_benchmark.json`
for a separate all-412-family durability and reuse run. The optional selection
benchmark output variable on `test/orbital_selected_paths.integration.test.js`
records the large 162-ray upload/cache timings; see the scripts README.
Run measurements sequentially. Discovery and full drawing have different work
requirements; cache-load figures exclude HTTP transfer and canvas painting.

The 2026-11-10 verification passed 145 targeted SDK, service, UI and MySQL checks.
At denominator 31, each of the three cases verified 26 families and 213 ratios;
all 639 ratio-to-point mappings matched the full-family reference. Cold catalog
jobs took 8.8–10.4 seconds, fresh cached jobs 3.2–3.3 seconds, and the full-ray SDK
calculations 18.8–22.2 seconds at the recorded profiles. Cold jobs include SQL and
resume overhead; the reference calculation omits publication but generates every
family's paths. The compact ledger retained roughly 235–239 kB per case.

Before the confirmation repair, the denominator-255 unit-circle run investigated all 412 families, with
402 verified and 10 unresolved at `confirmation_depth_limit`; these are numerical
confirmation limits, not uninvestigated families or a scheduler stopping point.
Independent analytic verification checked all 11,967 published angles against
their unit-circle landings, with maximum coordinate error about 1.3e-15.
That evidence is `logs/catalog_only_analytic_verification.json`.
The full cold/resumed job took 471.5 seconds and its fresh cached job 166.0
seconds, with 412 cache hits and zero worker tasks. Cached jobs still recheck
evidence and publish membership/ratios; viewing existing saved results does not
start such a job. The compact outcomes occupied 10.5 MB before compression, and
the disposable schema was removed after verification.

The targeted former blocker (`1/163` at the recorded complex parameter) verified
all 162 assignments in 3.90 seconds versus 19.90 seconds for full-family
discovery, with 131,823 bytes of compact output versus 57,804,521 bytes including
paths. The period-58 case measured 0.80 versus 5.81 seconds. Shared mappings match
in every targeted case; small families can have higher overhead with the compact
validator. See `logs/landing_assignment_benchmark.json` for the exact profiles.
The separate high-accuracy unit-circle `1/163` selection test generated all 162
paths (70,506,087-byte upload) in 36.92 seconds, saved them in 2.65 seconds, and
loaded/decompressed/validated them from SQL in 1.97 seconds. Only connection-local
temporary tables were written. See `logs/selected_catalog_path_benchmark.json`;
browser transfer and painting are excluded from these timings.

`npm run data:orbital:catalog:benchmark` from the root runs the current catalog
pipeline against analytic c=0, c=-1, and the read-only stored source 65, with a
31×31 survey and denominator bound 31. Optional CLI arguments change these
explicit diagnostic limits. Every write uses a disposable schema. It verifies
cold cancellation/resume without repeated families, cached execution without
catalog tasks, persisted coverage, complete landing families, stable ranking,
and parity with uninterrupted SDK discovery. Timings and storage measurements
are saved to `logs/orbital_catalog_benchmark.json`; see the scripts README.

`FRACTO_DB_INTEGRATION=1 npm run test:orbital-catalog-jobs` additionally kills a
real coordinator process between ledger commit and publication, expires only
its job lease, and verifies that a replacement reuses the saved family without
retracing. The prior live-family takeover and stale-token tests remain covered.

`node scripts/verify_orbital_resume.js` from the root tests one real pattern-7
source in a disposable schema: cancel/resume during scanning, hard process death
during ray tracing, concurrent resume, worker affinity, competing settings for
one ID, concurrent distinct bailiwicks, stale-owner rejection across all write
paths, finalization recovery, and exact discovery/ray parity. Application rows
are read only. Evidence is saved to `logs/orbital_resume_verification.json`.

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
