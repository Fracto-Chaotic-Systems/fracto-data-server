# Database synchronization endpoints

The data service owns database synchronization. Admin exposes the existing
browser and peer URLs as streaming proxies; no SQL or database sessions live in
admin. The user-facing protocol, conflict policy, snapshot budgets, versioning,
TTL, cancellation and recovery are documented in the admin service's
`DATABASE_SYNC.md` and remain unchanged.

Both internal route families require `X-Fracto-Service-Token`, checked before
body parsing. Missing or incorrect tokens return 403. They are never exposed
through the generic query API.

| Internal prefix | Routes and request contract |
| --- | --- |
| `/internal/database-sync` | GET `/peers`; POST `/jobs` with `{server_url}`; GET `/jobs/:id`; POST `/jobs/:id/apply` with optional `{preferred}`. Browser authorization occurs in admin before forwarding. JSON requests are limited to 16 KiB. |
| `/internal/database-sync-peer` | POST `/sessions` returns `{id,snapshot}`. POST `/sessions/:id/:action` accepts `prepare` with `{expected,snapshot}`, or `commit`, `verify`, `close`; responses are `{prepared}`, `{digest}`, `{digest}` and `{closed}` respectively. `X-Fracto-Sync-Token` is checked before parsing. Session ownership checks remain mandatory. |

Responses preserve the existing sync JSON bodies and statuses: jobs return 202;
invalid requests return 400; unauthenticated peers return 403; missing sessions
return 404; stale/incompatible/conflicting operations return 409; snapshot limits
return 413. Snapshots retain the existing 512 MiB wire limit and 480 MiB data
budget. Preview/apply locks, five-minute session expiry and optimistic snapshot
hash checks remain with the data service. Proxy failure returns 503
`database_sync_unavailable`; admin uses a bounded 180-second transport timeout.
Clients must poll the returned job and resolve conflicts explicitly rather than
blindly retry an apply. Peer endpoints remain configured in the shared address
book; the internal data endpoint is not a public peer address.

`config/mysql.json` belongs to this service. Historical SQL byte proofs under
`database/schema/history/` support LF/CRLF compatibility without loading root
files. The SDK only hashes caller-provided bytes.
