import { createReadStream } from "node:fs";
import { remote_tile_base_url } from "@fracto/sdk/utils/TileRemote.js";
import path from "node:path";
import { compose } from "node:stream";
import csv from "csv-parser";
import fetch from "node-fetch";

// Same authoritative indexed.csv as FractoIndexedTiles.load_short_codes, with
// backpressure and a bounded batch instead of an array/Set of the entire listing.
export const open_tile_listing = async (filename) => {
  if (filename) return createReadStream(filename);
  const mode = process.env.FRACTO_TILE_SOURCE_MODE || "remote-cache";
  if (mode === "local") {
    if (
      !process.env.FRACTO_TILE_SOURCE_DIR ||
      !process.env.FRACTO_TILE_SOURCE_GENERATION
    )
      throw new Error(
        "Local mode requires FRACTO_TILE_SOURCE_DIR and FRACTO_TILE_SOURCE_GENERATION",
      );
    return createReadStream(
      path.join(process.env.FRACTO_TILE_SOURCE_DIR, "manifest", "indexed.csv"),
    );
  }
  if (mode !== "remote-cache")
    throw new Error(`Invalid tile source mode: ${mode}`);
  const response = await fetch(await tile_listing_url());
  if (!response.ok) {
    response.body?.destroy();
    throw new Error(`Tile listing request failed: HTTP ${response.status}`);
  }
  return response.body;
};

export const tile_listing_url = async () => {
  const base = remote_tile_base_url();
  if (typeof base !== "string" || !base.trim())
    throw new Error("Missing remote tile source URL");
  return `${base.trim().replace(/\/$/, "")}/manifest/indexed.csv`;
};

export const normalize_tile_code = (value) => {
  const code =
    typeof value === "string" ? value.trim().replace(/\.gz$/, "") : "";
  if (!/^[0-3]{1,256}$/.test(code))
    throw new Error("Invalid tile short code in listing");
  return code;
};

export async function* tile_code_batches(
  source,
  { batch_size = 10000, limit = Infinity } = {},
) {
  if (!Number.isSafeInteger(batch_size) || batch_size < 1 || batch_size > 50000)
    throw new Error("Batch size must be between 1 and 50000");
  const parser = csv({ strict: true, maxRowBytes: 4096 });
  let valid_header = false;
  parser.once("headers", (headers) => {
    valid_header =
      headers.filter((header) => header === "short_code").length === 1;
  });
  const rows = compose(source, parser);
  let codes = [];
  let count = 0;
  try {
    for await (const row of rows) {
      if (!valid_header)
        throw new Error("CSV must contain exactly one short_code column");
      codes.push(normalize_tile_code(row.short_code));
      count++;
      if (codes.length === batch_size || count === limit) {
        // Improve primary-key locality without retaining a global sort in RAM.
        yield codes.sort();
        codes = [];
      }
      if (count === limit) break;
    }
    if (!valid_header)
      throw new Error("CSV must contain exactly one short_code column");
    if (codes.length) yield codes.sort();
  } finally {
    rows.destroy();
    source.destroy();
  }
}

// Keep one row of lookahead to obtain the next complete CSV record's byte
// offset. Parser read-ahead and locally sorted codes must never determine the
// saved position. This also handles CRLF, quoted multiline fields and no final LF.
export async function* tile_seek_batches(
  source,
  { batch_size = 10000, limit = Infinity, byte_offset = 0, headers, size },
) {
  if (!Number.isSafeInteger(batch_size) || batch_size < 1 || batch_size > 50000)
    throw new Error("Batch size must be between 1 and 50000");
  if (limit <= 0) {
    source.destroy();
    return;
  }
  const parser = csv({
    strict: true,
    maxRowBytes: 4096,
    outputByteOffset: true,
    ...(byte_offset ? { headers } : {}),
  });
  let valid_header = Boolean(byte_offset);
  parser.once("headers", (actual) => {
    valid_header = JSON.stringify(actual) === JSON.stringify(headers);
  });
  const rows = compose(source, parser);
  let codes = [];
  let count = 0;
  try {
    for await (const entry of rows) {
      if (!valid_header)
        throw new Error("CSV header differs from checkpoint source");
      if (codes.length === batch_size || count === limit) {
        yield {
          codes: codes.sort(),
          byte_offset: byte_offset + entry.byteOffset,
        };
        codes = [];
        if (count === limit) return;
      }
      codes.push(normalize_tile_code(entry.row.short_code));
      count++;
    }
    if (!valid_header)
      throw new Error("CSV header differs from checkpoint source");
    if (codes.length) yield { codes: codes.sort(), byte_offset: size };
  } finally {
    rows.destroy();
    source.destroy();
  }
}
