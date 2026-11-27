-- Authored component documents join the category-scoped logical folder tree
-- (model_folders, category 'component'). The empty path is the category root.
ALTER TABLE component_documents
  ADD COLUMN folder_path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '' AFTER name,
  ADD KEY component_documents_folder_path (folder_path(191));
