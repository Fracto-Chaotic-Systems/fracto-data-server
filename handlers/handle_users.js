import { createHash, timingSafeEqual } from "node:crypto";
import { db_connect, db_disconnect, select, update } from "../mysql.js";
import { record_runtime_metric } from "../../../utils/windowed_metrics.js";

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
  if (req.headers?.origin || req.headers?.["sec-fetch-site"]) return false;
  const request_ip = `${req.ip || req.socket?.remoteAddress || ""}`;
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request_ip);
};

const query_database = (connection, sql, values = []) =>
  new Promise((resolve, reject) => {
    connection.query(sql, values, (error, result) =>
      error ? reject(error) : resolve(result),
    );
  });

const bootstrap_conflict = () => {
  const error = new Error("Administrator bootstrap is already completed or user data exists");
  error.status = 409;
  return error;
};

const bootstrap_confirmation_matches = (expected, provided) => {
  if (typeof expected !== "string" || !expected || typeof provided !== "string") {
    return false;
  }
  const expected_digest = createHash("sha256").update(expected).digest();
  const provided_digest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expected_digest, provided_digest);
};

/** Provision the initial admin exactly once per database, with safe same-user retries. */
export const provision_initial_admin = async (connection, identity) => {
  let lock_acquired = false;
  let transaction_started = false;
  const query = (sql, values) => query_database(connection, sql, values);
  try {
    const lock_rows = await query(
      "SELECT GET_LOCK(SHA2(CONCAT('fracto:auth-bootstrap:', DATABASE()), 256), 10) AS acquired",
    );
    lock_acquired = Number(lock_rows?.[0]?.acquired) === 1;
    if (!lock_acquired) {
      const error = new Error("Administrator bootstrap is temporarily unavailable");
      error.status = 503;
      throw error;
    }

    await query("START TRANSACTION");
    transaction_started = true;
    const markers = await query(
      "SELECT user_id FROM auth_bootstrap_state WHERE id = 1 LIMIT 1 FOR UPDATE",
    );
    if (markers?.[0]) {
      const completed_users = await query(
        "SELECT provider, provider_subject FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [markers[0].user_id],
      );
      const completed_user = completed_users?.[0];
      if (
        !completed_user ||
        completed_user.provider !== identity.provider ||
        completed_user.provider_subject !== identity.provider_subject
      ) {
        throw bootstrap_conflict();
      }

      // A repeated request for the identity recorded by the committed marker
      // confirms success without changing current access or profile data.
      await query("COMMIT");
      transaction_started = false;
      return { user_id: markers[0].user_id, already_completed: true };
    }

    // Lock the user range as well as existing rows so a concurrent first
    // login cannot add an unexpected identity during bootstrap.
    const existing_users = await query(
      "SELECT id, provider, provider_subject FROM users ORDER BY id FOR UPDATE",
    );
    if (
      existing_users.length > 1 ||
      (existing_users.length === 1 &&
        (existing_users[0].provider !== identity.provider ||
          existing_users[0].provider_subject !== identity.provider_subject))
    ) {
      throw bootstrap_conflict();
    }

    let user_id;
    if (existing_users.length === 1) {
      user_id = existing_users[0].id;
      await query(
        `UPDATE users SET email = ?, display_name = ?, enabled = 1,
          role = 'admin', last_seen_at = NOW() WHERE id = ?`,
        [identity.email, identity.display_name, user_id],
      );
    } else {
      const inserted = await query(
        `INSERT INTO users (provider, provider_subject, email, display_name, enabled, role, last_seen_at)
         VALUES (?, ?, ?, ?, 1, 'admin', NOW())`,
        [
          identity.provider,
          identity.provider_subject,
          identity.email,
          identity.display_name,
        ],
      );
      user_id = inserted.insertId;
    }

    const users = await query(
      "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
      [user_id],
    );
    if (!users?.[0]) {
      throw new Error("Administrator could not be loaded after bootstrap");
    }
    await query(
      "INSERT INTO auth_bootstrap_state (id, user_id) VALUES (1, ?)",
      [user_id],
    );
    await query("COMMIT");
    transaction_started = false;
    return { user_id, already_completed: false };
  } catch (error) {
    if (transaction_started) {
      try {
        await query("ROLLBACK");
      } catch {
        // Closing the connection below also releases any active transaction.
      }
    }
    throw error;
  } finally {
    if (lock_acquired) {
      try {
        await query(
          "SELECT RELEASE_LOCK(SHA2(CONCAT('fracto:auth-bootstrap:', DATABASE()), 256)) AS released",
        );
      } catch {
        // The connection close releases a named lock if explicit release fails.
      }
    }
  }
};

/** Internal lookup used by the main server before authorizing a session. */
export const create_session_user_handler = ({
  connection_factory = db_connect,
  disconnect = db_disconnect,
  record_metric = record_runtime_metric,
  now = () => performance.now(),
} = {}) => (req, res) => {
  const request_started_at = now();
  record_metric("auth_user_record_request_arrival", 0, "received");
  res.once?.("finish", () => {
    record_metric(
      "auth_user_record_handler_duration",
      now() - request_started_at,
      res.statusCode >= 500 ? "error" : String(res.statusCode || 200),
    );
  });
  if (!is_loopback_request(req)) {
    res.status(403).json({ error: "Session lookup is an internal operation" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "A valid user id is required" });
    return;
  }
  const lookup_started_at = now();
  const connection_started_at = now();
  let query_started_at = null;
  const connection = connection_factory((connect_error) => {
    const connection_duration_ms = now() - connection_started_at;
    record_metric(
      "auth_user_record_connection",
      connection_duration_ms,
      connect_error ? "error" : "success",
    );
    if (!connect_error) query_started_at = now();
  });
  connection.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id], (error, rows) => {
    disconnect(connection);
    const query_duration_ms = query_started_at === null
      ? 0
      : now() - query_started_at;
    record_metric(
      "auth_user_record_sql_query",
      query_duration_ms,
      query_started_at === null ? "not_run" : error ? "error" : "success",
    );
    if (error) {
      record_metric(
        "auth_user_record_query",
        now() - lookup_started_at,
        "error",
      );
      res.status(503).json({ error: "Unable to load user" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    if (!rows?.[0]) {
      record_metric(
        "auth_user_record_query",
        now() - lookup_started_at,
        "not_found",
      );
      res.status(404).json({ error: "User not found" });
      return;
    }
    record_metric(
      "auth_user_record_query",
      now() - lookup_started_at,
      "success",
    );
    res.json({ user: rows[0] });
  });
};

export const handle_session_user = create_session_user_handler();

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
export const handle_user_upsert = (req, res, connection_factory = db_connect) => {
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
  const connection = connection_factory();
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

/** Bind the handler without Express's third-argument `next` callback. */
export const create_user_upsert_route = (connection_factory = db_connect) =>
  (req, res) => handle_user_upsert(req, res, connection_factory);

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
export const handle_user_bootstrap = (req, res, connection_factory = db_connect) => {
  if (!is_loopback_request(req)) {
    res.status(403).json({ error: "Administrator bootstrap is an internal operation" });
    return;
  }
  const expected_confirmation = process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
  if (!bootstrap_confirmation_matches(expected_confirmation, req.body?.confirmation)) {
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
  const connection = connection_factory();
  provision_initial_admin(connection, {
    provider,
    provider_subject,
    email,
    display_name,
  }).then(() => {
    db_disconnect(connection);
    res.status(200).json({ success: true });
  }).catch((error) => {
    try {
      db_disconnect(connection);
    } catch {
      // Preserve the provisioning response if connection cleanup also fails.
    }
    if (error.status === 409 || error.status === 503) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Administrator bootstrap failed" });
  });
};

/** Bind bootstrap without letting Express pass `next` as the connection factory. */
export const create_user_bootstrap_route = (connection_factory = db_connect) =>
  (req, res) => handle_user_bootstrap(req, res, connection_factory);

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
