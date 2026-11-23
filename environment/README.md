# Environment asset database registry

The data service alone owns SQL and the `environment_assets` table. `database.js`
uses the data service's own ignored `config/mysql.json` plus `FRACTO_MYSQL_*` overrides
and lazy, bounded connections. Explicit provenance columns, source descriptors
and checksums, modification history and catalog revision are upserted using
bound values. Identical registrations preserve creation/update timestamps.
The database does not store model binaries or open the asset library.
All shared modules are consumed through the `@fracto/sdk` npm interface.
The exact inter-service request/response contract is in [CONTRACT.md](CONTRACT.md).

`routes.js` mounts `PUT /internal/environment-assets/:id`, authenticates before
its bounded JSON parser, validates the SDK allowlist, checks the path ID and
returns only `{id, revision}`. Arbitrary extensions, malformed records and unsafe
URLs are rejected. SQL/connection failures return a generic 503; no provenance
or credentials are logged. A configured internal token is always enforced. Only
when authentication is explicitly disabled and no token exists may loopback
service traffic register records; remote unauthenticated traffic is rejected.

Migration 019 lives in `../database/migrations/`, preserving its original bytes,
filename and checksum. The root generic migration runner discovers service-owned
migrations; applied history is verified rather than replayed. Run `npm run
db:migrate` from the root, then the asset service's `npm run environment:register`.

All three model lists query this same table. Migration 020 adds indexed
`model_category` values material/component/area, independent of descriptive
`category` values such as vegetation/grass. Existing rows default to material.
The private GET endpoint uses bound category/cursor filters and bounded pages.


Migration 021 adds folder_path to the same environment_assets table. It is logical
organization within each model category, not a filesystem path. Listings include
the path so clients can construct category-scoped trees. All folder validation is
shared through the SDK; SQL remains here. Legacy registrations that omit this
field preserve an existing folder on upsert; explicit empty strings clear it.

## Persistent logical folders

The data service owns model_folders (migration 022), keyed by model_category and
folder_path. Empty folders are independent of asset rows and survive moves and
reloads. Asset folder assignments remain in environment_assets and asset.json;
these logical paths never relocate model resources.

Contract v1: authenticated internal GET /internal/environment-assets/folders
requires category=material|component|area and returns {folders: [path, ...]}, up
to 1,000 entries, including folders referenced by existing assets. POST to the
same endpoint accepts only {category, folder_path}, with a nonempty SDK-normalized
path (eight levels, 64 characters per level, 512 overall), and returns
{folder_path}. Creation is idempotent; retries do not duplicate records. Invalid
input is 400, unavailable persistence is 503; normal internal authentication
applies before parsing. The asset service exposes matching GET/POST
/environment-catalog/folders endpoints under its existing user/origin policy,
and forwards via the registry client with a 15-second timeout. UI same-origin
/api/environment-catalog/folders is a thin proxy. Folder names are case-sensitive.
Move uses the existing revision-checked asset PATCH contract, preserving
attribution and appending move-folder history. Conflicts return 409 and leave
the editor's selection intact for review.

Folder definition rename/delete transactions live in folders.js; database.js
provides the service-owned pool. See CONTRACT.md for management actions and the
archived model projection introduced by migration 023.
