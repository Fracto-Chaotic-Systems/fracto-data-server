# Historical SQL fixtures

Byte-preserving snapshots of historical migrations used by isolated compatibility
tests and disposable-schema verification commands. These are not additional
migration-runner inputs. Production synchronization byte proofs live under
`database/schema/history/`; new application migrations belong in
`database/migrations/`.
