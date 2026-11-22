import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const journal = "fracto_tile_seed_checkpoints";

export const open_tile_checkpoint = async (db, table) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(table))
    throw new Error("Invalid checkpoint target");
  const [[schema]] = await db.query("SELECT DATABASE() AS name");
  const lock =
    "tile-seed:" +
    createHash("sha256")
      .update(`${schema.name}/${table}`)
      .digest("hex")
      .slice(0, 54);
  const [[lease]] = await db.query("SELECT GET_LOCK(?, 0) AS acquired", [lock]);
  if (Number(lease.acquired) !== 1)
    throw new Error(
      "Another checkpointed importer is already loading this table",
    );
  // Use the versioned, replay-safe migration so standalone imports can initialize
  // their operational journal without requiring unrelated pending migrations.
  await db.query(
    await readFile(
      new URL("../database/schema/018_tile-seed-checkpoints.sql", import.meta.url),
      "utf8",
    ),
  );
  const [[engine]] = await db.query(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [journal],
  );
  if (engine?.ENGINE !== "InnoDB")
    throw new Error("Checkpoint journal must use InnoDB");
  const [[row]] = await db.query(
    `SELECT * FROM ${journal} WHERE target_table = ?`,
    [table],
  );
  if (!row) return null;
  const state = {
    ...row,
    source:
      typeof row.source_json === "string"
        ? JSON.parse(row.source_json)
        : row.source_json,
  };
  for (const key of ["byte_offset", "processed", "inserted", "existing"]) {
    state[key] = Number(row[key]);
    if (!Number.isSafeInteger(state[key]) || state[key] < 0)
      throw new Error("Invalid checkpoint counters");
  }
  return state;
};

export const initialize_tile_checkpoint = async (
  db,
  table,
  source,
  previous,
  restart = false,
) => {
  if (previous && !restart) {
    if (
      previous.source_hash !== source.identity ||
      previous.byte_offset > source.size
    )
      throw new Error(
        "Source differs from the checkpoint; use --restart to rescan without removing existing tiles",
      );
    return previous;
  }
  await db.query(
    `INSERT INTO ${journal}
    (target_table, source_hash, source_json, byte_offset, processed, inserted, existing)
    VALUES (?, ?, ?, 0, 0, 0, 0)
    ON DUPLICATE KEY UPDATE source_hash = VALUES(source_hash), source_json = VALUES(source_json),
      byte_offset = 0, processed = 0, inserted = 0, existing = 0`,
    [table, source.identity, JSON.stringify(source)],
  );
  return {
    target_table: table,
    source_hash: source.identity,
    source,
    byte_offset: 0,
    processed: 0,
    inserted: 0,
    existing: 0,
  };
};

// Called by load_tile_batch before COMMIT, on that same connection. A crash
// before/after the commit therefore cannot leave the offset ahead of the tiles.
export const advance_tile_checkpoint = async (db, state, batch, result) => {
  if (
    !Number.isSafeInteger(batch.byte_offset) ||
    batch.byte_offset <= state.byte_offset ||
    batch.byte_offset > state.source.size
  )
    throw new Error("Invalid checkpoint byte offset");
  const [updated] = await db.query(
    `UPDATE ${journal} SET byte_offset = ?,
    processed = processed + ?, inserted = inserted + ?, existing = existing + ?
    WHERE target_table = ? AND source_hash = ? AND byte_offset = ?`,
    [
      batch.byte_offset,
      batch.codes.length,
      result.inserted,
      result.existing,
      state.target_table,
      state.source_hash,
      state.byte_offset,
    ],
  );
  if (updated.affectedRows !== 1)
    throw new Error("Checkpoint changed unexpectedly; tile batch rolled back");
};
