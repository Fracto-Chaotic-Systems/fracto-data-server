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
- `handle_circuitry.js` serves circuitry study data.
- `handle_coverage.js` serves tile-coverage information.
- `handle_ensure_table.js` creates or updates an allowed database table schema.
- `handle_lore.js` serves lore categories, content, and storage operations.
- `handle_orbital.js` handles orbital derivation and listing requests.
- `handle_orbital_discovery.js` detects orbital patterns for discovery requests.
- `handle_orbital_newton.js` computes Newton-style orbital results.
- `handle_orbital_spectrum.js` generates orbital spectrum and pyramid results.
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
- `orbitals/` groups supporting orbital data and calculation modules.

Keep route-specific validation and access rules near the handler that enforces them. Add or update the relevant entry here when a handler file or its responsibility changes.
