import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { MAX_RAY_CACHE_BYTES } from "../../../sdk/orbitals/FractoMinibrotRayCache.js";
const compress = promisify(gzip),
  decompress = promisify(gunzip);
/** Large geometry is compressed transparently inside the JSON column. */
export async function decode_ray_cache(value) {
  const cache = typeof value === "string" ? JSON.parse(value) : value;
  if (cache?.encoding !== "gzip-base64") return cache;
  const raw = await decompress(Buffer.from(cache.data, "base64"), {
    maxOutputLength: MAX_RAY_CACHE_BYTES,
  });
  return JSON.parse(raw.toString("utf8"));
}
export async function encode_ray_cache(cache) {
  const json = JSON.stringify(cache);
  if (Buffer.byteLength(json) > MAX_RAY_CACHE_BYTES)
    throw Object.assign(Error("Ray cache exceeds 96 MiB uncompressed"), {
      status: 413,
    });
  if (Buffer.byteLength(json) < 1024 * 1024) return json;
  const encoded = JSON.stringify({
    encoding: "gzip-base64",
    data: (await compress(json)).toString("base64"),
  });
  if (Buffer.byteLength(encoded) > 20 * 1024 * 1024)
    throw Object.assign(Error("Ray cache exceeds 20 MiB stored"), {
      status: 413,
    });
  return encoded;
}
