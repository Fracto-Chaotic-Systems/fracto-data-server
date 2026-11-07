# Data service tests

`orbital_data.test.js` exercises the real SDK worker tasks, distinct same-period
cycle identity, complete landing families, request bounds, private writes,
sanitized HTTP failures, and durable job failure reporting. The isolated
`orbital_data_fixture_server.js` runs only when forked by the opt-in root
`scripts/verify_orbital_discovery.js` command. That command tests one real source
core point using disposable MySQL storage and actual HTTP/service restarts;
normal test runs never open the application database. See `../ORBITAL_DATA.md`.
It also checks the selected-ID-only browser action, rejection of custom browser
settings/untrusted origins, and source reads for freeform, inline, and nodal rows.

`controlled_corrections.test.js` covers the separate registered-snapshot owner:
independent proposal validation, explicit approvals, atomic apply/audit, retries,
conflicts, revocation, rollback revisions and source-file/CLI isolation. All
datasets are disposable; no live application records or MySQL configuration are used.

Node test suites cover handlers, validation and numerical helpers. Run `npm test`
from this service directory. `wordnet_mappings.test.js` checks ordered retrieval,
explicit response fields, connection cleanup and sanitized database failures.

Mapping handler tests verify world_name is included in the explicit response
projection.

`node --test tests/data_requests.test.js` covers validation, parameterized writes,
optimistic conflicts, reads/no-ops, rollback, response allowlists, private access
and adding a table with numeric, boolean and JSON fields.

world_notes.test.js checks the narrow browser-note adapter, mandatory expected
values, rejection of extra fields, and the configured UI-origin check.
