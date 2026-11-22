# Application database migrations

`019_environment-assets.sql` defines the asset registry's identity, attribution,
model references, source checksums and history. It was moved unchanged from the
root migration directory; existing history/checksums remain valid. Apply through
the root `npm run db:migrate`. No schema reset, reapplication or data rewrite is
needed for the ownership change. New application migrations belong here.
