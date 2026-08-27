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

- `GET /minibrots` filters records with optional `is_node` and `is_inline` query parameters.
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
- `GET /orbitals` calculates or retrieves multiple orbital results using the same parameters.

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

The service's own `npm test` command is currently a placeholder and intentionally fails. Database integration tests and endpoint contract tests remain future work.

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