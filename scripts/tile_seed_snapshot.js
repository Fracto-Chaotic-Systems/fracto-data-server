import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import csv from "csv-parser";
import { ROOT_DIR } from "@fracto/sdk/utils/PlatformConstants.js";
import { open_tile_listing } from "./tile_seed_source.js";

const file_version = (info) => [
  info.size,
  info.mtimeMs,
  info.ctimeMs,
  info.ino,
  info.dev,
];

export const verify_tile_snapshot = async (source) => {
  const info = await stat(source.filename);
  if (JSON.stringify(file_version(info)) !== JSON.stringify(source.version))
    throw new Error(
      "Checkpoint CSV changed; restore the original file or use --restart",
    );
};

const describe_snapshot = async (filename, origin, kind) => {
  const handle = await open(filename, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Tile listing must be a regular file");
    const prefix = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    let headers;
    const parser = csv({ maxRowBytes: 4096 });
    parser.once("headers", (value) => {
      headers = value;
    });
    parser.resume();
    // Only the prefix is needed to discover the header; do not parse all rows.
    await new Promise((resolve, reject) => {
      parser.once("end", resolve);
      parser.once("error", reject);
      parser.end(prefix.subarray(0, bytesRead));
    });
    if (
      !headers ||
      headers.filter((header) => header === "short_code").length !== 1
    )
      throw new Error(
        "CSV must contain exactly one short_code column in its first 4096 bytes",
      );
    const source = {
      filename,
      origin,
      kind,
      headers,
      size: info.size,
      version: file_version(info),
    };
    source.identity = createHash("sha256")
      .update(JSON.stringify(source))
      .update(prefix.subarray(0, bytesRead))
      .digest("hex");
    return source;
  } finally {
    await handle.close();
  }
};

export const prepare_tile_snapshot = async (
  filename,
  { previous, restart = false, cache_dir } = {},
) => {
  let local = filename ? path.resolve(filename) : null;
  const mode = process.env.FRACTO_TILE_SOURCE_MODE || "remote-cache";
  if (!local && mode === "local") {
    if (
      !process.env.FRACTO_TILE_SOURCE_DIR ||
      !process.env.FRACTO_TILE_SOURCE_GENERATION
    )
      throw new Error(
        "Local mode requires FRACTO_TILE_SOURCE_DIR and FRACTO_TILE_SOURCE_GENERATION",
      );
    local = path.resolve(
      process.env.FRACTO_TILE_SOURCE_DIR,
      "manifest",
      "indexed.csv",
    );
  }
  if (local) return describe_snapshot(local, local, "local");
  if (mode !== "remote-cache")
    throw new Error(`Invalid tile source mode: ${mode}`);
  // A pinned snapshot supports seeking even if the HTTP server cannot serve
  // byte ranges, and remains usable when the network or remote listing changes.
  const { tile_listing_url } = await import("./tile_seed_source.js");
  const origin = await tile_listing_url();
  if (previous && !restart) {
    if (previous.kind !== "remote" || previous.origin !== origin)
      throw new Error(
        "Configured source differs from checkpoint; use --restart",
      );
    await verify_tile_snapshot(previous);
    const current = await describe_snapshot(
      previous.filename,
      origin,
      "remote",
    );
    if (current.identity !== previous.identity)
      throw new Error("Cached CSV differs from checkpoint; use --restart");
    return current;
  }
  const directory = path.resolve(
    cache_dir ||
      process.env.FRACTO_TILE_DB_CACHE_DIR ||
      path.join(
        process.env.FRACTO_TILE_DATA_DIR || path.join(ROOT_DIR, "tiles"),
        "db-seed",
      ),
  );
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${randomUUID()}.csv`);
  const temporary = destination + ".part";
  try {
    const input = await open_tile_listing();
    await pipeline(input, createWriteStream(temporary, { flags: "wx" }));
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return describe_snapshot(destination, origin, "remote");
};

export const open_tile_snapshot = (source, offset) =>
  createReadStream(source.filename, { start: offset });
