# Data service tests

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
