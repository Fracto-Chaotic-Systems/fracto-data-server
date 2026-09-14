import { db_connect, db_disconnect, insert } from "../mysql.js";

/**
 * Insert a video project defined by the asset server.
 * The data server owns the connection and persistence mechanics; the asset
 * server owns the meaning and default shape of the video record.
 *
 * @param {import("express").Request} req Request body containing video fields.
 * @param {import("express").Response} res Created record id and insert result.
 */
export const handle_video = (req, res) => {
  const body = req.body || {};
  const title = `${body.title || ""}`.trim();
  if (
    !title ||
    typeof body.meta !== "object" ||
    typeof body.script !== "object"
  ) {
    res.status(400).json({ error: "title, meta, and script are required" });
    return;
  }
  const connection = db_connect();
  insert(
    connection,
    "videos",
    {
      title,
      meta: JSON.stringify(body.meta),
      script: JSON.stringify(body.script),
      meta_version: Number(body.meta_version) || 1,
      script_version: Number(body.script_version) || 1,
    },
    (result) => {
      db_disconnect(connection);
      if (result?.error) {
        res.status(500).json({ error: result.error.message });
        return;
      }
      res.status(201).json({ id: result.insertId, result });
    },
  );
};
