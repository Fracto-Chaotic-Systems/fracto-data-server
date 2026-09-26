import { db_connect, db_disconnect, select, update } from "../mysql.js";

const USER_COLUMNS =
  "id, provider, provider_subject, email, display_name, enabled, role, created_at, updated_at, last_login_at, last_seen_at";

const USER_IDENTITY_FIELDS = [
  "provider",
  "provider_subject",
  "email",
  "display_name",
];

const AUDIT_EVENT_TYPES = new Set([
  "authenticated",
  "rejected",
  "disabled",
  "logout",
  "error",
]);

const is_loopback_request = (req) => {
  const request_ip = `${req.ip || req.socket?.remoteAddress || ""}`;
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request_ip);
};

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

/**
 * Create or refresh one provider identity and append a successful login event.
 * Enabled and role values are intentionally never changed during login.
 */
export const handle_user_upsert = (req, res) => {
  if (!is_loopback_request(req)) {
    res.status(403).json({ error: "User provisioning is an internal operation" });
    return;
  }
  const provider = `${req.body?.provider || ""}`.trim();
  const provider_subject = `${req.body?.provider_subject || ""}`.trim();
  const email = req.body?.email ? `${req.body.email}`.trim() : null;
  const display_name = req.body?.display_name
    ? `${req.body.display_name}`.trim()
    : null;
  if (!provider || !provider_subject) {
    res.status(400).json({ error: "Provider and provider subject are required" });
    return;
  }

  const ip_address = `${req.body?.ip_address || ""}`.slice(0, 45) || null;
  const user_agent = `${req.body?.user_agent || ""}`.slice(0, 512) || null;
  const connection = db_connect();
  const upsert_sql = `INSERT INTO users (${USER_IDENTITY_FIELDS.join(", ")}, last_login_at, last_seen_at)
    VALUES (?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      display_name = VALUES(display_name),
      last_login_at = NOW(),
      last_seen_at = NOW()`;
  connection.query(
    upsert_sql,
    [provider, provider_subject, email, display_name],
    (upsert_error) => {
      if (upsert_error) {
        db_disconnect(connection);
        res.status(500).json({ error: upsert_error.message });
        return;
      }
      connection.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE provider = ? AND provider_subject = ? LIMIT 1`,
        [provider, provider_subject],
        (select_error, rows) => {
          if (select_error || !rows?.[0]) {
            db_disconnect(connection);
            res.status(500).json({
              error: select_error?.message || "User could not be loaded after upsert",
            });
            return;
          }
          const user = rows[0];
          const event_type = user.enabled ? "authenticated" : "disabled";
          connection.query(
            `INSERT INTO login_events (user_id, provider, provider_subject, event_type, success, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              user.id,
              provider,
              provider_subject,
              event_type,
              user.enabled ? 1 : 0,
              ip_address,
              user_agent,
            ],
            (event_error) => {
              db_disconnect(connection);
              if (event_error) {
                res.status(500).json({ error: event_error.message });
                return;
              }
              res.status(200).json({ user });
            },
          );
        },
      );
    },
  );
};

/** Append a non-secret authentication audit event from the main server. */
export const handle_login_event = (req, res) => {
  if (!is_loopback_request(req)) {
    res.status(403).json({ error: "Authentication events are internal" });
    return;
  }
  const event_type = `${req.body?.event_type || ""}`.trim();
  const provider = `${req.body?.provider || "unknown"}`.trim().slice(0, 64);
  const provider_subject = `${req.body?.provider_subject || "unknown"}`
    .trim()
    .slice(0, 255);
  if (!AUDIT_EVENT_TYPES.has(event_type)) {
    res.status(400).json({ error: "Unsupported authentication event type" });
    return;
  }
  const user_id = Number.isInteger(Number(req.body?.user_id))
    ? Number(req.body.user_id)
    : null;
  const success = req.body?.success === true ? 1 : 0;
  const ip_address = `${req.body?.ip_address || ""}`.slice(0, 45) || null;
  const user_agent = `${req.body?.user_agent || ""}`.slice(0, 512) || null;
  const details =
    req.body?.details && typeof req.body.details === "object"
      ? JSON.stringify(req.body.details)
      : null;
  const connection = db_connect();
  connection.query(
    `INSERT INTO login_events (user_id, provider, provider_subject, event_type, success, ip_address, user_agent, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user_id,
      provider,
      provider_subject,
      event_type,
      success,
      ip_address,
      user_agent,
      details,
    ],
    (error, result) => {
      db_disconnect(connection);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(201).json({ id: result.insertId, event_type });
    },
  );
};

/** Create or promote the explicitly configured first administrator. */
export const handle_user_bootstrap = (req, res) => {
  if (!is_loopback_request(req)) {
    res.status(403).json({ error: "Administrator bootstrap is an internal operation" });
    return;
  }
  const expected_confirmation = process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
  if (!expected_confirmation || req.body?.confirmation !== expected_confirmation) {
    res.status(403).json({ error: "Administrator bootstrap confirmation is invalid" });
    return;
  }
  const provider = `${req.body?.provider || ""}`.trim();
  const provider_subject = `${req.body?.provider_subject || ""}`.trim();
  const email = req.body?.email ? `${req.body.email}`.trim() : null;
  const display_name = req.body?.display_name
    ? `${req.body.display_name}`.trim()
    : null;
  if (!provider || !provider_subject) {
    res.status(400).json({ error: "Provider and provider subject are required" });
    return;
  }
  const connection = db_connect();
  connection.query(
    `INSERT INTO users (provider, provider_subject, email, display_name, enabled, role, last_seen_at)
     VALUES (?, ?, ?, ?, 1, 'admin', NOW())
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       display_name = VALUES(display_name),
       enabled = 1,
       role = 'admin',
       last_seen_at = NOW()`,
    [provider, provider_subject, email, display_name],
    (error) => {
      if (error) {
        db_disconnect(connection);
        res.status(500).json({ error: error.message });
        return;
      }
      connection.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE provider = ? AND provider_subject = ? LIMIT 1`,
        [provider, provider_subject],
        (select_error, rows) => {
          db_disconnect(connection);
          if (select_error || !rows?.[0]) {
            res.status(500).json({
              error: select_error?.message || "Administrator could not be loaded after bootstrap",
            });
            return;
          }
          res.status(200).json({ user: rows[0] });
        },
      );
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
