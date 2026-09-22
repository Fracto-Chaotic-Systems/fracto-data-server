import { db_connect, db_disconnect, select } from "../mysql.js";

/**
 * Return one video record by id for asset-server render orchestration.
 * The data server owns the query; the asset server owns render semantics.
 *
 * @param {import("express").Request} req Request with numeric id route param.
 * @param {import("express").Response} res Video record or an error response.
 */
export const handle_video_get = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "A valid video id is required" });
    return;
  }
  const connection = db_connect();
  select(
    connection,
    { table: "videos", limit: 1, offset: 0, where: `id = ${id}` },
    (result) => {
      db_disconnect(connection);
      if (result?.error) {
        res.status(500).json({ error: result.error.message });
        return;
      }
      if (!result?.length) {
        res.status(404).json({ error: "Video not found" });
        return;
      }
      res.status(200).json({ result: result[0] });
    },
  );
};
