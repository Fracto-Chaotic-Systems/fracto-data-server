import { db_connect, db_disconnect, update } from "../mysql.js";

/**
 * Update a video project delegated by the asset server.
 *
 * @param {import("express").Request} req Request with numeric `id` route
 * parameter and video fields in the JSON body.
 * @param {import("express").Response} res Update result.
 */
export const handle_video_update = (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "A valid video id is required" });
    return;
  }
  const values = {};
  if (body.title !== undefined) {
    const title = `${body.title}`.trim();
    if (!title) {
      res.status(400).json({ error: "title cannot be empty" });
      return;
    }
    values.title = title;
  }
  if (body.meta !== undefined) {
    if (!body.meta || typeof body.meta !== "object") {
      res.status(400).json({ error: "meta must be an object" });
      return;
    }
    values.meta = JSON.stringify(body.meta);
  }
  if (body.script !== undefined) {
    if (!body.script || typeof body.script !== "object") {
      res.status(400).json({ error: "script must be an object" });
      return;
    }
    values.script = JSON.stringify(body.script);
  }
  if (body.meta_version !== undefined) {
    values.meta_version = Number(body.meta_version) || 1;
  }
  if (body.script_version !== undefined) {
    values.script_version = Number(body.script_version) || 1;
  }
  if (body.archived !== undefined) {
    values.archived = Boolean(body.archived);
  }
  if (!Object.keys(values).length) {
    res.status(400).json({ error: "No video fields supplied for update" });
    return;
  }

  const connection = db_connect();
  update(connection, "videos", id, values, (result) => {
    db_disconnect(connection);
    if (result?.error) {
      res.status(500).json({ error: result.error.message });
      return;
    }
    res.status(200).json({ id, result });
  });
};
