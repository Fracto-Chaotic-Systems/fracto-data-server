# fracto-data-server

Express and MySQL service for Fracto's persistent data and computational endpoints. It listens on port 3002 and handles tile metadata, assets, lore, minibrots, orbitals, radial-point data, backups, and several fractal calculation utilities.

## Repository layout

This is an independent Git repository expected at `fracto/servers/fracto-data-server/`. It imports root-owned files such as `../../constants.js`, `../../config/mysql.json`, and modules under `../../sdk/`. Keep this directory directly beneath the root `servers/` directory. Commit service files here and shared SDK/configuration changes in the root repository.

## Requirements

- Node 22, the validated runtime.
- MySQL reachable using the root `config/mysql.json` settings.
- The required Fracto database schema and tables.
- Root configuration files for MySQL and optional Wolfram operations.
- `mysqldump` on `PATH` for the backup endpoint.

Configuration files may contain credentials and are intentionally excluded from version control. Do not put secrets in this repository.

## Installation

From the root repository:

```powershell
npm ci --prefix servers/fracto-data-server
```

Or from this directory:

```powershell
npm ci
```

The project uses native ES modules.

## Authentication lookup measurements

The internal `GET /user/session/:id` route records privacy-safe aggregates for
request arrival, handler duration, MySQL connection setup, SQL execution, and
the combined database lookup in `fracto_metric_window` logs. These phases help
distinguish a request that reaches the data server but stalls from a slow
connection or query. The data server's metrics do not include the caller's
HTTP round trip; the root main server separately measures that as
`auth_user_record_lookup`. No user ID, provider subject, email, session token,
or request URL is recorded.

## CPU-bound worker tasks

The data server runs CPU-intensive, allowlisted jobs through a bounded
`WorkerTaskPool`. Its Promise and Node-style callback interfaces keep compute
work off the Express event loop, so lightweight routes such as internal user
lookups can continue to respond. Database connections and HTTP response objects
stay on the main thread; workers receive only structured-cloneable task names
and payloads. Queue capacity, worker count, and per-task timeout can be tuned
with `FRACTO_DATA_WORKER_QUEUE_LIMIT`, `FRACTO_DATA_WORKER_THREADS`, and
`FRACTO_DATA_WORKER_TIMEOUT_MS`. Saturated queues return a retryable 503 rather
than allowing unbounded queued work. Worker wait and execution times are
reported as aggregate `data_worker_task_wait` and
`data_worker_task_duration` metrics without task inputs.

## Starting the service

Preferred full-system startup from the root repository:

```powershell
npm run start:check
npm start
```

Start only the data service through the root launcher:

```powershell
node scripts/launch_service.js fracto-data-server
```

For isolated development from this directory:

```powershell
npm start
```

The local start script uses `nodemon`; the root supervisor runs `index.js` directly with a 16 GB heap limit. Do not run a second instance while port 3002 is already owned by the supervisor.

## HTTP behavior

The server accepts JSON and URL-encoded request bodies and currently allows CORS requests from any origin. Most successful database responses use `{ "result": ... }`; error handling is not yet uniform across handlers. All routes are registered in `index.js`.

### Health and logs

- `GET /` returns a plain-text welcome message and serves as the health endpoint.
- `GET /logs` has no active response implementation and should not be used yet.

### Fractal calculations

- `GET /fracto_calc` uses `r_num`, `r_den`, `theta_num`, `theta_den`, and `resolution`; returns an `output_filename`.
- `GET /solve` accepts `z_re`, `z_im`, `cardinality`, and `path_factor`; returns `result_re` and `result_im`.
- `GET /hyper_complex_buffer` accepts `re`, `im`, `hn`, `hc`, `scope`, and `width`; returns a calculated canvas buffer.
- `GET /utils/farey_sequence` returns Farey-sequence data.

Calculation endpoints can be CPU intensive. Validate numeric inputs and use conservative resolutions when calling them interactively.

### Radial points

- `GET /radian_data` reads stored radial data using `theta_num`, `theta_den`, and `precision`.
- `PUT /radial_point` stores radial-point information. Supported fields include rational radius and angle components, point and seed coordinates, cardinality, iterations, magnitude, resolution, and focal coordinates.

### Minibrots

- `GET /minibrots` filters records with optional `is_node` and `is_inline` query parameters. `limit` may request up to 20,000 records per category (the default is 5,000), which is useful for randomized detector benchmarks.

### Experimental pyramid detector

`GET /orbital_pyramid?re=<real>&im=<imaginary>` invokes the derivative-pyramid-only cardinality detector. The equivalent `GET /orbital_spectrum?...&detection_mode=pyramid_only` form is also supported, with `detection_mode=pyramid` retained as a compatibility alias. This path is experimental and is intended for measurement only; production Newton and circuitry workflows continue to use the established spectral/return detection paths.
- `PUT /minibrot` inserts or updates a minibrot using a JSON request body.

### Assets

- `GET /asset` looks up one asset using fields such as `asset_id`, dimensions, focal point, scope, filename, public URL, and asset type.
- `GET /assets` returns asset records.

### Tiles

- `GET /tiles` returns tile records, optionally filtered by `folder`.
- `GET /tile` reads one tile using `short_code`.
- `PUT /tile` inserts or updates tile metadata from a JSON body.
- `GET /tile_coverage` returns stored coverage for a requested `level`.

These database records are separate from the tile server's compiled in-memory index.

### Orbitals

- `GET /orbital` calculates one orbital from `re`, `im`, and `limit`.
- `GET /orbitals` returns the established `FractoFastCalc.calc()` series
  (with `pattern` unique points plus a closing duplicate) and a bounded seed
  survey over both real and imaginary seeds `[-1.5, 1.5]` at 0.025 intervals. The
  survey uses `FractoCardinality()` with each seed passed through its `seed`
  option and a fixed 4,096-iteration horizon per sample (adaptive expansion is
  disabled so the full plane scan remains bounded). For parameters outside
  the main cardioid, the SDK uses its seeded fast-calculator fallback at
  `seed_level: 0.00625`. Detected non-singleton
  candidates are plotted in pattern colors; inconclusive samples are grey,
  while escapes and singleton results are omitted. Candidates are
  observational, not mathematical proof.
  The survey runs in the bounded compute-worker pool so this expensive scan
  does not delay the legacy chart or block other data-server requests. The
  initial response includes a survey job ID and progress; poll
  `GET /orbitals/seed-survey/:job_id` for progress and completion. Progress
  advances every eight seeds, streaming point deltas that are accumulated for
  polling clients. A newer focal-point request cancels the older
  queued or running survey so obsolete scans cannot occupy the bounded pool;
  repeated requests for the same active focal point reuse its job. Jobs are
  process-local and expire after 15 minutes. The survey does not alter
  zero-seed `calc()` behavior. Its response also
  gives the range of each plotted orbit's maximum distance from its points to
  `Q`. Detector-driven Newton refinement is provided
  separately by `/orbital_newton` and is not repeated by this endpoint.
- `GET /circuitry?re=<re>&im=<im>` samples a smooth closed curve around the
  periodic orbit for the Mandelbrot parameter `c = re + im*i`. Optional
  `samples` controls the number of returned `{t, C:{re, im}}` values and
  `looped_points=true` selects the alternate normal orientation, and
  `interpolation=radial_sweep` selects the polar radial-sweep interpolator
  instead of the default Hermite interpolator. In radial-sweep mode, `t` is
  the unwrapped sweep angle around `Q`.
  `optimize_polarity=true` exhaustively tests per-point normal polarities for
  small orbits, selecting the result using normalized arc length, tangent
  variation, tangent-reversal penalties, and directional angular sweep around
  `Q`. Curve normals use the ray from
  `Q = (1 - sqrt(1 - 4P)) / 2` to each orbital point. The response includes
  `Q`, the center used for those rays, and the score components. Orbital
  discovery uses `FractoFastCalc`, allowing deep periodic orbits to require
  millions of iterations. Without `samples`, 50 values are generated between
  each pair of orbital points so integer `t` values are represented exactly.

### Lore

- `GET /lore_categories` returns lore categories.
- `GET /lore_content?id=<id>` returns one content record.
- `GET /lore_content_list?category_id=<id>` lists content for a category.
- `PUT /lore_storage` inserts or updates lore content and metadata from a JSON body.

### Backup

- `GET /backup?table=<name>` invokes `mysqldump` for one table and writes output under the root `backup/` directory.

This endpoint executes an external database utility and changes local state. Restrict it to trusted administrative callers. Its current implementation assumes local filesystem paths and MySQL command-line availability.

## Database access

`mysql.js` creates `mysql2` connections using `config/mysql.json` and exposes shared `select`, `insert`, `update`, connect, and disconnect helpers.

Several helpers dynamically construct table, column, ordering, filtering, and update fragments. Treat route inputs as trusted-only until these operations use allowlists and parameterized SQL consistently. The service should not be exposed directly to an untrusted network in its current form.

Likely database domains include tile metadata and coverage, assets, minibrots, lore, radial points, and orbitals. Schema creation and migration are not managed by this repository.

## Important modules

### Request handlers

- `handle_tile.js`, `handle_tiles.js`, `handle_coverage.js`: tile persistence.
- `handle_asset.js`: asset records.
- `handle_lore.js`: lore content and categories.
- `minibrots.js`: minibrot persistence.
- `radial_points.js`: radial data.
- `handle_orbital.js`: orbital calculations.
- `fracto_calc.js`, `solve.js`, `hyper-complex.js`: computation endpoints.
- `handle_backup.js`: database export.

### Experimental and maintenance code

Files such as `beast_mode.js`, `beast_mode_data.js`, `core_calc.js`, `orbitals_not.js`, `polynomial.js`, and `wolfram.js` are not registered as HTTP routes in `index.js`. Some execute calculations or sample requests when run directly. Review their code and side effects before invoking them.

`farey_sequence.csv` and `handlers/orbitals_out.json` are repository data artifacts used by calculation work.

## Shared root dependencies

The service relies on root-owned resources, including:

- `constants.js` for port definitions.
- `utils.js` for child-process helpers used by backups.
- `sdk/` numerical and fractal utilities imported by handlers.
- `config/mysql.json` for database access.
- `config/wolfram.json` for Wolfram-related experiments.
- `backup/` for generated SQL exports.

Changes to these files belong in the root repository.

## Validation

From the root repository:

```powershell
npm run check
npm run start:check
```

For a manual health check:

```powershell
node scripts/launch_service.js fracto-data-server
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3002/
```

Stop the launcher with Ctrl+C afterward.

The service's `npm test` command runs its Node test suite. Review coverage for the endpoint or worker being changed; passing unit tests do not establish live MySQL integration or complete endpoint-contract coverage.

## Logs and troubleshooting

When supervised by the root process, output is appended to `logs/fracto-data-server-log-YYYY-MM-DD.txt` in the root repository.

Common failures:

- **Database connection errors:** verify `config/mysql.json`, MySQL availability, credentials, and schema.
- **Missing shared module:** restore this repository to `fracto/servers/fracto-data-server/`.
- **Port 3002 already in use:** stop the existing supervisor or isolated service.
- **Backup errors:** verify `mysqldump` is installed and the root `backup/` directory is writable.
- **Repository update blocked:** commit, stash, or revert tracked changes in this repository.
- **Unexpected calculation latency:** reduce resolution/limits and inspect the dated service log.

This service currently has permissive CORS and no authentication middleware. Keep it behind a trusted boundary until authorization, validation, and hardened SQL construction are added.

## Independent survey grid and canvas dimensions

`GET /orbitals/seed-survey` accepts independent square dimensions:

- `grid_size`: positive integer samples per side, default `121`.
- `canvas_size`: positive integer display pixels per side, default `grid_size`.
  This is response metadata; it never changes sample count or coordinates.
- `sampling`: `bounds` (default) includes both seed bounds, or `centers` samples
  cell centers. A 1×1 grid samples `(0, 0)` with zero step in either mode.
- `encoding`: `rows` (default) streams decoded pattern/iteration rows, or
  `packed` streams the established 13-byte records. Either works at any grid size.

For example, `?re=0&im=0&grid_size=157&canvas_size=350` computes 24,649 values
for a 350×350 display. `grid_size=157&canvas_size=80` computes the same grid.
The browser scales the grid using the shared SDK renderer; the data service
never resamples the numerical data to match the display.

`resolution` remains a grid-size alias; conflicting `resolution` and `grid_size`
values return HTTP 400. Legacy `resolution=1024` requests without `grid_size`
retain center sampling and packed encoding unless explicitly overridden.
New `grid_size` requests have no size-dependent sampling or encoding behavior.
Job start, polling, and final results report `grid_size`, `resolution`,
`canvas_size`, `sampling`, and `encoding`. The job identity includes these
options. Existing polling field names (`render_batch`, `canvas_buffer_batch`,
`render_mode`) remain compatible; `render_mode` now means packed encoding.

All integer sizes within configured capacity are accepted rather than a fixed
list. `FRACTO_SURVEY_MAX_GRID_SIZE` defaults to `1024`;
`FRACTO_SURVEY_MAX_CANVAS_SIZE` defaults to `16384`. Set these environment
variables to fit installation capacity; both Compose application targets forward
them. Oversized, zero, negative, fractional, and non-finite dimensions are rejected
before work is submitted or buffers allocated. Existing worker queue, timeout,
and job-retention controls remain in effect. Raising the grid limit increases
sample count quadratically.

### Outside-cardioid orbital charts

`/orbital_newton` refines positive non-estimated calculator periods outside the
main cardioid with the requested Newton mode, labeling their source
`fracto_fast_calc_outside_cardioid`. Seeded non-singleton calculator results
also populate the survey's `stable_points` and magnitude range, so the orbital
points page can display both charts at points such as
`0.2693785307+0.5397724687i`. These remain numerical candidates, not period proofs.
