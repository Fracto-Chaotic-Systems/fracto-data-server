import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { MAX_RAY_CACHE_BYTES } from "@fracto/sdk/orbitals/FractoMinibrotRayCache.js";
import { decode_ray_cache } from "./minibrot_ray_codec.js";

const compress = promisify(gzip),
  decompress = promisify(gunzip);
const INLINE_LIMIT = 20 * 1024 * 1024,
  CHUNK_BYTES = 8 * 1024 * 1024;
const ENCODING = "orbital-gzip-chunks-v1";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const invalid = () =>
  Object.assign(Error("invalid_orbital_cache_chunks"), {
    code: "invalid_orbital_cache_chunks",
  });

/** CPU work precedes SQL locks. Keep legacy inline formats for small caches. */
export const prepare_orbital_cache = async (cache) => {
  const raw = Buffer.from(JSON.stringify(cache));
  if (raw.length > MAX_RAY_CACHE_BYTES)
    throw Object.assign(Error("orbital_cache_size_limit"), {
      code: "orbital_cache_size_limit",
      status: 413,
    });
  if (raw.length < 1024 * 1024) return { value: raw.toString(), chunks: [] };
  const zipped = await compress(raw);
  if (4 * Math.ceil(zipped.length / 3) + 64 <= INLINE_LIMIT)
    return {
      value: JSON.stringify({
        encoding: "gzip-base64",
        data: zipped.toString("base64"),
      }),
      chunks: [],
    };
  const chunks = [];
  for (let offset = 0; offset < zipped.length; offset += CHUNK_BYTES) {
    const payload = zipped.subarray(offset, offset + CHUNK_BYTES);
    chunks.push({ content_hash: digest(payload), payload });
  }
  return {
    value: JSON.stringify({
      encoding: ENCODING,
      raw_bytes: raw.length,
      compressed_bytes: zipped.length,
      content_hash: digest(raw),
      chunks: chunks.map((chunk) => chunk.content_hash),
    }),
    chunks,
  };
};

/** Caller owns the transaction containing chunks plus the referencing row. */
export const save_orbital_cache = async (db, prepared) => {
  for (const chunk of prepared.chunks)
    await db.execute(
      "INSERT INTO orbital_ray_cache_chunks (content_hash,payload) VALUES (?,?) ON DUPLICATE KEY UPDATE content_hash=content_hash",
      [chunk.content_hash, chunk.payload],
    );
  return prepared.value;
};

/** Verify bounded chunk count, hashes, exact sizes and bounded inflation. */
export const decode_orbital_cache = async (db, value) => {
  const manifest = typeof value === "string" ? JSON.parse(value) : value;
  if (manifest?.encoding !== ENCODING) return decode_ray_cache(manifest);
  if (
    !Number.isSafeInteger(manifest.raw_bytes) ||
    manifest.raw_bytes < 1 ||
    manifest.raw_bytes > MAX_RAY_CACHE_BYTES ||
    !Number.isSafeInteger(manifest.compressed_bytes) ||
    manifest.compressed_bytes < 1 ||
    manifest.compressed_bytes > MAX_RAY_CACHE_BYTES + 65536 ||
    !/^[a-f0-9]{64}$/.test(manifest.content_hash) ||
    !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !==
      Math.ceil(manifest.compressed_bytes / CHUNK_BYTES) ||
    manifest.chunks.some(
      (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw invalid();
  const chunks = [];
  for (const hash of manifest.chunks) {
    const [rows] = await db.execute(
      "SELECT payload FROM orbital_ray_cache_chunks WHERE content_hash=?",
      [hash],
    );
    const payload = rows[0]?.payload;
    if (
      !Buffer.isBuffer(payload) ||
      payload.length > CHUNK_BYTES ||
      digest(payload) !== hash
    )
      throw invalid();
    chunks.push(payload);
  }
  const zipped = Buffer.concat(chunks);
  if (zipped.length !== manifest.compressed_bytes) throw invalid();
  const raw = await decompress(zipped, {
    maxOutputLength: MAX_RAY_CACHE_BYTES,
  });
  if (
    raw.length !== manifest.raw_bytes ||
    digest(raw) !== manifest.content_hash
  )
    throw invalid();
  return JSON.parse(raw.toString());
};
