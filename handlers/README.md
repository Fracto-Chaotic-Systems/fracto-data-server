# Data server handlers

This directory contains the HTTP handlers and calculation helpers used by the Fracto data server. Route registration is in the parent `index.js`; authentication and data access behavior should be documented alongside the handler that owns it.

## Files

- `beast_mode.js` approximates points along the configured polynomial orbit.
- `beast_mode_data.js` stores coefficient sets used by beast-mode calculations.
- `claim_automation.js` claims the next eligible automation job for a worker.
- `core_calc.js` performs core complex-orbit calculations and exposes an HTTP handler.
- `fracto_calc.js` handles the Fracto calculation endpoint.
- `handle_asset.js` reads asset records and builds validated asset-list queries.
- `handle_automation.js` reads and creates automation jobs.
- `handle_automation_update.js` validates and applies automation-job updates.
- `handle_backup.js` handles database backup requests.
  - `handle_circuitry.js` serves circuitry study data. Its default detector
    uses the shared adaptive evidence gate from `/orbital_newton`, increasing
    the critical-orbit horizon when a short-window candidate is ambiguous;
    `adaptive_detection=false` is available for controlled comparisons.
- `handle_coverage.js` serves tile-coverage information.
- `handle_ensure_table.js` creates or updates an allowed database table schema.
- `handle_lore.js` serves lore categories, content, and storage operations.
- `handle_orbital.js` handles orbital derivation, returns the legacy points
  series, and starts/polls process-local seeded survey jobs. The dedicated
  `GET /orbitals/seed-survey?re=...&im=...` route starts only the survey job;
  `GET /orbitals/seed-survey/:job_id` returns cumulative progress and the final
  result. Resolution is 121 by default or 1024 for render. For an in-cardioid
  focal point, both modes call the SDK's seeded `FractoCardinality` for each
  seed at a fixed 4,096-iteration horizon with adaptive detection disabled;
  outside the cardioid, the SDK uses its seeded `FractoFastCalc` compatibility
  path and supplies `[pattern, iteration]` data to the shared canvas-color
  pipeline in both preview and render modes. The request's iteration limit is
  forwarded as `seed_iteration_limit` to `calc_from_seed()` and defaults to
  100,000. Render streams 13-byte-per-pixel
  row records in batches of up to 16 rows. Job buffers are process-local;
  preview/render task limits are five minutes/one hour, and completed jobs
  expire after 15 minutes. See `handlers/orbitals/README.md` and
  `sdk/FractoCardinality.md` for method, payload, and display semantics.
- `handle_orbital_discovery.js` detects orbital patterns for discovery requests.
- `handle_orbital_newton.js` computes detector/Newton orbital results and
  applies a two-point FractoFastCalc-cardinality fallback for
  consumers such as the orbital-points Newton-derived chart.
- `handle_orbital_spectrum.js` generates orbital spectrum and pyramid results.
- `data_compute_worker.js` runs allowlisted CPU-bound task payloads away from the data-server event loop; HTTP and database objects remain on the main thread.
- `worker_task_pool.js` provides a bounded worker-thread pool with Promise and callback completion, queue backpressure, timeouts, cancellation of queued or active work, and aggregate metrics. Cancelling active work terminates and replaces its worker slot so a stale CPU-bound task cannot hold capacity.
- `handle_query.js` executes the data server's constrained query endpoint.
- `handle_tile.js` reads and writes individual tile records.
- `handle_tiles.js` handles tile-list requests.
- `handle_users.js` provisions OIDC users, enforces bootstrap and access policy, and records authentication events. Its Express route factories adapt handlers that accept an injectable connection factory; register those factories rather than passing the three-argument handler directly, because Express uses the third argument for `next`.
- `handle_video.js` creates or uploads video records.
- `handle_video_get.js` retrieves a video record.
- `handle_video_update.js` updates video metadata and render state.
- `health.js` checks data-server health and dependencies.
- `hyper-complex.js` handles hyper-complex buffer calculations.
- `initialize_automation.js` defines and initializes the automation table.
- `initialize_users.js` defines and initializes user, login-event, and bootstrap-state tables.
- `logistic_map/initialize_span_catalog.js` creates the immutable legacy logistic-map span catalog table without seeding rows.
- `logistic_map/legacy_span_catalog.js` validates legacy span JSON while preserving its exact source objects and reports non-mutating catalog geometry summaries.
- `logistic_map/audit_legacy_span_catalog.js` runs the read-only catalog audit and can write a checksum-bound report of duplicates, overlap types, touching endpoints, gaps, and width inconsistencies.
- `logistic_map/span_catalog_audit_bifurq_v1.json` records findings for the archived first legacy catalog version; it does not normalize or verify spans.
- `logistic_map/review_span_interior.js` runs bounded Fracto calculations at selected points inside a legacy span and computes the candidate cycle multiplier.
- `logistic_map/review_span_edges.js` samples neighborhoods of reported span endpoints, records candidate multipliers and separate finite-time Lyapunov evidence, and includes the analytic period-4 birth bracket.
- `logistic_map/generate_span_render_packet.js` calculates an exploratory parameter grid, transactionally stores matching per-r review samples, and writes a versioned SHA-256 packet plus range index. Packet calculation is the source of both outputs; the files are not reconstructed from database rows, and publication across database/files/index is not atomic.
- `logistic_map/initialize_span_catalog.js` creates the immutable imported-source catalog and mutable calculation-review sample tables.
- `logistic_map/span_interior_review_bifurq_v1.json` records the first three finite-precision interior calculations for legacy source entry 0, including the distinction between machine repeat and tolerance-reduced candidate periods; these are not mathematically proven cycles.
- `logistic_map/span_edge_review_bifurq_v1.json` records pilot endpoint checks and explicitly leaves both reported endpoints unverified as event boundaries.
- `logistic_map/render_packets/` is the local output directory for generated exploratory packets and range indexes. It is Git-ignored while a durable persistence strategy is undecided, so it may be absent from a fresh checkout. The packet files are derived output, not source-of-truth data.
- `logistic_map/import_legacy_span_catalog.js` explicitly imports an archived or supplied legacy `spans.json` file with checksum/version idempotency and transactional database writes.
- `logistic_map/legacy_spans_bifurq_v1.json` is the byte-preserved legacy catalog archive used for the first import.
- `logs.js` serves data-server logs.
- `minibrots.js` handles minibrot list and detail requests.
- `orbitals_not.js` contains recursive orbital derivation helpers.
- `orbitals_out.json` contains orbital output data used by the related calculation flow.
- `polynomial.js` contains polynomial evaluation and derivative helpers.
- `radial_points.js` reads and writes radial-point data.
- `solve.js` solves complex polynomial roots for the solve endpoint.
- `status.js` reports main-server status data.
- `utils.js` provides shared data-server handler utilities, including CSV conversion and sequence handling.
- `wolfram.js` wraps Wolfram Alpha queries used by the data service.
- `orbitals/` groups active orbital calculation modules and an `archive/`
  subfolder of retired research experiments. Archived source is excluded from
  root syntax/format checks and Docker build context; historical tests may
  still import it explicitly.
- `logistic_map/` contains the logistic-map request/result contract, bounded standalone orbit calculator, cautious numerical cycle candidates, and design notes; higher-precision validation, persistence, and HTTP integration are planned next.

Keep route-specific validation and access rules near the handler that enforces them. Add or update the relevant entry here when a handler file or its responsibility changes.
