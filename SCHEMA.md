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

## Version history

| Version | Document | Change | Migration notes |
| --- | --- | --- | --- |
| - | - | No persisted schema version has been established yet. | - |

## Schema maintenance

When adding or changing a field, update this document with its type, units,
default, valid range, and version. Add a fixture for the prior shape and a
test proving that older records normalize to the current in-memory shape.
