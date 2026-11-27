-- Change history for authored component documents, like a material record's
-- history: one entry per create, save, rename or folder move, with the
-- document revision it produced. Existing documents start with one entry.
CREATE TABLE IF NOT EXISTS component_document_history (
    history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision INT UNSIGNED NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    description VARCHAR(1000) NOT NULL,
    PRIMARY KEY (history_id),
    KEY component_document_history_document (document_id, history_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT INTO component_document_history (document_id, revision, action, description)
SELECT document_id, revision, 'history-start',
       'History started; earlier changes were not recorded.'
FROM component_documents;
