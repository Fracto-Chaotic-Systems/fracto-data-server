import { db_connect, db_disconnect } from "../mysql.js";

const AUTOMATION_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Atomically claim the oldest ready automation job for a server namespace.
 * The row lock prevents concurrent clients from receiving the same job.
 *
 * @param {import("express").Request} req Body containing automation_type.
 * @param {import("express").Response} res Claimed job, or null when none is ready.
 */
export const handle_claim_automation = async (req, res) => {
  const automation_type = `${req.body?.automation_type || ""}`.trim();
  if (!AUTOMATION_TYPE_PATTERN.test(automation_type)) {
    res.status(400).json({ error: "A valid automation_type is required" });
    return;
  }

  const connection = db_connect();
  const query = (sql, values = []) =>
    new Promise((resolve, reject) => {
      connection.query(sql, values, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });

  try {
    await query("START TRANSACTION");
    const rows = await query(
      "SELECT * FROM automation WHERE automation_type = ? AND state = 'ready' " +
        "ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE",
      [automation_type],
    );
    if (!rows.length) {
      await query("COMMIT");
      res.status(200).json({ job: null });
      return;
    }

    const job = rows[0];
    await query(
      "UPDATE automation SET state = 'running', run_start = CURRENT_TIMESTAMP " +
        "WHERE id = ? AND state = 'ready'",
      [job.id],
    );
    const claimed_rows = await query("SELECT * FROM automation WHERE id = ?", [
      job.id,
    ]);
    await query("COMMIT");
    res.status(200).json({ job: claimed_rows[0] || null });
  } catch (error) {
    try {
      await query("ROLLBACK");
    } catch (rollback_error) {
      console.error("automation claim rollback failed", rollback_error.message);
    }
    res.status(500).json({ error: error.message });
  } finally {
    db_disconnect(connection);
  }
};
