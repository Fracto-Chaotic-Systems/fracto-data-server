import { Readable } from "node:stream";
import { bounds_from_short_code } from "@fracto/sdk/utils/TileBounds.js";
import { normalize_tile_code } from "./tile_seed_source.js";

const identifier = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))
    throw new Error("Invalid target table name");
  return `\`${name}\``;
};
const columns =
  "short_code,parent,level,folder,bounds_left,bounds_top,bounds_right,bounds_bottom";
const infile = "fracto-tile-batch.tsv";

export const prepare_tile_table = async (
  db,
  { table, seed = false, method = "auto" },
) => {
  const target = identifier(table);
  if (!["auto", "load-data", "insert"].includes(method))
    throw new Error("Invalid bulk loading method");
  const [[settings]] = await db.query("SELECT @@local_infile AS local_infile");
  if (!Number(settings.local_infile) && method === "load-data")
    throw new Error(
      "MySQL local_infile is disabled; enable it or use --method insert",
    );
  const selected_method =
    method === "auto"
      ? Number(settings.local_infile)
        ? "load-data"
        : "insert"
      : method;
  if (seed)
    await db.query(`CREATE TABLE IF NOT EXISTS ${target} (
    short_code varchar(256) NOT NULL,
    parent varchar(256) NOT NULL,
    level int NOT NULL,
    folder varchar(256) NOT NULL,
    bounds_left double NOT NULL,
    bounds_top double NOT NULL,
    bounds_right double NOT NULL,
    bounds_bottom double NOT NULL,
    PRIMARY KEY (short_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
  const [[status]] = await db.query(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  if (status?.ENGINE !== "InnoDB")
    throw new Error(
      "Target must be an existing InnoDB table (use --seed to create a seed table)",
    );
  const [indexes] = await db.query(`SHOW INDEX FROM ${target}`);
  const primary = indexes.filter((index) => index.Key_name === "PRIMARY");
  if (
    primary.length !== 1 ||
    primary[0].Column_name !== "short_code" ||
    primary[0].Sub_part != null
  )
    throw new Error("Target must have PRIMARY KEY(short_code)");
  if (
    indexes.some(
      (index) =>
        !Number(index.Non_unique) &&
        (index.Column_name !== "short_code" || index.Sub_part != null),
    )
  )
    throw new Error(
      "Target has an unrelated unique index; duplicate skipping would be ambiguous",
    );
  if (seed && indexes.some((index) => index.Key_name !== "PRIMARY"))
    throw new Error(
      "Seed target already has secondary indexes; choose a fresh --table name",
    );
  // LOCAL downgrades some data errors to warnings. Inspect every warning before
  // committing, allowing duplicate primary keys only. No global tuning changes.
  await db.query("SET SESSION max_error_count = 65535");
  return selected_method;
};

const tile_values = (value) => {
  const code = normalize_tile_code(value);
  const groups = code.match(/.{4}/g) || [];
  const folder = code.length > 4 ? `/${groups.join("/")}` : "/";
  const bounds = bounds_from_short_code(code);
  return [
    code,
    code.slice(0, -1),
    code.length,
    folder,
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.bottom,
  ];
};

export const tile_tsv_row = (value) => tile_values(value).join("\t") + "\n";

export const load_tile_batch = async (
  db,
  table,
  codes,
  method = "load-data",
  before_commit,
) => {
  if (!codes.length || codes.length > 50000)
    throw new Error("Invalid tile batch size");
  if (!["load-data", "insert"].includes(method))
    throw new Error("Invalid bulk loading method");
  const target = identifier(table);
  const payload =
    method === "load-data"
      ? Buffer.from(codes.map(tile_tsv_row).join(""), "utf8")
      : null;
  let stream;
  let unexpected_path = false;
  await db.beginTransaction();
  try {
    const query =
      method === "insert"
        ? {
            sql: `INSERT IGNORE INTO ${target} (${columns}) VALUES ${codes.map(() => "(?,?,?,?,?,?,?,?)").join(",")}`,
            values: codes.flatMap(tile_values),
          }
        : {
            sql: `LOAD DATA LOCAL INFILE '${infile}' IGNORE INTO TABLE ${target}
        CHARACTER SET latin1 FIELDS TERMINATED BY '\\t' ESCAPED BY ''
        LINES TERMINATED BY '\\n' (${columns})`,
            infileStreamFactory: (requested) => {
              // Supply only this in-memory batch; never open server-requested files.
              unexpected_path = requested !== infile;
              stream = Readable.from(unexpected_path ? [] : [payload]);
              return stream;
            },
          };
    const [result] = await db.query(query);
    if (unexpected_path)
      throw new Error("MySQL requested an unexpected infile path");
    if (result.warningStatus) {
      const [warnings] = await db.query("SHOW WARNINGS LIMIT 65535");
      if (
        warnings.length >= 65535 ||
        warnings.some((warning) => Number(warning.Code) !== 1062)
      )
        throw new Error(
          "Bulk load produced a non-duplicate or truncated warning list; batch rolled back",
        );
    }
    if (
      !Number.isSafeInteger(result.affectedRows) ||
      result.affectedRows < 0 ||
      result.affectedRows > codes.length
    )
      throw new Error("Unexpected bulk load row count");
    const counts = {
      inserted: result.affectedRows,
      existing: codes.length - result.affectedRows,
    };
    if (before_commit) await before_commit(counts);
    await db.commit();
    return counts;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    stream?.destroy();
  }
};
