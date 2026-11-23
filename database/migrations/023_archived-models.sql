ALTER TABLE environment_assets ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0, ADD KEY environment_assets_active_category (archived, model_category, asset_id);
