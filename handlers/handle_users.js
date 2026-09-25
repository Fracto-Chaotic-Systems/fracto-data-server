import { db_connect, db_disconnect, select, update } from "../mysql.js";

const USER_COLUMNS =
  "id, provider, provider_subject, email, display_name, enabled, role, created_at, updated_at, last_login_at, last_seen_at";

/** List allowlisted users without exposing credentials or provider tokens. */
export const handle_users = (req, res) => {
  const connection = db_connect();
  select(
    connection,
    { table: "users", columns: USER_COLUMNS, limit: 1000, order: "created_at DESC, id DESC" },
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

/** Update only the allowlist-enabled flag for an existing user. */
export const handle_user_update = (req, res) => {
  const id = Number(req.params.id);
  const enabled = req.body?.enabled;
  if (!Number.isInteger(id) || id <= 0 || typeof enabled !== "boolean") {
    res.status(400).json({ error: "A valid id and boolean enabled value are required" });
    return;
  }
  const connection = db_connect();
  update(connection, "users", id, { enabled }, (result) => {
    db_disconnect(connection);
    if (result?.error) {
      res.status(500).json({ error: result.error.message });
      return;
    }
    if (!result?.affectedRows) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.status(200).json({ id, enabled });
  });
};

/** List recent authentication audit events for the admin workflow. */
export const handle_login_events = (req, res) => {
  const requested_limit = Number(req.query.limit || 100);
  const limit = Number.isInteger(requested_limit)
    ? Math.max(1, Math.min(500, requested_limit))
    : 100;
  const connection = db_connect();
  select(
    connection,
    {
      table: "login_events",
      limit,
      order: "event_at DESC, id DESC",
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
