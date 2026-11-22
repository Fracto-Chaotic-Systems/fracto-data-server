import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  open_tile_listing,
  tile_code_batches,
  tile_seek_batches,
} from "./tile_seed_source.js";
import { prepare_tile_table, load_tile_batch } from "./tile_seed_database.js";
import {
  open_tile_checkpoint,
  initialize_tile_checkpoint,
  advance_tile_checkpoint,
} from "./tile_seed_checkpoint.js";
import {
  prepare_tile_snapshot,
  verify_tile_snapshot,
  open_tile_snapshot,
} from "./tile_seed_snapshot.js";

const usage = `Usage: node servers/fracto-data-server/scripts/manifest_to_db.js [options]
  --seed              Create/load tiles_seed with PRIMARY KEY(short_code) only
  --table NAME        Target table (default: tiles, or tiles_seed with --seed)
  --source FILE       Read a local indexed CSV instead of the configured source
  --method METHOD     auto (default), load-data, or insert
  --batch-size N      Rows per transaction (default: 10000, maximum: 50000)
  --limit N           Process at most N source rows for a benchmark
  --checkpoint        Enable resumable byte checkpoints (default with --seed)
  --no-checkpoint     Stream without saving progress (default for normal sync)
  --restart           Reset the checkpoint and rescan; retain existing tiles
  --cache-dir DIR     Persistent directory for remote CSV snapshots
  --help              Show this help
Existing short codes are skipped; existing rows and indexes are never removed.
Auto uses LOAD DATA when local_infile is enabled, otherwise batched INSERT.
No data service is required.`;

let db;
let source;
try {
  const options = {
    seed: false,
    batch_size: 10000,
    limit: Infinity,
    method: "auto",
  };
  const args = process.argv.slice(2);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--seed") {
      options.seed = true;
      continue;
    }
    if (["--checkpoint", "--no-checkpoint", "--restart"].includes(flag)) {
      if (flag === "--restart") options.restart = true;
      else options.checkpoint = flag === "--checkpoint";
      continue;
    }
    if (
      ![
        "--table",
        "--source",
        "--batch-size",
        "--limit",
        "--method",
        "--cache-dir",
      ].includes(flag) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(usage);
    const value = args[++i];
    if (flag === "--table") options.table = value;
    if (flag === "--source") options.source = path.resolve(value);
    if (flag === "--method") options.method = value;
    if (flag === "--cache-dir") options.cache_dir = path.resolve(value);
    if (flag === "--batch-size") options.batch_size = Number(value);
    if (flag === "--limit") options.limit = Number(value);
  }
  options.table ||= options.seed ? "tiles_seed" : "tiles";
  if (seen.has("--checkpoint") && seen.has("--no-checkpoint"))
    throw new Error("Choose --checkpoint or --no-checkpoint");
  options.checkpoint ??= options.seed || Boolean(options.restart);
  if (options.restart && !options.checkpoint)
    throw new Error("--restart requires checkpointing");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(options.table))
    throw new Error("Invalid target table name");
  if (
    !Number.isSafeInteger(options.batch_size) ||
    options.batch_size < 1 ||
    options.batch_size > 50000
  )
    throw new Error("Batch size must be between 1 and 50000");
  if (
    options.limit !== Infinity &&
    (!Number.isSafeInteger(options.limit) || options.limit < 1)
  )
    throw new Error("Limit must be a positive integer");
  if (!["auto", "load-data", "insert"].includes(options.method))
    throw new Error("Method must be auto, load-data, or insert");

  const config = JSON.parse(
    await readFile(new URL("../config/mysql.json", import.meta.url), "utf8"),
  );
  db = await mysql.createConnection({
    ...config,
    host: process.env.FRACTO_MYSQL_HOST || config.host,
    port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
    database: process.env.FRACTO_MYSQL_DATABASE || config.database,
    multipleStatements: false,
    flags: "LOCAL_FILES",
    connectTimeout: 15000,
  });
  let checkpoint = options.checkpoint
    ? await open_tile_checkpoint(db, options.table)
    : null;
  // Do not recreate a missing target and then skip its already checkpointed rows.
  if (checkpoint && !options.restart) {
    const [[target]] = await db.query(
      "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [options.table],
    );
    if (!target)
      throw new Error(
        "Checkpoint target is missing; use --restart to seed a replacement table",
      );
  }
  const method = await prepare_tile_table(db, options);
  console.log(
    `Importing into ${options.table} using ${method}, ${options.batch_size} rows per transaction.`,
  );
  let batches;
  let snapshot;
  if (options.checkpoint) {
    console.log("Preparing seekable CSV source for checkpointing...");
    snapshot = await prepare_tile_snapshot(options.source, {
      ...options,
      previous: checkpoint?.source,
    });
    checkpoint = await initialize_tile_checkpoint(
      db,
      options.table,
      snapshot,
      checkpoint,
      options.restart,
    );
    console.log(
      `Checkpoint: ${checkpoint.processed} rows committed, resuming at byte ${checkpoint.byte_offset} of ${snapshot.size}.`,
    );
    if (
      checkpoint.byte_offset === snapshot.size ||
      checkpoint.processed >= options.limit
    )
      batches = [];
    else {
      source = open_tile_snapshot(snapshot, checkpoint.byte_offset);
      batches = tile_seek_batches(source, {
        ...options,
        headers: snapshot.headers,
        size: snapshot.size,
        byte_offset: checkpoint.byte_offset,
        limit: options.limit - checkpoint.processed,
      });
    }
  } else {
    source = await open_tile_listing(options.source);
    batches = (async function* () {
      for await (const codes of tile_code_batches(source, options))
        yield { codes };
    })();
  }
  const start = Date.now();
  const totals = { processed: 0, inserted: 0, existing: 0, batches: 0 };
  for await (const batch of batches) {
    const { codes } = batch;
    const result = await load_tile_batch(
      db,
      options.table,
      codes,
      method,
      checkpoint
        ? async (counts) => {
            await verify_tile_snapshot(snapshot);
            await advance_tile_checkpoint(db, checkpoint, batch, counts);
          }
        : undefined,
    );
    if (checkpoint) {
      checkpoint.byte_offset = batch.byte_offset;
      checkpoint.processed += codes.length;
      checkpoint.inserted += result.inserted;
      checkpoint.existing += result.existing;
    }
    totals.processed += codes.length;
    totals.inserted += result.inserted;
    totals.existing += result.existing;
    totals.batches++;
    const seconds = (Date.now() - start) / 1000;
    console.log(
      JSON.stringify({
        table: options.table,
        ...totals,
        ...(checkpoint
          ? {
              committed_total: checkpoint.processed,
              checkpoint_byte: checkpoint.byte_offset,
            }
          : {}),
        seconds: +seconds.toFixed(1),
        rows_per_second: Math.round(
          totals.processed / Math.max(seconds, 0.001),
        ),
      }),
    );
  }
  if (!totals.processed && !checkpoint?.processed)
    throw new Error("Tile listing contains no rows");
  console.log(
    `Finished ${options.table}: ${totals.inserted} inserted, ${totals.existing} existing this run.`,
  );
  if (checkpoint && checkpoint.byte_offset < snapshot.size)
    console.log(
      "Partial import saved; rerun with a higher --limit or no --limit to continue.",
    );
  else if (options.seed)
    console.log(
      "The seed table is ready for validation. No table swap or secondary index changes were performed.",
    );
} catch (error) {
  console.error(`Tile database import failed: ${error.message}`);
  if (
    error.code === "ER_CLIENT_LOCAL_FILES_DISABLED" ||
    error.errno === 3948 ||
    error.errno === 1148
  )
    console.error(
      "Enable local_infile on the MySQL server before using this bulk loader.",
    );
  process.exitCode = 1;
} finally {
  source?.destroy();
  await db?.end();
}
