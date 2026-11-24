# Component document persistence

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
`facing-patrol-v1`, a positive bounded speed and distance. Motion is authored
content carried through save/load and hashes; rendered poses never overwrite
base transforms in SQL. Existing JSON storage requires no migration.

`database.js` owns parameterized SQL for installation-shared authored documents.
It uses the data service's bounded pool configuration; it never opens model
resources. `routes.js` owns validation and HTTP policy. The SDK owns the pure
document contract; no UI or other service implementation is imported.

Apply additive migration `024_component-documents.sql` with the root migration
runner before deploying. Saving documents does not register/publish runtime
component assets. The table stores no account IDs, profile data or transcripts.

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

- GET `/`: `{documents:[{id,name,revision}],next_cursor:null|id}`. At most 50
  entries, ordered by ID. Optional `?after=<id>` pages forward. No other query keys.
- GET `/:id`: `{document,revision}`. IDs are lowercase UUID v4.
- PUT `/:id`: exact body `{document,expected_revision}`; document id must match
  the path. Revision 0 inserts only; positive revisions atomically update only
  that revision. Response `{document,revision:expected_revision+1}`.

The SDK validator rejects unsupported schema versions, unknown fields, duplicate
element IDs, dangling groups, nonfinite/out-of-bound transforms and excessive
counts. Documents are limited to 1,000 total authored/scattered instances, 100
groups, 100 scatter rules and 32 exclusion rectangles per rule. It validates
reference shapes, not live asset existence; catalog tools will add that check.

400 invalid_component_document; 404 component_not_found; 409 component_conflict;
413 oversized request; 503 component_unavailable. Authorization may return
401/403/503. Error responses never contain submitted content, SQL or credentials.
No automatic write retry: if a response is lost, reload to resolve whether the
save committed. Repeating a create or a stale update returns conflict, never
overwrites. Save responses contain the submitted snapshot and its committed
revision, independent of later writers. Undo history is UI-local, not a database
rollback or durable audit log. There is no document delete endpoint yet.
