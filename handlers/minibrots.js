import { db_connect, db_disconnect, select, insert } from "../mysql.js";

export const MINIBROT_LIST_COLUMNS =
  "id, name, CQ_code, pattern, best_level, free_ordinal, magnitude, core_point, octave_point, display_settings, thumbnail_name, updated_at, published_at, is_inline, is_node";

export const handle_minibrots = (req, res) => {
  const is_node = String(req.query.is_node ?? "0");
  const is_inline = String(req.query.is_inline ?? "0");
  if (!/^[01]$/.test(is_node) || !/^[01]$/.test(is_inline))
    return res
      .status(400)
      .json({ error: "is_node and is_inline must be 0 or 1" });
  const requested_limit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requested_limit)
    ? Math.min(Math.max(requested_limit, 1), 20000)
    : 5000;
  const query = {
    table: "free_bailiwicks",
    // Keep large ray JSON out of the list, on old and migrated schemas alike.
    columns: MINIBROT_LIST_COLUMNS,
    limit,
    offset: 0,
    order: "magnitude desc",
    where: `is_node = ${is_node} && is_inline = ${is_inline}`,
  };
  try {
    const connection = db_connect();
    select(connection, query, (result) => {
      res.status(200).json({ result });
      db_disconnect(connection);
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error });
  }
};

export const handle_minibrot = (req, res) => {
  const {
    name,
    CQ_code,
    pattern,
    best_level,
    magnitude,
    core_point,
    octave_point,
    display_settings,
    is_node,
    is_inline,
  } = req.body;
  try {
    const connection = db_connect();
    insert(
      connection,
      "free_bailiwicks",
      {
        name,
        CQ_code,
        pattern,
        best_level,
        magnitude,
        core_point,
        octave_point,
        display_settings,
        is_node,
        is_inline,
      },
      (result) => {
        // console.log('insert tile', short_code)
        res.status(200).json({ result });
        db_disconnect(connection);
      },
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error });
  }
};
