# Data-service schema

Application schema migrations live in `migrations/`. The root infrastructure
runner merges them with immutable legacy root migrations in global filename
order, verifies recorded checksums and applies only pending changes.
Do not create a duplicate numeric version or edit an applied migration.
