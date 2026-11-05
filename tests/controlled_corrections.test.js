import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { CorrectionStore } from "../corrections/storage.js";
import { hash, snapshot, correction_request } from "../corrections/contract.js";

const data = () => ({
  contract_version: 1,
  dataset_revision: 1,
  assets: [{ asset_id: 1, content_digest: "a".repeat(64) }],
  environments: [{ environment_id: 10, revision: 1, asset_ids: [1, 1] }],
});
const request = (input, environment_id = 10) => {
  const row = input.environments.find(
    (row) => row.environment_id === environment_id,
  );
  const snapshot_digest = hash(input),
    proposal = {
      kind: "deduplicate_asset_references",
      environment_id,
      expected_revision: row.revision,
      expected_asset_ids: [...row.asset_ids],
      proposed_asset_ids: [...new Set(row.asset_ids)],
    };
  return {
    contract_version: 1,
    snapshot_digest,
    dataset_revision: input.dataset_revision,
    proposal: {
      ...proposal,
      proposal_digest: hash({
        snapshot_digest,
        dataset_revision: input.dataset_revision,
        ...proposal,
      }),
    },
    skill: {
      id: "environment-asset-quality",
      version: "1.0.0",
      definition_digest: "b".repeat(64),
      executor_digest: "c".repeat(64),
    },
  };
};
const fixture = (t) => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "fracto-correction-test-"),
    ),
    opened = [];
  const open = (options = {}) => {
    const store = new CorrectionStore(path.join(directory, "owner"), options);
    opened.push(store);
    return store;
  };
  const store = open();
  t.after(() => {
    opened.forEach((item) => item.close());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, open, directory };
};

test("registered snapshot corrections require exact approval, commit audit atomically and survive reopen/retry", (t) => {
  const { store, open } = fixture(t),
    input = data();
  store.register("world", input);
  assert.equal(store.register("world", input).replayed, true);
  const preview = store.preview("world", request(input));
  assert.equal(preview.state, "prepared");
  assert.equal(preview.source_skill_attested, false);
  assert.throws(
    () => store.apply(preview.plan_digest),
    /CORRECTION_NOT_APPROVED/,
  );
  assert.throws(
    () => store.approve(preview.plan_digest, "0".repeat(64)),
    /INVALID_APPROVAL/,
  );
  store.approve(preview.plan_digest, hash(input));
  const applied = store.apply(preview.plan_digest),
    current = store.read("world");
  assert.equal(applied.state, "applied");
  assert.deepEqual(current.environments[0].asset_ids, [1]);
  assert.equal(current.dataset_revision, 2);
  assert.equal(current.environments[0].revision, 2);
  assert.deepEqual(
    store.audit("world").items.map((row) => row.event),
    ["registered", "prepared", "approved", "applied"],
  );
  assert.equal(hash(input), preview.request.snapshot_digest);
  assert.equal(
    store.apply(preview.plan_digest).after_digest,
    applied.after_digest,
  );
  assert.equal(store.audit("world").items.length, 4);
  store.close();
  const restored = open({ read_only: true });
  assert.deepEqual(restored.read("world"), current);
  assert.equal(restored.plan(preview.plan_digest).after_digest, hash(current));
});

test("owner independently rejects forged proposals, ambiguous targets, unknown fields and unsafe transformations", (t) => {
  const { store } = fixture(t),
    input = data();
  store.register("world", input);
  const forged = request(input);
  forged.proposal.proposed_asset_ids = [];
  assert.throws(
    () => store.preview("world", forged),
    /INVALID_PROPOSAL_DIGEST/,
  );
  const { proposal_digest, ...body } = forged.proposal;
  forged.proposal.proposal_digest = hash({
    snapshot_digest: forged.snapshot_digest,
    dataset_revision: 1,
    ...body,
  });
  assert.throws(() => store.preview("world", forged), /UNSAFE_CORRECTION/);
  const unknown = request(input);
  unknown.approved = true;
  assert.throws(
    () => correction_request(unknown),
    /INVALID_CORRECTION_REQUEST/,
  );
  const privateInput = data();
  privateInput.owner = "private";
  assert.throws(() => snapshot(privateInput), /INVALID_SNAPSHOT/);
  const ambiguous = data();
  ambiguous.assets.push({ ...ambiguous.assets[0] });
  store.register("ambiguous", ambiguous);
  assert.throws(
    () => store.preview("ambiguous", request(ambiguous)),
    /INVALID_DEPENDENCY/,
  );
  const duplicate = data();
  duplicate.environments.push({ ...duplicate.environments[0] });
  store.register("duplicate", duplicate);
  assert.throws(
    () => store.preview("duplicate", request(duplicate)),
    /AMBIGUOUS_TARGET/,
  );
  const stale = request(input);
  const exhausted = data();
  exhausted.dataset_revision = 2147483646;
  store.register("exhausted", exhausted);
  assert.throws(
    () => store.preview("exhausted", request(exhausted)),
    /REVISION_EXHAUSTED/,
  );
  const missing = data();
  missing.assets = [];
  store.register("missing", missing);
  assert.throws(
    () => store.preview("missing", request(missing)),
    /INVALID_DEPENDENCY/,
  );
  stale.proposal.expected_revision = 2;
  const { proposal_digest: ignored, ...staleBody } = stale.proposal;
  stale.proposal.proposal_digest = hash({
    snapshot_digest: stale.snapshot_digest,
    dataset_revision: 1,
    ...staleBody,
  });
  assert.throws(() => store.preview("world", stale), /STALE_ENVIRONMENT/);
});

test("approval does not override an intervening edit and rollback cannot overwrite another correction", (t) => {
  const { store } = fixture(t),
    input = data();
  input.environments.push({
    environment_id: 11,
    revision: 1,
    asset_ids: [1, 1],
  });
  store.register("world", input);
  const first = store.preview("world", request(input, 10)),
    second = store.preview("world", request(input, 11));
  store.approve(first.plan_digest, hash(input));
  store.approve(second.plan_digest, hash(input));
  store.apply(first.plan_digest);
  assert.throws(() => store.apply(second.plan_digest), /STALE_DATASET/);
  const updated = store.read("world"),
    fresh = store.preview("world", request(updated, 11));
  store.approve(fresh.plan_digest, hash(updated));
  store.approve_rollback(
    first.plan_digest,
    store.plan(first.plan_digest).after_digest,
  );
  store.apply(fresh.plan_digest);
  assert.throws(() => store.rollback(first.plan_digest), /STALE_DATASET/);
  assert.throws(
    () =>
      store.approve_rollback(
        first.plan_digest,
        store.plan(first.plan_digest).after_digest,
      ),
    /STALE_DATASET/,
  );
  assert.deepEqual(
    store.read("world").environments.map((row) => row.asset_ids),
    [[1], [1]],
  );
});

test("rollback has separate approval, restores original values with monotonic revisions and supports idempotent retry", (t) => {
  const { store } = fixture(t),
    input = data();
  store.register("world", input);
  const plan = store.preview("world", request(input));
  store.approve(plan.plan_digest, hash(input));
  const applied = store.apply(plan.plan_digest);
  assert.throws(
    () => store.rollback(plan.plan_digest),
    /ROLLBACK_NOT_APPROVED/,
  );
  store.approve_rollback(plan.plan_digest, applied.after_digest);
  const rolled = store.rollback(plan.plan_digest),
    restored = store.read("world");
  assert.equal(rolled.state, "rolled_back");
  assert.deepEqual(restored.environments[0].asset_ids, [1, 1]);
  assert.equal(restored.dataset_revision, 3);
  assert.equal(restored.environments[0].revision, 3);
  assert.notEqual(hash(restored), hash(input));
  assert.equal(
    store.rollback(plan.plan_digest).rollback_digest,
    hash(restored),
  );
  assert.throws(() => store.apply(plan.plan_digest), /CORRECTION_NOT_APPROVED/);
  assert.equal(store.audit("world").items.length, 6);
});

test("revoking apply and rollback approvals prevents mutation", (t) => {
  const { store } = fixture(t),
    input = data();
  store.register("world", input);
  const plan = store.preview("world", request(input));
  store.approve(plan.plan_digest, hash(input));
  store.revoke(plan.plan_digest);
  assert.throws(() => store.apply(plan.plan_digest), /CORRECTION_NOT_APPROVED/);
  store.approve(plan.plan_digest, hash(input));
  const applied = store.apply(plan.plan_digest);
  store.approve_rollback(plan.plan_digest, applied.after_digest);
  store.revoke(plan.plan_digest);
  assert.throws(
    () => store.rollback(plan.plan_digest),
    /ROLLBACK_NOT_APPROVED/,
  );
});

test("audit insertion failure rolls back both the proposed data change and application state", (t) => {
  const { store } = fixture(t),
    input = data();
  store.register("world", input);
  const plan = store.preview("world", request(input));
  store.approve(plan.plan_digest, hash(input));
  store.db.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON audit WHEN NEW.event='applied' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
  );
  assert.throws(() => store.apply(plan.plan_digest), /fixture audit failure/);
  assert.equal(hash(store.read("world")), hash(input));
  assert.equal(store.plan(plan.plan_digest).state, "approved");
  store.db.exec("DROP TRIGGER fail_audit");
  store.apply(plan.plan_digest);
  assert.equal(store.read("world").dataset_revision, 2);
});

test("concurrent plans, read-only handles, corruption and disk limits fail closed", (t) => {
  const { store, open } = fixture(t),
    input = data();
  store.register("world", input);
  const plan = store.preview("world", request(input));
  const other = open();
  store.approve(plan.plan_digest, hash(input));
  other.apply(plan.plan_digest);
  assert.equal(store.apply(plan.plan_digest).state, "applied");
  assert.equal(store.read("world").dataset_revision, 2);
  const read = open({ read_only: true });
  assert.throws(() => read.register("another", input), /CORRECTION_READ_ONLY/);
  store.free_disk = () => 0;
  assert.throws(() => store.register("another", input), /DISK_PRESSURE/);
  store.db.prepare("UPDATE datasets SET content='{}' WHERE id='world'").run();
  assert.throws(() => read.read("world"), /CORRUPT_DATASET/);
});

test("CLI registration copies rather than modifies source files and errors never reveal private paths", (t) => {
  const { directory, store } = fixture(t),
    file = path.join(directory, "source.json"),
    input = data();
  fs.writeFileSync(file, "\ufeff" + JSON.stringify(input));
  const options = {
    cwd: path.join(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, FRACTO_DATA_CORRECTION_DIR: store.directory },
  };
  const imported = spawnSync(
    process.execPath,
    ["corrections/cli.js", "import", "world", file],
    options,
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), "\ufeff" + JSON.stringify(input));
  const exported = spawnSync(
    process.execPath,
    ["corrections/cli.js", "export", "world"],
    options,
  );
  assert.deepEqual(JSON.parse(exported.stdout), input);
  const missing = spawnSync(
    process.execPath,
    ["corrections/cli.js", "export", "missing"],
    options,
  );
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DATASET_NOT_FOUND/);
  assert.equal(missing.stderr.includes(directory), false);
  store.db.exec("PRAGMA user_version=99");
  store.close();
  const unknown = spawnSync(
    process.execPath,
    ["corrections/cli.js", "export", "world"],
    options,
  );
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /UNKNOWN_CORRECTION_SCHEMA/);
});
