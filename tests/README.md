# Data service tests

`startup_configuration.test.js` runs the declared service configuration check
in disposable checkouts with no SDK or database. It reproduces the lab failure
where the root MySQL config exists but the service-owned file is missing, checks
invalid JSON/object handling and verifies provisioned configuration passes without
printing credentials. Run `npm run test:startup`; Docker production builds also run it.

`npm run test:environment` covers the asset registry's explicit database fields,
parameter binding and private API boundary. Set
`FRACTO_TEST_ENVIRONMENT_ASSET_DATABASE=1` to include actual MySQL upserts using a
connection-local temporary table copied from migration 019's schema. No real
asset rows are changed.

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

## Dependency boundaries

Tests import only their owner’s implementation and the `@fracto/sdk` npm exports.
Cross-service integration launches isolated owner fixture executables and uses
HTTP contracts; it never imports another service. See the SDK testing README
for fixture authentication, lifecycle and bounded control requests.

## Survey and numerical contracts

`handle_orbitals.test.js` checks 12-decimal seed serialization, top-to-bottom
imaginary coordinates, row-based progress with lossless candidate deltas,
explicit grid/canvas/sampling/encoding worker inputs and candidate provenance.
Cancellation fixtures use unique focal points and close their pending tasks so
retained process-local jobs cannot leak between cases.
`seed_survey_half_span.test.js` verifies the common pattern/iteration canvas
buffer in every parameter domain. `orbital_data.test.js` checks the current
524287 catalog denominator bound and explicit retry of unresolved families.

`orbital_pipeline_stages.test.js` distinguishes a supplied Newton candidate
from a closure-confirmed result: a one-step failure retains candidate diagnostics
but returns no accepted points. Experimental stagnation remains separate from
the established solver’s closure status. `worker_task_pool.test.js` checks
adaptive horizon expansion and exact short horizons when adaptation is disabled,
while preserving asynchronous execution, cancellation and backpressure checks.

Folder registry tests cover authenticated folder endpoints and category isolation.
The opt-in MySQL test creates only connection-local temporary folder/asset tables.

Temporary MySQL tables also verify archive filtering and legacy preservation,
folder definition transactions, target conflicts and nonempty deletion refusal.
