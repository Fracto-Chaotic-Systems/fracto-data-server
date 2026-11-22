# Environment registry HTTP contract

Version 1 is defined by the npm SDK's `FractoEnvironmentCatalog.js` registration
projection and validator. The asset service is the caller; the data service owns
validation and SQL. Consumers must not import either service's implementation.

`PUT /internal/environment-assets/:id` accepts JSON `{record, revision}` with an
8 MiB body ceiling. `revision` is the canonical catalog file's 64-character
lowercase SHA-256. `id` must equal `record.id`, a permanent lowercase slug of at
most 64 characters. The explicit record fields are `schema_version: 1`, `id`,
`version`, `name`, `description`, `category`, `parent_id`, `attribution`, `sources`,
`runtime` and `history`. Attribution uses only `status` and `CATALOG_FIELDS` from
the SDK; source entries contain `path`, `format`, `sha256`; runtime contains `path`
and `format`; history contains `date`, `action`, `description`. Unknown fields and
unsafe URLs are rejected. The SDK specifies all per-field/collection bounds.

Production authenticates `X-Fracto-Service-Token` before parsing. The existing
explicitly unauthenticated lab mode permits direct loopback requests when no
token is configured. The caller has a 15-second timeout. Success is 200 with
`{id, revision}` only. Invalid input or mismatched IDs return 400
`{error: "invalid_record"}`; authorization failure is 403; oversized input is 413;
database failure is 503 `{error: "catalog_unavailable"}` without connection details.

Repeating the same registration is idempotent. The asset server remains the sole
catalog writer and owns expected-revision checks; stale browser edits return 409
from its API before a new file is published. The registry is a projection of the
current catalog, not an independent metadata editor. If synchronization fails
after file publication, the next metadata read/list retries registration. There
is no distributed transaction or automatic deletion of database rows.

## Category listing (additive version 1)

GET /internal/environment-assets uses the same internal authorization and no-store
policy as PUT. Optional query fields are category (material, component or area),
after (exclusive lowercase slug cursor, at most 64 characters), and limit (1–200,
default 200). Omitted category queries all model categories in the same table.
Unknown, repeated/structured or invalid parameters return 400 {error:"invalid_query"}.
Success is 200 {assets:[{id,name,category,model,format}],next_cursor:null|id}.
Rows are ordered by asset ID; next_cursor is the last returned ID when more exist.
Summaries include only bounded public model fields (SDK validator), with nullable
model/format. No attribution, checksums, SQL or private configuration are returned.
Database/invalid-result failures return 503 {error:"catalog_unavailable"}. GET is
read-only and retryable; keyset pages are not a transaction-wide snapshot.

PUT adds optional record.model_category, validated against the same three values;
legacy requests default to material. Descriptive record.category remains intact.
Migration 020 must be applied before category-aware service deployment. The asset
client follows pages with a 15-second timeout each, validates categories and cursor
progress, and fails the whole list on an invalid/unavailable page.
