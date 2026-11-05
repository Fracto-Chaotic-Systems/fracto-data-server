import { createHash } from "node:crypto";
export class CorrectionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const fail = (code) => {
  throw new CorrectionError(code);
};
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  plain(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export const number = (value) =>
  Number.isInteger(value) && value > 0 && value <= 2147483647;
export const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const label = (value) => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value))
    fail("INVALID_DATASET");
};
const refs = (value) =>
  Array.isArray(value) && value.length <= 64 && value.every(number);
const sort = (value) =>
  Array.isArray(value)
    ? value.map(sort)
    : plain(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sort(value[key])]),
        )
      : value;
export const canonical = (value) => JSON.stringify(sort(value));
export const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const snapshot = (value) => {
  if (
    !exact(value, [
      "contract_version",
      "dataset_revision",
      "assets",
      "environments",
    ]) ||
    value.contract_version !== 1 ||
    !number(value.dataset_revision) ||
    !Array.isArray(value.assets) ||
    value.assets.length > 20000 ||
    !Array.isArray(value.environments) ||
    value.environments.length > 10000
  )
    fail("INVALID_SNAPSHOT");
  if (
    !value.assets.every(
      (row) =>
        exact(row, ["asset_id", "content_digest"]) &&
        number(row.asset_id) &&
        digest(row.content_digest),
    )
  )
    fail("INVALID_SNAPSHOT");
  if (
    !value.environments.every(
      (row) =>
        exact(row, ["environment_id", "revision", "asset_ids"]) &&
        number(row.environment_id) &&
        number(row.revision) &&
        refs(row.asset_ids),
    )
  )
    fail("INVALID_SNAPSHOT");
  if (
    value.environments.reduce((sum, row) => sum + row.asset_ids.length, 0) >
      250000 ||
    Buffer.byteLength(canonical(value)) > 8 * 1024 ** 2
  )
    fail("INVALID_SNAPSHOT");
  return value;
};
export const correction_request = (value) => {
  if (
    !exact(value, [
      "contract_version",
      "snapshot_digest",
      "dataset_revision",
      "proposal",
      "skill",
    ]) ||
    value.contract_version !== 1 ||
    !digest(value.snapshot_digest) ||
    !number(value.dataset_revision)
  )
    fail("INVALID_CORRECTION_REQUEST");
  const p = value.proposal,
    s = value.skill;
  if (
    !exact(p, [
      "kind",
      "environment_id",
      "expected_revision",
      "expected_asset_ids",
      "proposed_asset_ids",
      "proposal_digest",
    ]) ||
    p.kind !== "deduplicate_asset_references" ||
    !number(p.environment_id) ||
    !number(p.expected_revision) ||
    !refs(p.expected_asset_ids) ||
    !refs(p.proposed_asset_ids) ||
    !digest(p.proposal_digest)
  )
    fail("INVALID_CORRECTION_REQUEST");
  if (
    !exact(s, ["id", "version", "definition_digest", "executor_digest"]) ||
    s.id !== "environment-asset-quality" ||
    typeof s.version !== "string" ||
    !/^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/.test(
      s.version,
    ) ||
    !digest(s.definition_digest) ||
    !digest(s.executor_digest)
  )
    fail("INVALID_CORRECTION_REQUEST");
  const { proposal_digest, ...body } = p;
  if (
    hash({
      snapshot_digest: value.snapshot_digest,
      dataset_revision: value.dataset_revision,
      ...body,
    }) !== proposal_digest
  )
    fail("INVALID_PROPOSAL_DIGEST");
  return value;
};
export const verify_current = (data, request) => {
  snapshot(data);
  correction_request(request);
  if (
    hash(data) !== request.snapshot_digest ||
    data.dataset_revision !== request.dataset_revision
  )
    fail("STALE_DATASET");
  const proposal = request.proposal;
  const matches = data.environments
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.environment_id === proposal.environment_id);
  if (matches.length !== 1) fail("AMBIGUOUS_TARGET");
  const { row, index } = matches[0];
  if (
    row.revision !== proposal.expected_revision ||
    canonical(row.asset_ids) !== canonical(proposal.expected_asset_ids)
  )
    fail("STALE_ENVIRONMENT");
  const counts = new Map();
  for (const asset of data.assets)
    counts.set(asset.asset_id, (counts.get(asset.asset_id) ?? 0) + 1);
  if (row.asset_ids.some((id) => counts.get(id) !== 1))
    fail("INVALID_DEPENDENCY");
  const unique = [...new Set(row.asset_ids)];
  if (
    unique.length === row.asset_ids.length ||
    canonical(unique) !== canonical(proposal.proposed_asset_ids)
  )
    fail("UNSAFE_CORRECTION");
  if (row.revision > 2147483645 || data.dataset_revision > 2147483645)
    fail("REVISION_EXHAUSTED");
  return index;
};
