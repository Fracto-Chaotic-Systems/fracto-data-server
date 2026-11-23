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


## Logical folders (additive version 1)

Migration 021 adds folder_path VARCHAR(512), default empty/category root. GET
summary rows include folder_path. PUT records and public catalog PATCH edits may
include it. The shared SDK normalizes whitespace around slash-separated names
and rejects empty internal segments, dot/dot-dot names, colons, backslashes,
controls and bounds above eight levels / 64 characters per name / 512 total.
The path is logical metadata only and must never be used to open/move files.

Omitted PUT folder_path defaults to root on insert and preserves existing folder
values on upsert; explicit empty clears it. Omitted PATCH folder_path preserves
the catalog value. PATCH retains expected-revision conflict behavior (409),
atomic file publication and retryable database reconciliation; folder moves add
history. Invalid public PATCH paths return 400 invalid_folder; invalid internal
registrations return 400 invalid_record. Folder definitions are standalone rows in model_folders (migration 022), preserving
empty groups independently of asset assignments.

## Folder definitions (additive version 1)

GET /internal/environment-assets/folders requires a category query value and
returns 200 {folders:[path,...]} (maximum 1,000), including paths currently
referenced by assets. POST to the same route accepts only {category,folder_path}
and returns 200 {folder_path}. Categories are material/component/area; a path
uses the SDK bounds above and must be nonempty. Definitions use case-sensitive
category/path keys. POST is idempotent and safe to retry. SQL never uses a path
as an identifier or filesystem location. Invalid requests return 400
invalid_record or invalid_folder, auth failures 403, oversized bodies 413, and
persistence failures 503 catalog_unavailable. Existing internal authentication,
no-store headers and 15-second client timeout apply. Folder creation does not
modify an asset. Public asset-service /environment-catalog/folders GET/POST
forwards this contract under the existing user/trusted-origin policy. Folder
movement continues through revision-checked asset PATCH, with history and
portable catalog persistence; it does not move resource files.
