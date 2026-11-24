CREATE TABLE IF NOT EXISTS component_documents (
    document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(120) NOT NULL,
    schema_version INT UNSIGNED NOT NULL,
    revision INT UNSIGNED NOT NULL,
    document_json JSON NOT NULL,
    PRIMARY KEY (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
