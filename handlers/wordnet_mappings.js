// Explicit projection keeps unrelated database fields outside this API.
const FIELDS = [
  "cardinality",
  "synset_id",
  "wordnet_version",
  "word",
  "world_name",
  "definition",
  "gloss",
  "factorization",
  "notes",
];
export function create_wordnet_mappings_handler({ connect, disconnect } = {}) {
  return async (_req, res) => {
    let connection,
      close = disconnect;
    try {
      const database =
        connect && disconnect ? null : await import("../mysql.js");
      close ||= database.db_disconnect;
      connection = (connect || database.db_connect)();
      const [rows] = await connection
        .promise()
        .query(
          `SELECT ${FIELDS.join(", ")} FROM wordnet_mappings ORDER BY cardinality ASC`,
        );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        result: rows.map((row) =>
          Object.fromEntries(FIELDS.map((field) => [field, row[field]])),
        ),
      });
    } catch {
      return res.status(503).json({ error: "WordNet mappings unavailable" });
    } finally {
      if (connection) close(connection);
    }
  };
}
export const handle_wordnet_mappings = create_wordnet_mappings_handler();
