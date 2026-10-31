# Data service tests

Node test suites cover handlers, validation and numerical helpers. Run `npm test`
from this service directory. `wordnet_mappings.test.js` checks ordered retrieval,
explicit response fields, connection cleanup and sanitized database failures.

Mapping handler tests verify world_name is included in the explicit response
projection.
