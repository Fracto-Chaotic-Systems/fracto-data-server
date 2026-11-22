-- Construction categories are independent of descriptive categories such as vegetation/grass.
-- Existing registered assets are materials. Original attribution and subject categories are preserved.
ALTER TABLE environment_assets
  ADD COLUMN model_category VARCHAR(16) NOT NULL DEFAULT 'material' AFTER category,
  ADD KEY environment_assets_model_category_id (model_category, asset_id);
