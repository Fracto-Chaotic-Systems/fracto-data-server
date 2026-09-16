import { db_connect, db_disconnect, select } from "../mysql.js";

const AUTOMATION_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Return automation jobs belonging to one server namespace.
 *
 * @param {import("express").Request} req Query string with automation_type.
 * @param {import("express").Response} res JSON result containing matching rows.
 */
export const handle_automation = (req, res) => {
  const automation_type = `${req.query.automation_type || ""}`;
  if (!AUTOMATION_TYPE_PATTERN.test(automation_type)) {
    res.status(400).json({ error: "A valid automation_type is required" });
    return;
  }
  const connection = db_connect();
  select(
    connection,
    {
      table: "automation",
      where: `automation_type = '${automation_type}'`,
      order: "updated_at DESC",
      limit: 1000,
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

