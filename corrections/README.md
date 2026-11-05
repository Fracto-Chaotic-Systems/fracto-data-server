# Controlled corrections for registered local snapshots

This module belongs to the data service. It owns **explicitly registered local
environment/asset snapshot datasets**, not existing live MySQL world/asset tables.
There is currently no mapping between the step-4 interchange format and those
tables. Registration copies a reviewed snapshot into this private store; it never
replaces application data or changes the original file. No live SQL, HTTP write
endpoint, arbitrary table registration or automatic production import is added.

`contract.js` independently validates snapshots/proposals and recomputes hashes
and allowed deduplication; it does not import or trust AI execution code.
`storage.js` owns canonical snapshots, plans, approvals, transactions, audit and
rollback. `cli.js` is the local maintenance interface; `secure_directory.ps1`
restricts Windows ACLs without elevation/ownership changes. Its short filesystem
helper intentionally remains data-service-owned rather than importing AI code.

## Local workflow

The only writable operation is deduplication of a set-valued environment dependency
list, preserving first-occurrence order. It cannot delete assets/environments,
replace missing references or merge content. Snapshot fields match the AI
`data_quality/README.md` contract and must contain approved non-personal game data.

From the data-service repository, using Node >=22.19:

```powershell
node corrections/cli.js import lab-world approved-snapshot.json
node corrections/cli.js export lab-world
node corrections/cli.js preview lab-world approved-correction-request.json
node corrections/cli.js plan <plan-digest>
node corrections/cli.js approve <plan-digest> <reviewed-before-snapshot-digest>
node corrections/cli.js apply <plan-digest>
node corrections/cli.js audit lab-world
node corrections/cli.js approve-rollback <plan-digest> <reviewed-after-snapshot-digest>
node corrections/cli.js rollback <plan-digest>
```

These are individual command examples; review the preview before approving its
exact plan and snapshot digest. Approval is an explicit local administrative
operation under the service OS identity, not a secret bearer token or proof that
a person read the output. The AI skill cannot approve/apply: its only permission
remains `snapshot:read`. Automated administrative callers need their own explicit
authorization to use these commands. No approval is inferred from model output,
registry activation, a browser session, auth bypass or peer trust.

To generate a request, scan the exported, current snapshot with the AI skill and
use `data_quality/cli.js request FILE PROPOSAL_DIGEST`. It emits only the selected
proposal plus snapshot/revision and skill provenance. Provenance is a local claim,
not independent attestation or write authority. The owner checks shape, proposal
digest, whole-snapshot digest, dataset revision, unique target, exact original
references, environment revision, unique/present referenced assets and exact
deduplication before preparing and again before applying.

Prepared plans are immutable and content-addressed by dataset ID plus request.
Only a specifically approved plan may apply. An approval for stale state fails;
an edit after approval also fails at application. Apply changes one environment,
increments its revision and the dataset revision, and commits state and audit
together. Retrying an applied plan returns its receipt without another change.
Applied or rolled-back plans cannot silently become new applications.

Rollback has a separate approval. It requires the entire dataset to still match
the recorded post-application digest, restores the exact original dependency list,
and **increments** both revisions again. It never restores old revision numbers
or overwrites an intervening edit. Revision headroom is reserved before application
so an immediate rollback remains representable. `revoke PLAN` withdraws a pending
apply/rollback approval and records an event; it does not undo an applied change.
Conflicts require a fresh export, scan and review, never force/reset/fallback.

## Storage, deployment and recovery

Native default: ignored `runtime/corrections` under this service.
`FRACTO_DATA_CORRECTION_DIR` selects a dedicated local directory. Containers refuse
source-directory fallback; Compose sets `/var/lib/fracto/data-corrections` with
separate production/development named volumes. Build/start workflows provision
the mount permissions, not datasets or approvals. Standard operations remain
independent: there is no startup scan/application or new service port/dependency.

For development, run from the root using this prefix instead of native `node`:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml exec -T fracto-dev node servers/fracto-data-server/corrections/cli.js export lab-world
```

Files must already be visible in that container. CLI errors expose fixed codes,
not input, paths, credentials or database error text. Exports/audit stay local and
must not be copied into public APIs/logs. Retain protected local exports separately
when needed; no file is published automatically.

SQLite schema 1 uses DELETE rollback journaling, FULL synchronization, a 2-second
busy timeout, private Windows ACLs/POSIX 0700/0600, and a 128 MiB default-page-size
cap. Writes require 1 GiB free disk. Limits are 16 datasets, 1000 plans and 10000
audit events; capacity exhaustion rejects changes rather than pruning audit.
Snapshots are at most 8 MiB; requests at most 16 KiB. Unknown schemas, symlinks,
corrupt snapshots/requests, stale preconditions and transaction failures fail
closed. Read commands open read-only without initialization or ACL changes.

Stop all correction CLI writers before copying this whole directory for backup;
preserve private permissions and check exports/plans/audit after restore. Restore
does not authorize replay against another installation or repair live application
tables. Disk/filesystem power-loss guarantees remain subject to SQLite/platform
behavior. Direct database edits are outside this protocol and invalidate its
audit guarantees. Tests use disposable stores and never import/apply live records.
