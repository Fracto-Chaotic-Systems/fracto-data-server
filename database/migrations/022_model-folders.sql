CREATE TABLE model_folders (
 model_category VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 folder_path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (model_category, folder_path)
);
