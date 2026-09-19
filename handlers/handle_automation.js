import { db_connect, db_disconnect, insert, select } from "../mysql.js";

const AUTOMATION_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const AUTOMATION_STATES = new Set([
  "draft",
  "ready",
  "running",
  "paused",
  "failed",
  "complete",
]);

/**
 * Return automation jobs belonging to one server namespace.
 *
 * @param {import("express").Request} req Query string with automation_type.
 * @param {import("express").Response} res JSON result containing matching rows.
 */
export const handle_automation = (req, res) => {
  const automation_type = `${req.query.automation_type || ""}`;
  const order =
    req.query.order === "asc"
      ? "created_at ASC, id ASC"
      : "updated_at DESC, id DESC";
  const requested_state = `${req.query.state || ""}`.trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 1000);
  if (!AUTOMATION_TYPE_PATTERN.test(automation_type)) {
    res.status(400).json({ error: "A valid automation_type is required" });
    return;
  }
  if (requested_state && !AUTOMATION_STATES.has(requested_state)) {
    res.status(400).json({ error: "Invalid automation state" });
    return;
  }
  const connection = db_connect();
  select(
    connection,
    {
      table: "automation",
      where: [
        `automation_type = '${automation_type}'`,
        requested_state ? `state = '${requested_state}'` : "",
      ]
        .filter(Boolean)
        .join(" AND "),
      order,
      limit,
      offset: 0,
    },
    (result) => {
      db_disconnect(connection);
      if (result?.error) {
        res.status(500).json({ error: result.error.message });
        return;
      }
      res.status(200).json({ result });
    },
  );
};

/**
 * Create an automation job owned by a server namespace.
 *
 * @param {import("express").Request} req Body with title, automation_type,
 * tasks, and optional state.
 * @param {import("express").Response} res Created automation record id.
 */
export const handle_automation_create = (req, res) => {
  const body = req.body || {};
  const title = `${body.title || ""}`.trim();
  const automation_type = `${body.automation_type || ""}`.trim();
  const state = `${body.state || "ready"}`.trim();
  if (
    !title ||
    !AUTOMATION_TYPE_PATTERN.test(automation_type) ||
    !AUTOMATION_STATES.has(state) ||
    !Array.isArray(body.tasks)
  ) {
    res.status(400).json({
      error: "title, automation_type, and tasks are required",
    });
    return;
  }
  const connection = db_connect();
  insert(
    connection,
    "automation",
    {
      title,
      automation_type,
      state,
      tasks: JSON.stringify(body.tasks),
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
