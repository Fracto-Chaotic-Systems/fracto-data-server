# Owned schema helpers

`018_tile-seed-checkpoints.sql` initializes the operational checkpoint table for
the standalone tile loader. Its bytes match the immutable historical migration.
`history/` contains byte proofs for synchronization compatibility. These files
are not additional inputs to the migration runner; new migrations go in
`database/migrations/`.
