import { db_connect, db_disconnect, insert, select } from "../mysql.js";

export const handle_asset = (req, res) => {
  const asset_id = `"${req.query.asset_id}"`;
  const width = parseInt(req.query.width);
  const height = parseInt(req.query.height);
  const focal_point_x = parseFloat(req.query.focal_point_x);
  const focal_point_y = parseFloat(req.query.focal_point_y);
  const scope = parseFloat(req.query.scope);
  const filename = `"${req.query.filename}"`;
  const public_url = `"${req.query.public_url}"`;
  const asset_type = `"${req.query.asset_type}"`;
  try {
    const connection = db_connect();
    insert(
      connection,
      "assets",
      {
        asset_id: asset_id,
        width: width,
        height: height,
        focal_point_x: focal_point_x,
        focal_point_y: focal_point_y,
        scope: scope,
        filename: filename,
        public_url: public_url,
        asset_type: asset_type,
      },
      (result) => {
        console.log("insert asset", result);
        res.status(200).json({ result });
        db_disconnect(connection);
      },
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error });
  }
};

const parse_dimension = (value, field_name) => {
  if (value === undefined) return undefined;
  const dimension = Number(value);
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 100000) {
    throw new Error(`${field_name} must be a positive integer`);
  }
  return dimension;
};

const parse_asset_type = (value) => {
  if (value === undefined) return undefined;
  if (!/^[a-z0-9_-]+$/i.test(value)) {
    throw new Error("asset_type contains unsupported characters");
  }
  return value;
};

/** Builds the allowlisted assets query used by the data endpoint and tests. */
export const build_assets_query = (params = {}) => {
  const width = parse_dimension(params.width, "width");
  const height = parse_dimension(params.height, "height");
  const asset_type = parse_asset_type(params.asset_type);
  const where = [`width = ${width || 4800}`];
  if (height !== undefined) where.push(`height = ${height}`);
  if (asset_type !== undefined) where.push(`asset_type = '${asset_type}'`);
  if (asset_type === "image" && width === 4800 && height === 4800) {
    where.push("public_url <> ''");
  }
  return {
    table: "assets",
    limit: 1000,
    offset: 0,
    order: "id desc",
    where: where.join(" AND "),
  };
};

export const handle_assets = (req, res) => {
  try {
    const query = build_assets_query(req.query);
    console.log("handle_assets", query);
    const connection = db_connect();
    select(connection, query, (result) => {
      console.log("assets yay 200");
      const filtered_result = query.where.includes("public_url <> ''") && Array.isArray(result)
        ? result.filter((asset) => /^https?:\/\//i.test(asset.public_url || ""))
        : result;
      res.status(200).json({ result: filtered_result });
      db_disconnect(connection);
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
