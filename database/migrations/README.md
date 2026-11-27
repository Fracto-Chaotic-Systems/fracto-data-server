# Application database migrations

`024_component-documents.sql` adds authored component documents and their save
revisions. It is independent of published assets and preserves existing rows.

`025_component-document-folders.sql` adds each component document's logical
`folder_path` (default empty: category root) and an index. Existing documents and
revisions are unchanged. Apply before deploying component document folders.

`019_environment-assets.sql` defines the asset registry's identity, attribution,
model references, source checksums and history. It was moved unchanged from the
root migration directory; existing history/checksums remain valid. Apply through
the root `npm run db:migrate`. No schema reset, reapplication or data rewrite is
needed for the ownership change. New application migrations belong here.

`020_model-categories.sql` adds `environment_assets.model_category` and a
category/asset-ID index. Existing rows default to material. It preserves the
subject category, attribution, identities and histories. Apply with `db:migrate`
before deploying category-aware services.


021_model-folder-paths.sql adds logical folder_path (default empty/category root)
and a category/path index. Existing identities, attribution and file paths are
unchanged. Apply this additive migration before deploying folder-aware services.

022_model-folders.sql stores category-scoped logical folder definitions independently
of assets, preserving empty folders. Apply before deploying folder creation.

023_archived-models.sql adds an archived flag and active-category index. Deleted
models retain their identity, provenance and history but leave active listings.
Apply before deploying model tree deletion; cold boot now applies pending files.
