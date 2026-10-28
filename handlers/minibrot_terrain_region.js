import { db_connect, db_disconnect } from "../mysql.js";

export function create_minibrot_terrain_region_handler({ connect = db_connect, disconnect = db_disconnect } = {}) {
  return async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid bailiwick id" });
    let connection;
    try {
      connection = connect();
      const [rows] = await connection.promise().query(
        "SELECT id, display_settings FROM free_bailiwicks WHERE id = ? AND is_node = 0 AND is_inline = 0", [id],
      );
      if (!rows.length) return res.status(404).json({ error: "Freeform bailiwick not found" });
      return res.json({ result: { id: rows[0].id, display_settings: rows[0].display_settings } });
    } catch (error) {
      console.error("Unable to read terrain region", error.code || error.message);
      return res.status(503).json({ error: "Terrain region unavailable" });
    } finally { if (connection) disconnect(connection); }
  };
}

export const handle_minibrot_terrain_region = create_minibrot_terrain_region_handler();
