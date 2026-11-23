-- Logical organization is independent of category and model file storage.
ALTER TABLE environment_assets
  ADD COLUMN folder_path VARCHAR(512) NOT NULL DEFAULT '' AFTER model_category,
  ADD KEY environment_assets_folder_path (model_category, folder_path(191));
