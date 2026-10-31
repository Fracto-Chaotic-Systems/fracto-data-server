# Registered data requests

POST `/data/request` performs single-record data operations without a migration.
Schema changes and reproducible initial snapshots still use numbered migrations.
No raw SQL or user-defined WHERE clause is accepted. Initially wordnet_mappings
is registered, keyed by positive integer cardinality. Writable fields are
world_name (nonempty single-line string up to 255 characters) and notes (UTF-8
text up to 65,535 bytes). Other mapping fields remain read-only.

## Request contract

```json
{
  "operation": "update",
  "table": "wordnet_mappings",
  "key": {"cardinality": 37},
  "values": {"world_name": "xyz"},
  "expected": {"world_name": "world 37"}
}
```

Expected is optional. When supplied, its fields must still match or the request
returns 409 without writing. Only supplied values change. Updates lock one row
in a transaction, read it back and return `{result: record, changed: true}`.
Repeating the same value succeeds with changed false when expected is omitted
or still matches; a stale expected value always returns 409. Responses project only
registered fields; errors never echo SQL, credentials, input or database details.
No inserts, deletes, bulk updates or schema operations are exposed. Status codes:
400 invalid request, 404 missing row, 409 stale expectation/duplicate-key conflict,
503 unavailable storage.

Read one record using the same POST endpoint:

```json
{"operation":"get","table":"wordnet_mappings","key":{"cardinality":37}}
```

Get accepts neither values nor expected and returns `{result: record}`. Name edits
appear in the worlds page and CSV after reloading its data. Notes now come exclusively from the database; no browser override masks edits.
The UI saves notes through a narrower trusted-origin PUT /wordnet_mappings/:cardinality/notes
adapter using the same transactional core. General /data/request access stays private.

## Curl in the current development setup

The auth-disabled local setup permits a direct loopback CLI request inside the
container. Origin headers, remote callers and spoofed forwarded addresses do not
qualify. This example does not mean xyz has been applied:

```powershell
$body = '{"operation":"update","table":"wordnet_mappings","key":{"cardinality":37},"values":{"world_name":"xyz"},"expected":{"world_name":"world 37"}}'
$body | docker compose -f compose.yaml -f compose.dev.yaml exec -T fracto-dev curl --fail-with-body --silent --show-error --json '@-' http://127.0.0.1:3102/data/request
```

For a native service, use its local port (normally 3002) and a body file:
`curl.exe --fail-with-body --json '@request.json' http://127.0.0.1:3002/data/request`.
If authentication is required or FRACTO_INTERNAL_SERVICE_TOKEN is configured,
every request needs the existing X-Fracto-Service-Token credential instead.
Both Compose targets forward an explicit token to private services; the UI never
receives it. Do not store credentials in source-controlled request files.

## Responsibilities and extension

- registry.js: table names, complete keys, read projections and writable validators.
- contract.js: strict envelopes and field/type checks before opening a connection.
- handler.js: bound SQL, row locks, transactions, expected checks and safe errors.
- authorization.js: private service authentication and the local CLI fallback.

Add another non-personal application table by registering its SQL table, complete
keys, readable field list and writable descriptors. A descriptor has validate(value)
and optional encode(value)/decode(value). Booleans can encode to 0/1 and decode with
Boolean; JSON can encode with JSON.stringify and decode stored strings. Decoders
also apply to responses and expected-value comparisons. Identifiers come only from
the registry and are checked separately. Tests demonstrate numeric, boolean and
JSON fields on another table. New operation types need an explicit contract branch
and handler implementation; do not introduce arbitrary SQL. Connections and registry
are injectable for tests without loading production configuration.

Legacy /query can return full users records via SELECT *. That conflicts with the
project policy against personal data in APIs. Do not copy it into this registry;
remediation should remove identity-table queries and replace broad projections with
non-personal field allowlists. This editor does not register users or login data.

Verification exercised curl get/update/conflict/no-op requests against a temporary
MySQL copy of world 37; its actual name and notes remained unchanged.
