import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { ORBITAL_CALCULATION_VERSION } from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { SEED_SURVEY_RAY_OPTIONS } from "@fracto/sdk/orbitals/FractoDynamicRays.js";
import { MAX_SCAN_ORBITALS } from "@fracto/sdk/orbitals/FractoSeedSurveyScan.js";
import { hash, fail } from "./orbital_data_contract.js";

export const CHECKPOINT_VERSION = 1;
const signature = hash([
  CHECKPOINT_VERSION,
  ORBITAL_CALCULATION_VERSION,
  SEED_SURVEY_RAY_OPTIONS,
  MAX_SCAN_ORBITALS,
]);
const compress = promisify(gzip),
  decompress = promisify(gunzip);
const RAW_LIMIT = 64 * 1024 * 1024,
  COMPRESSED_LIMIT = 16 * 1024 * 1024 - 1;
export const initial_checkpoint = (input_hash = null) => ({
  version: CHECKPOINT_VERSION,
  signature,
  input_hash,
  stage: "survey",
  survey_rows: [],
  scan: { found: [], tested_pixels: [] },
  candidates: null,
  persist_index: 0,
  orbitals: [],
  ray_index: 0,
  ray_state: null,
  ray_result: null,
  limited: false,
  progress: { attempts: 0, orbital_count: 0, ratios: 0, ray_outcomes: {} },
});
export const encode_checkpoint = async (checkpoint) => {
  const json = Buffer.from(JSON.stringify(checkpoint));
  if (json.length > RAW_LIMIT) throw fail("checkpoint_size_limit", 409);
  const payload = await compress(json);
  if (payload.length > COMPRESSED_LIMIT)
    throw fail("checkpoint_size_limit", 409);
  return payload;
};
export const decode_checkpoint = async (payload) => {
  const checkpoint = JSON.parse(
    (await decompress(payload, { maxOutputLength: RAW_LIMIT })).toString(),
  );
  if (
    checkpoint.version !== CHECKPOINT_VERSION ||
    checkpoint.signature !== signature
  )
    throw fail("checkpoint_version_mismatch", 409);
  return checkpoint;
};
export const checkpoint_stage = (checkpoint) =>
  ({
    survey: "discovering",
    scan: "discovering",
    persisting: "persisting",
    rays: "calculating_rays",
    done: "persisting",
  })[checkpoint.stage];
