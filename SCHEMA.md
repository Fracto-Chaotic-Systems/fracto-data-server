# Fracto Database Schema Reference

This document is the canonical, exact reference for the Fracto database. Each
table has its own section describing every column, type, nullability, default,
constraint, owner, and migration history. JSON fields are documented to the
same standard, including their complete shape, types, defaults, versions, and
normalization rules. Implementation changes are incomplete until this document
is updated in the corresponding table or JSON section.

## Documentation and versioning policy

- Add a new table as a top-level section named for the table.
- Record every column addition, removal, type change, default change, index,
  or constraint in that table's schema history, including the migration needed
  for existing records.
- Give significant JSON shape changes a version or capability marker. Describe
  the prior and current shapes, compatibility behavior, defaults for missing
  properties, and the migration or normalization path.
- Keep server ownership explicit: the server that owns a table's semantics
  defines its schema, while the data server owns connections and DDL execution.
- Add representative fixtures and a reproducible migration/normalization test
  whenever a schema or JSON version changes.

## `users` table

The main server owns authentication semantics; the data server owns the
connection and startup DDL. The table is an explicit allowlist of identities
that have authenticated through an external OpenID Connect provider and have
been enabled by an administrator. A successful provider login does not enable
the record automatically.

| Field | MySQL type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | no | auto-increment | Stable local user identifier. |
| `provider` | `VARCHAR(64)` | no | none | Identity-provider name. |
| `provider_subject` | `VARCHAR(255)` | no | none | Provider's stable subject identifier. |
| `email` | `VARCHAR(320)` | yes | `null` | Profile email; not an identity key. |
| `display_name` | `VARCHAR(255)` | yes | `null` | Display name supplied by the provider. |
| `enabled` | `TINYINT(1)` | no | `0` | Allowlist switch. Only enabled users may enter the app. |
| `role` | `VARCHAR(64)` | yes | `null` | Reserved for a future authorization model. |
| `created_at` | `TIMESTAMP` | no | current timestamp | Local record creation time. |
| `updated_at` | `TIMESTAMP` | no | current timestamp/on update | Last local record update. |
| `last_login_at` | `DATETIME` | yes | `null` | Last successful authenticated login. |
| `last_seen_at` | `DATETIME` | yes | `null` | Last validated session activity. |

The pair `(provider, provider_subject)` is unique. Email and display name may
change and therefore must not be used as the primary identity key.

## `auth_bootstrap_state` table

The data server owns this deployment-local marker for the one administrator
established during installation. The database for each server deployment has
its own marker table; it contains no provider subject, email, display name, or
bootstrap secret. The `user_id` refers to the local row in `users`, avoiding a
second copy of account identity data. The singleton `id` is reserved as `1`;
bootstrap logic must only read or write that value. The state is written only
after the initial administrator has been provisioned successfully.

| Field | MySQL type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `TINYINT UNSIGNED` | no | none | Singleton marker key; bootstrap uses `1`. |
| `user_id` | `BIGINT UNSIGNED` | no | none | Local `users.id` of the initial administrator. |
| `completed_at` | `TIMESTAMP` | no | current timestamp | Time initial administrator provisioning completed. |

The marker has a primary key on `id`; bootstrap logic must reserve and use only
`id=1` so there is one deployment marker. A row is not inserted by schema
initialization; it is created by the explicit installer bootstrap operation.
The `user_id` is intentionally retained if the user row is later removed, so
deleting an account cannot silently reopen first-run bootstrap.

## `login_events` table

The main server writes authentication audit events through the data server.
Events are append-only records and are separate from the current user state.

| Field | MySQL type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | no | auto-increment | Event identifier. |
| `user_id` | `BIGINT UNSIGNED` | yes | `null` | Local user id when one is known. |
| `provider` | `VARCHAR(64)` | no | none | Provider involved in the attempt. |
| `provider_subject` | `VARCHAR(255)` | no | none | Provider subject, when supplied. |
| `event_type` | `VARCHAR(32)` | no | none | `authenticated`, `rejected`, `disabled`, `logout`, or `error`. |
| `success` | `TINYINT(1)` | no | `0` | Whether the event completed successfully. |
| `event_at` | `TIMESTAMP` | no | current timestamp | Event time recorded by the server. |
| `ip_address` | `VARCHAR(45)` | yes | `null` | Optional IPv4 or IPv6 source address. |
| `user_agent` | `VARCHAR(512)` | yes | `null` | Optional browser user-agent summary. |
| `details` | `JSON` | yes | `null` | Non-secret diagnostic context. Tokens and secrets are prohibited. |

The data server creates an index on `(provider, provider_subject, event_at)`
for identity history and audit queries.

### Authentication schema history

- Stage 2: added `users` and `login_events`. Existing records are preserved;
  missing columns are added idempotently during data-server startup.
- Stage 3: added the empty `auth_bootstrap_state` table. Existing user records
  are preserved; startup creates the table without seeding a marker or user.

## `assets` table

The asset server owns the meaning of asset records; the data server owns the
connection and query execution. Asset records used by the welcome page are
ordinary image assets whose `asset_type` is `image`, `width` is `4800`, and
`height` is `4800`.

| Field | MySQL type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `INT` | no | auto-increment | Stable database identifier. |
| `asset_id` | `VARCHAR(45)` | no | none | Unique public asset identifier. |
| `width` | `INT` | no | none | Source image width in pixels. |
| `height` | `INT` | no | none | Source image height in pixels. |
| `focal_point_x` | `DOUBLE` | no | none | Complex-plane real coordinate associated with the image. |
| `focal_point_y` | `DOUBLE` | no | none | Complex-plane imaginary coordinate associated with the image. |
| `scope` | `DOUBLE` | no | none | Complex-plane scope used to generate the image. |
| `filename` | `VARCHAR(45)` | no | none | Source or generated filename. |
| `public_url` | `VARCHAR(255)` | no | none | Fetchable public image URL. |
| `asset_type` | `VARCHAR(45)` | no | none | Asset classification, such as `image`. |

`asset_id` is unique and `id` is the primary key. The welcome-image query
must apply the allowlisted predicates `asset_type = 'image'`, `width = 4800`,
and `height = 4800` in the data server. Records with an empty or invalid
`public_url` are not usable as welcome images and should be omitted by the
consumer or reported as invalid data.

### Welcome-image query contract

The planned filtered asset response is an object containing a `result` array.
Each usable item includes at least `asset_id`, `public_url`, `width`, and
`height`; focal-point and scope metadata may be retained for future welcome
screen behavior. The current unfiltered asset-list behavior remains
backward-compatible until the filtered endpoint is introduced.

## `videos` table

| Field | Type | Description |
| --- | --- | --- |
| `id` | integer | Stable video-project identifier. |
| `title` | string | User-visible project title. |
| `created_at` | timestamp | Record creation time. |
| `updated_at` | timestamp | Most recent persisted update. |
| `archived` | boolean | Soft-delete marker; `false` by default. |
| `meta` | JSON object | Technical rendering and output configuration. |
| `script` | JSON object | Ordered motion and frame instructions. |
| `meta_version` | integer | Version of the `meta` document, when independently versioned. |
| `script_version` | integer | Version of the `script` document, when independently versioned. |
| `render_state` | `VARCHAR(16)` | `idle`, `queued`, `running`, `frames_ready`, `encoding`, `completed`, `failed`, or `cancelled`; defaults to `idle`. |
| `render_progress` | `INT UNSIGNED` | Integer percentage from 0 to 100; defaults to `0`. |
| `render_error` | `VARCHAR(4096)` nullable | Most recent render failure message, or `null`. |
| `render_started_at` | `DATETIME` nullable | Time frame production began, or `null` before execution. |
| `render_completed_at` | `DATETIME` nullable | Time rendering stopped, completed, or was cancelled, or `null`. |
| `render_output_uri` | `VARCHAR(1024)` nullable | Frame workspace while `frames_ready`, final server-side output location after successful assembly, or `null`. |
| `render_frame_count` | `INT UNSIGNED` nullable | Number of frames requested/generated for the render, or `null` before planning. |

The render lifecycle is owned by the asset server and persisted on the video
record. A render request moves a video from
`idle`, `failed`, `cancelled`, or `completed` to `queued`. A queued or running
render cannot be started again until it is cancelled or reaches a terminal
state. After Stage 2, `frames_ready` means that numbered PNG frames are
available. Stage 3 changes the state to `encoding` while ffmpeg assembles the
frames, then to `completed` only after the output file has been verified. The
separate `POST /video/:id/render/assemble` action retries assembly after a
restart without regenerating frames. Cancellation is idempotent for terminal states and records
`render_state = cancelled`. Retry is allowed only from `failed` or `cancelled`.
`frames_ready` means numbered PNG frames are available for the Stage 3 encoder
but no final video exists yet. `render_output_uri` points to the frame
workspace in this state and to the completed video file after `completed`.

### Render lifecycle schema history

- Initial video schema: no render lifecycle columns.
- Stage 1: added `render_state`, `render_progress`, `render_error`,
  `render_started_at`, `render_completed_at`, `render_output_uri`, and
  `render_frame_count`. Asset-server startup adds missing columns through the
  data server's idempotent table-initialization endpoint; existing records use
  the defaults above.
- Stage 2: added the `frames_ready` state for completed PNG frame production.
- Stage 3: added the `encoding` state and ffmpeg assembly; successful output
  changes the state to `completed` and removes the temporary frame workspace.
- Stage 4: completed output is served through the asset server's guarded
  `/video/:id/render/output` route; consumers must use that route rather than
  treating `render_output_uri` as a public filesystem path.

The existing `assets` table is also checked during asset-server startup. Its
schema is owned by the asset server and is initialized through the data server
in the same idempotent manner.

If the implementation uses one record-wide version instead, document that
choice here as `schema_version` and remove the unused version columns from the
database design.

### `meta` JSON field

Current version: **not yet defined**

The initial `meta` object contains the project description and basic output
dimensions and timing. These are JSON properties, not additional columns in
the `videos` table.

| Property | Type | Description |
| --- | --- | --- |
| `description` | string | User-authored description of the video project. |
| `frame_size` | integer | Width and height of the square output frame, in pixels. |
| `frame_rate` | number | Output frame rate, in frames per second. |
| `format` | enum string | Container format: `mp4`, `webm`, `mov`, or `mkv`. |
| `codec` | enum string | Video codec: `h264`, `hevc`, `vp9`, or `av1`. |
| `pixel_format` | enum string | Pixel encoding, such as `yuv420p`, `yuv444p`, or `rgba`. |
| `bitrate` | integer or null | Target video bitrate in bits per second. |
| `quality` | number or null | Codec-specific quality value, such as CRF. |
| `aspect_ratio` | number | Display width-to-height ratio. |
| `duration` | number or null | Expected runtime in seconds; null when derived from the script. |
| `audio` | object | Audio output configuration; see the nested shape below. |
| `color_space` | object | Color interpretation metadata; see the nested shape below. |
| `keyframe_interval` | integer or null | Maximum number of frames between keyframes. |
| `output_extension` | enum string or null | Preferred output suffix: `mp4`, `webm`, `mov`, or `mkv`. |
| `output_uri` | string or null | Destination URI or path for generated output. |
| `thumbnail` | object | Poster-frame or preview configuration. |
| `render_engine` | string or null | Renderer identifier, such as `fracto-raster`. |
| `capability_version` | string or null | Version of the renderer capability set used. |
| `created_by` | string or null | User or process that created the project. |
| `updated_by` | string or null | User or process that most recently changed the project. |

The initial shape is:

```json
{
  "description": "",
  "frame_size": 1024,
  "frame_rate": 30,
  "format": null,
  "codec": null,
  "pixel_format": null,
  "bitrate": null,
  "quality": null,
  "aspect_ratio": 1,
  "duration": null,
  "audio": {
    "enabled": false,
    "codec": null,
    "sample_rate": null,
    "channels": null,
    "frequency": null
  },
  "color_space": {
    "primaries": null,
    "transfer": null,
    "matrix": null,
    "range": null
  },
  "keyframe_interval": null,
  "output_extension": null,
  "output_uri": null,
  "thumbnail": {
    "enabled": false,
    "frame_index": null,
    "output_uri": null
  },
  "render_engine": null,
  "capability_version": null,
  "created_by": null,
  "updated_by": null
}
```

The `audio.codec` value is an enum such as `pcm_s16le`, `aac`, `opus`, or
`flac`; `audio.sample_rate` is an integer in hertz; `audio.channels` is an
integer count; and `audio.frequency` is the source tone in hertz when a test
waveform is included. The `color_space` members are enum strings (for
example, `bt709`, `srgb`, `gamma22`, or `full`), and `color_space.range` is
either `full` or `limited`. `thumbnail` contains a boolean `enabled`, an
integer `frame_index`, and an optional destination URI.

The defaults above are the initial application defaults. Future properties
must remain optional for older records and be supplied through normalization
when absent.

### `script` JSON field

Current version: **not yet defined**

The `script` object contains an ordered `steps` array. At the current minimal
schema, each step identifies a focal point and scope for that portion of the
video path:

| Property | Type | Description |
| --- | --- | --- |
| `steps` | array | Ordered video path steps; defaults to an empty array. |
| `steps[].focal_point` | object | Complex-plane location with numeric `x` and `y` coordinates. |
| `steps[].scope` | number | Width of the rendered complex-plane region for the step. |

```json
{
  "steps": [
    {
      "focal_point": { "x": -0.75, "y": 0.0001 },
      "scope": 2.5
    }
  ]
}
```

Additional frame-specific properties may be added later. They must remain
optional until their defaults and migration behavior are documented, so this
minimal shape remains readable by older consumers.

## Shared `automation` table

The `automation` table is shared by all Fracto servers that expose automated
work. It is not a Tiles-only table: the Tiles server, Asset server, and future
servers use the same physical table while separating their records with the
`automation_type` namespace. Each server owns the meaning of its own task
documents and is responsible for validating them before execution. The data
server owns the MySQL connection, creates the table during startup, and applies
additive schema migrations. Feature servers use the data server's automation
endpoints for reads, inserts, and state changes.

The data server maintains the composite index
`(automation_type, state, created_at, id)`. It supports oldest-ready-job
queries without sorting the potentially large `tasks` JSON document, while the
`id` suffix makes ordering deterministic when timestamps tie.

| Field | MySQL type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | no | auto-increment | Stable automation-job identifier and primary key. |
| `title` | `VARCHAR(255)` | no | none | User-visible name of the job definition. |
| `automation_type` | `VARCHAR(100)` | no | none | Server/job namespace, such as `tiles` or `assets`. Records must be queried with this discriminator. |
| `state` | `VARCHAR(16)` | no | `ready` | Lifecycle state of the job; see the state table below. |
| `created_at` | `TIMESTAMP` | no | current timestamp | Time the record was created. |
| `updated_at` | `TIMESTAMP` | no | current timestamp | Time the record was last modified; updated automatically by MySQL. |
| `run_start` | `DATETIME` | yes | `NULL` | Time execution began; remains null for jobs that have not run. |
| `run_stop` | `DATETIME` | yes | `NULL` | Time execution stopped; used when a run is paused or complete, and may also be set for a failed run. |
| `tasks` | `JSON` | no | none | Server-owned ordered task definition. Its shape is determined by `automation_type`; for Tiles it is an array of task objects. |
| `checkpoint` | `JSON` | yes | `NULL` | Latest versioned engine checkpoint, written at successful operation boundaries so a paused or interrupted job can resume safely. |

### Automation states

The current state vocabulary is deliberately small and shared across servers:

| State | Meaning | Timestamp expectations |
| --- | --- | --- |
| `draft` | A job is being defined or edited and is not eligible to run. | `run_start` and `run_stop` are normally `NULL`. |
| `ready` | A validated job is available for execution. | `run_start` and `run_stop` are normally `NULL` until execution begins. |
| `running` | The job is actively executing. | `run_start` is set; `run_stop` is `NULL`. |
| `paused` | Execution has been intentionally suspended and may resume. | `run_start` remains set; `run_stop` records the pause time. |
| `failed` | Execution stopped because of an error. | `run_start` is set; `run_stop` should record the failure time when known. |
| `complete` | All tasks finished successfully. | `run_start` and `run_stop` are set. |

State transitions must be performed by the server that owns the matching
`automation_type`. A consumer should treat unknown future states as
non-executable and preserve the record rather than deleting or rewriting it.
`run_start` and `run_stop` describe the latest run; a future execution-history
table may be introduced if per-run history is required.

The optional `checkpoint` field is an engine-owned envelope, not a replacement
for the server-specific `tasks` document. It contains the checkpoint version,
job identity, task and operation indexes, completed-operation count, and
normalized progress. Consumers must validate its version and rebuild the
operation registry before restoring it. A checkpoint captured while running is
restored as paused because an in-flight operation cannot safely be reconstructed.

The Tiles server claims work through an atomic data-server transaction. The
oldest `ready` record (ordered by `created_at ASC, id ASC`) is locked, changed
to `running`, assigned `run_start = CURRENT_TIMESTAMP`, and returned to the
requesting client before the transaction is committed. This prevents two
automation clients from receiving the same job. A claim request returns
`{ "job": null }` when no matching ready job exists.

### `tasks` JSON contract

`tasks` is required JSON, but its internal shape is server specific. Every task
producer must store a version or capability marker before introducing a
breaking shape change, and every consumer must normalize missing optional
properties to documented defaults.

#### Tiles task contract

For `automation_type = "tiles"`, `tasks` is an ordered array. Tasks are added
in manager mode and saved together as one `ready` job:

| Property | Type | Description |
| --- | --- | --- |
| `generate_code` | string | Coverage operation: `redo`, `can_do`, `blank`, or `interior`. `redo` corresponds to the coverage table's `tile count` operation. |
| `level` | integer | Tile level targeted by the operation. |
| `short_codes` | string[] | Ordered tile shortcodes included in the operation. |
| `focal_point` | object | Current frame focal point captured at save time, with numeric `x` and `y` properties. |
| `scope` | number | Current frame scope captured at save time. |

Task order is preserved. No application-level shortcode count limit is
imposed; the UI emits an informational warning at each additional
10,000-shortcode boundary because large JSON updates can take longer to
serialize and persist.

Example:

```json
[
  {
    "generate_code": "can_do",
    "level": 12,
    "short_codes": ["0210302.gz"],
    "focal_point": { "x": -0.75, "y": 0.0001 },
    "scope": 2.5
  }
]
```

The table itself does not enforce task semantics, ordering, or execution
constraints. Those rules belong to the server identified by
`automation_type`.

## `orbital_discovery_runs` table

Data-service-owned, added by root migration `007_orbital-progressions.sql`.
InnoDB; no existing table or source bailiwick is modified. Protocol and limits:
[ORBITAL_DATA.md](ORBITAL_DATA.md). This is the initial `orbital-discovery-v1`
shape; there is no prior orbital-storage format to normalize or backfill.

| Field | MySQL type | Null/default | Meaning |
| --- | --- | --- | --- |
| `id` | ASCII binary `CHAR(36)` | required, primary key | UUID v4 job ID. |
| `request_key` | ASCII binary `VARCHAR(128)` | nullable, unique | Optional idempotency key. |
| `request_hash` | ASCII binary `CHAR(64)` | required | SHA-256 of calculation version, source ID, normalized core coordinates, source pattern and settings. |
| `source_bailiwick_id` | `BIGINT UNSIGNED` | required | Source record reference; deliberately no FK so the snapshot survives source retirement. |
| `focal_key` | ASCII binary `CHAR(64)` | required | SHA-256 of canonical `[re,im]` decimal strings. |
| `focal_re`, `focal_im` | ASCII `VARCHAR(768)` | required | Snapshotted core parameter, magnitude at most 16. |
| `source_pattern` | `INT UNSIGNED` | required | Positive source pattern, not orbital identity. |
| `settings` | `JSON` | required | Validated settings object described below. |
| `calculation_version` | `VARCHAR(64)` | required | `orbital-discovery-v2` for new calculations; historical versions retained. |
| `status`, `stage` | `VARCHAR(32)` | required | Lifecycle and execution stage; enumerated in the protocol. |
| `progress` | `JSON` | required | Progress object described below; initially `{}`. |
| `error_code` | `VARCHAR(64)` | nullable | Sanitized failure code; null on ordinary bounded completion. |
| `execution_token` | ASCII binary `CHAR(36)` | nullable | Private owner generation; migration 010. Every worker publication and heartbeat is fenced by this value and the lease. |
| `resume_count` | `INT UNSIGNED` | no / `0` | Number of actual ownership resumptions; simultaneous attachments do not increment it. |
| `cancel_requested` | `TINYINT(1)` | no / `0` | Publication guard set during cancellation. |
| `lease_expires_at` | `DATETIME(3)` | nullable | Database-clock recovery lease, initially/renewed 120 seconds ahead. |
| `created_at` | `DATETIME(3)` | no / current timestamp | Creation time. |
| `updated_at` | `DATETIME(3)` | no / current timestamp, auto-update | Last run change or lease renewal. |

Index `(focal_key, created_at)` supports parameter/run lookup. `request_key`
is unique when present; multiple NULL keys permit explicitly separate runs.
Database timestamp interpretation follows the configured MySQL session timezone;
leases compare exclusively against that same session's `NOW(3)`.

`settings` has exactly the nine numeric properties `max_period`, `grid_size`,
`half_span`, `precision_digits`, `newton_iterations`, `iteration_limit`,
`max_angle_period`, `max_families`, and `max_orbitals`. Defaults/ranges are in
the protocol table and validated before database access. `progress` has optional
integer counters `attempts`, `orbital_count`, `ratios`, current `period` and
`angle_period`; `ray_outcomes` maps SDK outcome strings to integer counts.
Terminal progress adds Boolean `search_complete` (configured search only) and
`all_orbitals_discovered` (always false). Initial queued progress may be `{}`.

## `orbital_progressions` table

Data-service-owned, InnoDB, introduced by migration 007. No uniqueness constraint
on focal parameter or period: distinct cycles of the same period must coexist.

| Field | MySQL type | Null/default | Meaning |
| --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | no / auto-increment primary key | Stable orbital identity; API serializes as a string. |
| `free_bailiwick_id` | `BIGINT UNSIGNED` | nullable / `NULL` | Indexed primary source table entry, added by migration 008. Set on insert or the first rediscovery of an older unlinked orbital. |
| `focal_key` | ASCII binary `CHAR(64)` | required | Exact normalized focal lookup digest. |
| `focal_re`, `focal_im` | ASCII `VARCHAR(768)` | required | Canonical decimal focal parameter. |
| `period` | `INT UNSIGNED` | required | Cycle length accepted by the shared Seed Surveys scan, up to 4096; no period-4 filter. |
| `precision_digits` | `INT UNSIGNED` | required | Accepted Newton arithmetic precision, 64–256. |
| `closure_error` | ASCII `VARCHAR(768)` | required | Maximum transition residual as a decimal string, 32 significant digits. |
| `closure_tolerance` | ASCII `VARCHAR(768)` | required | `1e-7` for the shared survey, independently checked on all transitions; legacy strict callers use `1e-24`. |
| `identity_tolerance` | ASCII `VARCHAR(768)` | required | `1e-7` for shared survey cycles; legacy strict callers use `1e-20`. |
| `calculation_version` | `VARCHAR(64)` | required | `orbital-discovery-v2` for new calculations; historical versions retained. |
| `ray_status` | `VARCHAR(32)` | no / `pending` | Separate SDK ray outcome; never inferred from an empty child table. |
| `ray_metadata` | `JSON` | nullable | Compact ray calculation evidence described below. |
| `discovery_metadata` | `JSON` | nullable | Latest scan confirmation and provenance; added by migration 009. |
| `created_at` | `DATETIME(3)` | no / current timestamp | Initial acceptance. |
| `updated_at` | `DATETIME(3)` | no / current timestamp, auto-update | Last attached ray result. |

Index `(focal_key, period)` narrows full ordered-cycle comparisons. An advisory
lock on the focal digest serializes comparison and insertion. Coordinates and
point ordering are retained on rediscovery rather than silently replaced.
Migration `008_orbital-bailiwick-source.sql` adds nullable `free_bailiwick_id`
and index `idx_orbital_bailiwick` without recalculating or bulk-updating existing
orbitals. Saves populate a missing source ID and retain an existing primary
reference; additional source associations remain in discovery-run provenance.
No source FK is enforced, so retiring a bailiwick does not destroy calculation
history. Reads serialize this field as a string or null. `free_bailiwicks`
contains the freeform, inline, and nodal entries accepted by this interface.

`ray_metadata` is null before calculation. Otherwise its object contains `status`
(SDK outcome string), `multiplier` (null or `{modulus,log_modulus,phase}`, numbers
or null for nonfinite values), `connectedness` (null or `{status,method}`),
`precision_digits` (integer or null), `geometry_arithmetic`
(`native_with_sdk_terminal_precision_check`), `ray_options` (shared accuracy settings), and `search` (null or object).
Search contains `strategy: doubling_families`, integer `evaluations`, `candidates`,
`rejected`, `max_angle_period`, `max_families`, and Boolean `budget_reached`,
`exhausted`, `complete` (the SDK currently reports false). Complete validated
families are retained even if a later attempt finds no supported rays.

## `orbital_progression_points` table

Data-service-owned, InnoDB, introduced by migration 007.

| Field | MySQL type | Null/default | Meaning |
| --- | --- | --- | --- |
| `orbital_id` | `BIGINT UNSIGNED` | required | FK to `orbital_progressions.id`. |
| `point_index` | `INT UNSIGNED` | required | Zero-based forward dynamical order. |
| `point_re`, `point_im` | ASCII `VARCHAR(768)` | required | Decimal coordinates, preserved without Number conversion. |

Composite primary key `(orbital_id, point_index)`. Application validation requires
exactly `period` contiguous indices, one traversal without a closing duplicate,
and full closure including the last-to-first transition. No automatic cascading
deletion is configured. Header, points, and discovery membership commit together.

## `orbital_landing_ratios` table

Data-service-owned, InnoDB, introduced by migration 007. Only exact rational
angles belonging to whole validated doubling families enter this table.

| Field | MySQL type | Null/default | Meaning |
| --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | no / auto-increment primary key | Ratio row identity. |
| `orbital_id` | `BIGINT UNSIGNED` | required | Owning progression. |
| `point_index` | `INT UNSIGNED` | required | Landing point within that stored progression. |
| `numerator`, `denominator` | ASCII binary `VARCHAR(40)` | required | Reduced nonnegative/positive integer strings; angle normalized modulo one. |
| `family_key` | ASCII binary `VARCHAR(96)` | required | Lexicographically smallest reduced `numerator/denominator` in the doubling cycle. |
| `angle_period` | `INT UNSIGNED` | required | Exact angle-cycle length, separate from spatial period. |
| `landing_error` | `DOUBLE` | required | Nonnegative SDK endpoint error, at most `1e-6`. |
| `validation_status` | `VARCHAR(32)` | required | `validated`. |
| `calculation_version` | `VARCHAR(64)` | required | `orbital-discovery-v2` for new calculations; historical versions retained. |

Unique `(orbital_id,numerator,denominator)`; index `(orbital_id,point_index)`;
composite FK to `orbital_progression_points`. Ratios reference the original
stored point ordering after SDK assessment alignment. A family must have every
doubled angle and move to the next point modulo the spatial period. Saves commit
all returned complete families atomically and retain the smaller landing error
on exact-ratio rediscovery. There is no renderer geometry or cascade deletion.

## `orbital_discovery_results` table

Data-service-owned, InnoDB, introduced by migration 007.

| Field | MySQL type | Null/default | Meaning |
| --- | --- | --- | --- |
| `run_id` | ASCII binary `CHAR(36)` | required | FK to `orbital_discovery_runs.id`. |
| `orbital_id` | `BIGINT UNSIGNED` | required | FK to `orbital_progressions.id`. |
| `disposition` | `VARCHAR(16)` | required | `created` or `reused`. |
| `discovery_method` | `VARCHAR(32)` | required | First accepted method in this run: `seed_survey_scan` for current runs; historical methods retained. |

| `discovery_metadata` | `JSON` | nullable | Immutable per-run scan ranking/confirmation evidence; added by migration 009. |

Metadata fields: `algorithm` (`seed-survey-scan-v1`), zero-based `rank`, finite
`confidence`, positive `discovery_count`, `seed` (`x`,`y` numbers), `magnitude`,
`newton_cycles`, `scan_closure_error`, `grid_size`, `half_span`, `sampling`,
`iteration_limit`, `newton_iterations`, `precision_digits`, and `run_id`.
Old records normalize to null. Latest-survey reads use run metadata, so a later
rediscovery cannot change an older run's rank or confirmation evidence.

Composite primary key `(run_id,orbital_id)` preserves many-to-many provenance
across repeated discoveries. No personal/user fields are stored. Verification
is the opt-in disposable-MySQL command documented in `ORBITAL_DATA.md`.

## `orbital_discovery_checkpoints` table

Introduced by migration 010, InnoDB. No historical checkpoint rows are created.

| Field | Type | Null/default | Meaning |
| --- | --- | --- | --- |
| run_id | ASCII binary CHAR(36) | required, primary key/FK | Owning orbital_discovery_runs row. |
| format_version | INT UNSIGNED | required | Checkpoint format, currently 1. |
| phase | VARCHAR(32) | required | survey, scan, persisting, rays, or done. |
| payload | MEDIUMBLOB | required | Bounded gzip JSON, below 16 MiB compressed and 64 MiB inflated. |
| updated_at | DATETIME(3) | current timestamp, auto-update | Last committed durable unit. |

The payload stores version, profile signature, input_hash (run request_hash),
phase, logical progress, survey rows, complete scan groups and tested pixels,
final ranked candidates, persisted orbital records/indices, current ray-family
cursor and assessment, completed families, and a completed ray result pending
publication. Raw survey/scan state is released after final ranking. Completed
orbitals and ray results are retained until finalization. Codec failures and
version/input mismatches fail closed; older run rows normalize to no checkpoint
and resumable=false. Format does not contain executable code or renderer geometry.

The run row is locked when claiming or committing a checkpoint. Execution tokens
fence progress, heartbeats, orbital saves and ray saves as well as checkpoints.
A new generation resets cancel_requested and error_code while restoring durable
progress, preserving the same UUID and immutable parameter/settings snapshots.
No new source/focal point is created by resumption.

## Version history

| Version | Document | Change | Migration notes |
| --- | --- | --- | --- |
| 010 | Orbital checkpoint format 1 | Durable resumable discovery and fenced execution. | Additive columns/table; no backfill. |

## Schema maintenance

When adding or changing a field, update this document with its type, units,
default, valid range, and version. Add a fixture for the prior shape and a
test proving that older records normalize to the current in-memory shape.
