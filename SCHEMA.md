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
server owns the MySQL connection and applies the schema through its common
table-ensure interface.

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
| `tasks` | `JSON` | no | none | Server-owned ordered task definition. Its shape is determined by `automation_type`. |

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

### `tasks` JSON contract

`tasks` is required JSON, but its internal shape is intentionally server
specific. Every task producer must store a version or capability marker in
the document before introducing a breaking shape change, and every consumer
must normalize missing optional properties to documented defaults. A minimal
Tiles record may therefore look like:

```json
{
  "version": 1,
  "tasks": []
}
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
