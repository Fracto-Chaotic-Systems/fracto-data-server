# Authored component snapshots

`grass-strip.component.json` is a validated export of saved component revision 8
for milestone/component-construction-v1: randomized grass on a 1 × 20 m dry_dirt
floor, 20 ladybugs in interior openings and authored animation/movement settings.
It pins registered material revisions in the coordinated asset-service tag.

This is a source-controlled construction example, not an automatic seed or a
database migration. The live component remains owned by the component API/MySQL.
To restore it, read the destination document's current revision and use the
documented revision-checked PUT /component-documents/:id with this document and
that expected revision (0 only when creating a missing document). Review before
replacing a newer version. Restoring the service tags alone does not overwrite
application data. No credentials, browser history or model files are embedded.
