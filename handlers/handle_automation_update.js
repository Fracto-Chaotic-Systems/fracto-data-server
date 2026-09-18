import { db_connect, db_disconnect, update } from "../mysql.js";

const AUTOMATION_STATES = new Set([
  "draft",
  "ready",
  "running",
  "paused",
  "failed",
  "complete",
]);

/**
 * Update execution state and checkpoint data for an automation job.
 *
 * @param {import("express").Request} req Numeric id route parameter and
 * optional state, tasks, checkpoint, or run_stop fields.
 * @param {import("express").Response} res Updated record response.
 */
export const handle_automation_update = (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "A valid automation id is required" });
    return;
  }
  const values = {};
  if (body.state !== undefined) {
    const state = `${body.state}`.trim();
    if (!AUTOMATION_STATES.has(state)) {
      res.status(400).json({ error: "Invalid automation state" });
      return;
    }
    values.state = state;
  }
  if (body.tasks !== undefined) {
    if (!Array.isArray(body.tasks)) {
      res.status(400).json({ error: "tasks must be an array" });
      return;
    }
    values.tasks = JSON.stringify(body.tasks);
  }
  if (body.checkpoint !== undefined) {
    if (body.checkpoint === null) {
      values.checkpoint = null;
    } else if (
      typeof body.checkpoint !== "object" ||
      Array.isArray(body.checkpoint)
    ) {
      res.status(400).json({ error: "checkpoint must be an object or null" });
      return;
    } else {
      values.checkpoint = JSON.stringify(body.checkpoint);
    }
  }
  if (body.run_stop !== undefined) {
    values.run_stop = body.run_stop || null;
  }
  if (!Object.keys(values).length) {
    res.status(400).json({ error: "No automation fields supplied for update" });
    return;
  }

  const connection = db_connect();
  update(connection, "automation", id, values, (result) => {
    db_disconnect(connection);
    if (result?.error) {
      res.status(500).json({ error: result.error.message });
      return;
    }
    res.status(200).json({ id, result });
  });
};

