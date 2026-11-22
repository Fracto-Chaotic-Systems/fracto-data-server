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
