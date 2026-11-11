import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { ORBITAL_CALCULATION_VERSION } from "@fracto/sdk/orbitals/FractoOrbitalIdentity.js";
import { SEED_SURVEY_RAY_OPTIONS } from "@fracto/sdk/orbitals/FractoDynamicRays.js";
import { MAX_SCAN_ORBITALS } from "@fracto/sdk/orbitals/FractoSeedSurveyScan.js";
import { hash, fail } from "./orbital_data_contract.js";
import { CATALOG_ORBITAL_DISCOVERY_VERSION } from "@fracto/sdk/orbitals/FractoCatalogOrbitalDiscovery.js";
import { DENOMINATOR_CATALOG_VERSION } from "@fracto/sdk/orbitals/FractoDenominatorCatalog.js";
import {
  ORBITAL_DISCOVERY_STRATEGIES,
  stored_discovery_strategy,
  catalog_only_strategy,
} from "@fracto/sdk/orbitals/FractoOrbitalLifecycle.js";

export const CHECKPOINT_VERSION = 2;
export const CATALOG_ONLY_CHECKPOINT_VERSION = 3;
const legacy_signature = hash([
  1,
  ORBITAL_CALCULATION_VERSION,
  SEED_SURVEY_RAY_OPTIONS,
  MAX_SCAN_ORBITALS,
]);
const signature = hash([
  legacy_signature,
  CHECKPOINT_VERSION,
  CATALOG_ORBITAL_DISCOVERY_VERSION,
  DENOMINATOR_CATALOG_VERSION,
]);
const compress = promisify(gzip),
  compact_signature = hash([
    signature,
    CATALOG_ONLY_CHECKPOINT_VERSION,
    catalog_only_strategy,
    "catalog-representative-assignments-v1",
  ]),
  decompress = promisify(gunzip);
const RAW_LIMIT = 64 * 1024 * 1024,
  COMPRESSED_LIMIT = 16 * 1024 * 1024 - 1;
export const bind_checkpoint_strategy = (checkpoint, settings) => {
  const expected = stored_discovery_strategy(settings);
  const compact = expected === ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY;
  if (
    checkpoint.version !==
      (compact ? CATALOG_ONLY_CHECKPOINT_VERSION : CHECKPOINT_VERSION) ||
    checkpoint.signature !== (compact ? compact_signature : signature)
  )
    throw fail("checkpoint_strategy_mismatch", 409);
  if (
    checkpoint.discovery_strategy != null &&
    checkpoint.discovery_strategy !== expected
  )
    throw fail("checkpoint_strategy_mismatch", 409);
  checkpoint.discovery_strategy = expected;
  return checkpoint;
};
export const initial_checkpoint = (input_hash = null, settings = null) => {
  const compact =
    settings &&
    stored_discovery_strategy(settings) ===
      ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY;
  return {
    version: compact ? CATALOG_ONLY_CHECKPOINT_VERSION : CHECKPOINT_VERSION,
    signature: compact ? compact_signature : signature,
    input_hash,
    discovery_strategy: settings ? stored_discovery_strategy(settings) : null,
    stage: compact ? "catalog" : "survey",
    survey_rows: compact ? null : [],
    scan: compact ? null : { found: [], tested_pixels: [] },
    candidates: null,
    persist_index: 0,
    orbitals: [],
    ray_index: 0,
    ray_state: null,
    ray_result: null,
    limited: false,
    catalog: null,
    progress: { attempts: 0, orbital_count: 0, ratios: 0, ray_outcomes: {} },
  };
};
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
  if (checkpoint.version === 1 && checkpoint.signature === legacy_signature)
    return {
      ...checkpoint,
      version: CHECKPOINT_VERSION,
      signature,
      catalog: null,
    };
  if (
    checkpoint.version !== CHECKPOINT_VERSION ||
    checkpoint.signature !== signature
  ) {
    if (
      checkpoint.version === CATALOG_ONLY_CHECKPOINT_VERSION &&
      checkpoint.signature === compact_signature &&
      checkpoint.discovery_strategy ===
        ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY
    )
      return checkpoint;
    throw fail("checkpoint_version_mismatch", 409);
  }
  return checkpoint;
};
export const checkpoint_stage = (checkpoint) =>
  ({
    survey: "discovering",
    scan: "discovering",
    persisting: "persisting",
    rays: "calculating_rays",
    catalog: "discovering",
    catalog_finalize: "persisting",
    done: "persisting",
  })[checkpoint.stage];
