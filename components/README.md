# Component document persistence

`restore_blueprint.js` explicitly imports a checked-in accepted snapshot through
the component HTTP API for another installation. It verifies the companion's
canonical hash, creates only after a JSON `component_not_found` response with
`expected_revision:0`, checks exact save/reopen, and retains every existing record
without edits. HTML proxy errors, database failures and conflicts fail closed;
there is no write retry. It does not need database credentials. Example:

```powershell
node components/restore_blueprint.js --blueprint grass-strip --endpoint http://LAB-HOST:3000/api/data/component-documents
```

The destination receives its own revision 1, not the source installation's save
counter. Rebase authored variants explicitly before previewing them against that
new destination revision. Runtime background playback uses the base document.
This is an explicit restore, not an automatic startup seed or publishing system.

`ground_grass_strip.js` records the accepted revision-16 → 17 grounding edit.
It reads the live scene and description, verifies the pinned blueprint hash,
backs up the original scene, lowers only grass Y anchors, saves with an expected
revision, checks exact reopen, and updates blueprint/variant exports. It is a
guarded one-time editorial command, not a migration or startup seed; running it
against any revision other than 16 fails before writing.

Optional `lighting: {direction_degrees, intensity}` stores the component's viewer
defaults in its existing JSON document, atomically with geometry and construction
description. Direction must be 0–360° and intensity 0.25–6; new documents store
45° / 3. Legacy documents remain valid without the field. No schema migration is
required. The UI edits these values above the stage and includes them in history.

The current authoring workflow is collaborative construction with maintained
[construction descriptions](blueprints/README.md). Those describe material roles,
generation rules and physical/behavioral relationships independently of concrete
placements. The first complete description is [grass strip](blueprints/grass-strip/grass-strip.md),
paired with structured parameters and the existing realized example snapshot.
Readable descriptions now persist in the scene's optional `construction_description`
Markdown string (maximum 65,536 characters). Text and model share one saved
revision, conflict check and atomic write; no table migration is needed. Missing
fields remain omitted for legacy compatibility. A separate structured-blueprint
API is future work; the repository JSON companion is not accepted as a scene.

Representative construction save/load evaluation is covered by service tests:
eight complete fixture documents roundtrip through actual MySQL temporary tables,
preserve generated transforms and reject stale revisions.

The shared v1 document now also accepts plain floors (asset:null), optional
floor.texture_file and optional scatter.algorithm=footprint-xz-v1. Existing JSON
storage needs no migration. Deploy matching SDK/UI/data code together. Persistence
validates structure; live calibrated asset/resource checks belong to construction
operations and rendering, not SQL storage.

The optional v1 `animation_speed` property is persisted in the same component
JSON: finite 0–10, omitted meaning 1×, zero pausing clips. Legacy documents keep
their original fields and hashes; no backfill or table migration is needed.

Objects may also persist optional SDK-validated `motion` records using
`facing-patrol-v1` or `facing-wander-v1`, a positive bounded speed and distance. The
second algorithm follows deterministic varied-heading segments within a local
ellipse and is selected by the zoomies delta without changing its base scene.
Motion is authored
content carried through save/load and hashes; rendered poses never overwrite
base transforms in SQL. Existing JSON storage requires no migration.

`database.js` owns parameterized SQL for installation-shared authored documents.
It uses the data service's bounded pool configuration; it never opens model
resources. `routes.js` owns validation and HTTP policy. The SDK owns the pure
document contract; no UI or other service implementation is imported.

Apply additive migration `024_component-documents.sql` with the root migration
runner before deploying. Saving documents does not register/publish runtime
component assets. The table stores no account IDs, profile data or transcripts.

Apply `025_component-document-folders.sql` (additive; existing documents stay at
the root) before deploying document folders. Documents belong to the `component`
category's logical folder tree: folder definitions stay in `model_folders`, and
`environment/` folder listing, rename and delete include document folders
(rename moves contained documents in the same transaction; delete refuses a
folder that holds documents). Moving a document never changes its JSON or
revision.

## HTTP contract v1

The `/component-documents` router applies enabled-user authorization when
configured and requires the trusted UI Origin for all mutations, even in lab
mode. Authorization/origin checks precede the 1 MiB JSON parser. Responses use
Cache-Control: no-store. UI uses `/api/component-documents` through a thin
same-origin proxy in Vite and the production UI server. Browser service tokens
are not forwarded. Existing session authorization is reused, without adding
identity fields to the document contract; the existing authentication helper's
identity-bearing session lookup remains subject to the project's documented
personal-data remediation rule.

- GET `/`: `{documents:[{id,name,revision,folder_path}],next_cursor:null|id}`.
  `folder_path` is the document's logical folder (`""` is the category root). At most 50
  entries, ordered by ID. Optional `?after=<id>` pages forward. No other query keys.
- GET `/:id`: `{document,revision}`. IDs are lowercase UUID v4.
- PUT `/:id/folder` with `{folder_path}`: moves the document to an existing or new
  logical folder (normalized like model folders; `""` is the root) and records the
  folder definition. Returns `{id,folder_path}`; invalid paths return 400
  `invalid_folder`, unknown documents 404. Does not change the document revision.
- GET `/:id/history`: `{history:[{date,recorded_at,revision,action,description}]}`,
  newest first, at most 200. Like a material record's history: actions are
  `create-component`, `update-component` (the description summarizes added,
  removed and changed placed objects, scatter rules and groups, and floor,
  lighting, animation speed and construction document changes),
  `rename-component` (a save that only renames), `move-folder` (direct moves,
  and documents moved by a folder rename or move, recorded in that transaction)
  and `history-start` (added by migration 026 for existing documents).
  `components/history.js` builds the summaries; entries are recorded after a
  successful change, and a history failure never fails the save. A save's
  optional `notes` (the editor's labels for the edits since the last save, e.g.
  "placed 30 × yard-grass") lead the description; a rename with notes is an
  `update-component`.
- GET `/:id/variants`: `{variants:[{key,name,revision,base,role_groups,overrides}]}`. Lists authored
  variant deltas from this service's `blueprints/<key>/variants/<variant-key>/`
  folders by base component ID. Each override contains `{target:{role,property},
operation,value}`. No query parameters. At most 100 variants, 100 overrides per
  variant, 64 KiB per JSON file and 1,000 entries per scanned directory. Files
  must be regular files; symbolic-link directories are not followed. A component
  with no authored variants returns an empty list, including unsaved components.
  Names sort alphabetically. This read-only endpoint shares the router's
  authorization and no-store policy; malformed/unavailable files return 503.
  `base` includes the component ID and pinned scene revision; `role_groups` maps
  blueprint roles to authored group IDs. The SDK uses these to resolve supported
  stage previews. This endpoint does not resolve scenes or change the base.
- PUT `/:id`: body `{document,expected_revision,notes?}`; `notes` is at most 20
  non-empty strings of up to 200 characters without control characters; document id must match
  the path. Revision 0 inserts only; positive revisions atomically update only
  that revision. Response `{document,revision:expected_revision+1}`.

The SDK validator rejects unsupported schema versions, unknown fields, duplicate
element IDs, dangling groups, nonfinite/out-of-bound transforms and excessive
counts. Documents are limited to 1,000 total authored/scattered instances, 100
groups, 100 scatter rules and 32 exclusion rectangles per rule. It validates
reference shapes, not live asset existence; catalog tools will add that check.

Objects can optionally persist `animation_speed` (finite 0–10) to set an explicit
clip clock independent of the component multiplier. Omission inherits component
speed and remains omitted for legacy records. This is stored in the same JSON
record and optimistic revision; no migration is needed. Patrol translation still
uses the component clock. An explicit object clock also runs when component speed
is zero; hiding the stage pauses all rendering.

400 invalid_component_document; 404 component_not_found; 409 component_conflict;
413 oversized request; 503 component_unavailable. Authorization may return
401/403/503. Error responses never contain submitted content, SQL or credentials.
No automatic write retry: if a response is lost, reload to resolve whether the
save committed. Repeating a create or a stale update returns conflict, never
overwrites. Save responses contain the submitted snapshot and its committed
revision, independent of later writers. Undo history is UI-local, not a database
rollback or durable audit log. There is no document delete endpoint yet.
