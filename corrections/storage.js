import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  fail,
  label,
  digest,
  canonical,
  hash,
  snapshot,
  correction_request,
  verify_current,
} from "./contract.js";

const regular = (file) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("INVALID_CORRECTION_FILE");
  return stat;
};
export class CorrectionStore {
  constructor(
    directory,
    {
      read_only = false,
      free_disk = () => {
        const stat = fs.statfsSync(directory);
        return Number(stat.bavail) * Number(stat.bsize);
      },
    } = {},
  ) {
    this.directory = path.resolve(directory);
    this.read_only = read_only;
    this.free_disk = free_disk;
    try {
      if (!read_only)
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        fail("INVALID_CORRECTION_FILE");
      if (!read_only) {
        if (process.platform === "win32") {
          const result = spawnSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-File",
              path.join(import.meta.dirname, "secure_directory.ps1"),
              "-Directory",
              this.directory,
            ],
            { stdio: "ignore", windowsHide: true, timeout: 15000 },
          );
          if (result.status !== 0) fail("CORRECTION_STORAGE_UNAVAILABLE");
        } else fs.chmodSync(this.directory, 0o700);
      }
      const file = path.join(this.directory, "corrections.sqlite");
      for (const suffix of ["", "-journal", "-wal", "-shm"])
        if (fs.existsSync(file + suffix)) regular(file + suffix);
      if (read_only) regular(file);
      this.db = new DatabaseSync(file, { readOnly: read_only });
      this.db.exec("PRAGMA busy_timeout=2000");
      if (read_only) {
        this.db.exec("PRAGMA query_only=ON");
        if (this.db.prepare("PRAGMA user_version").get().user_version !== 1)
          fail("UNKNOWN_CORRECTION_SCHEMA");
        return;
      }
      if (process.platform !== "win32") fs.chmodSync(file, 0o600);
      this.db.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=32768",
      );
      this.transaction(() => {
        if (
          ![0, 1].includes(
            this.db.prepare("PRAGMA user_version").get().user_version,
          )
        )
          fail("UNKNOWN_CORRECTION_SCHEMA");
        this.db
          .exec(`CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY, content TEXT NOT NULL, digest TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS plans(digest TEXT PRIMARY KEY,dataset TEXT NOT NULL,request TEXT NOT NULL,state TEXT NOT NULL,after_digest TEXT,rollback_digest TEXT,created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,dataset TEXT NOT NULL,plan TEXT,event TEXT NOT NULL,before_digest TEXT,after_digest TEXT,revision INTEGER NOT NULL,at INTEGER NOT NULL);
          PRAGMA user_version=1;`);
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }
  transaction(operation) {
    if (this.read_only) fail("CORRECTION_READ_ONLY");
    if (this.free_disk() < 1024 ** 3) fail("DISK_PRESSURE");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
  event(dataset, plan, event, before, after, revision) {
    if (this.db.prepare("SELECT count(*) AS n FROM audit").get().n >= 10000)
      fail("AUDIT_CAPACITY");
    this.db
      .prepare(
        "INSERT INTO audit(dataset,plan,event,before_digest,after_digest,revision,at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(dataset, plan, event, before, after, revision, Date.now());
  }
  register(id, data) {
    label(id);
    snapshot(data);
    return this.transaction(() => {
      const old = this.db
        .prepare("SELECT digest FROM datasets WHERE id=?")
        .get(id);
      if (old) {
        if (old.digest !== hash(data)) fail("DATASET_EXISTS");
        this.read(id);
        return { id, digest: old.digest, replayed: true };
      }
      if (this.db.prepare("SELECT count(*) AS n FROM datasets").get().n >= 16)
        fail("DATASET_CAPACITY");
      const checksum = hash(data);
      this.db
        .prepare("INSERT INTO datasets VALUES(?,?,?)")
        .run(id, canonical(data), checksum);
      this.event(id, null, "registered", null, checksum, data.dataset_revision);
      return { id, digest: checksum, replayed: false };
    });
  }
  read(id) {
    label(id);
    const row = this.db.prepare("SELECT * FROM datasets WHERE id=?").get(id);
    if (!row) fail("DATASET_NOT_FOUND");
    if (Buffer.byteLength(row.content) > 8 * 1024 ** 2) fail("CORRUPT_DATASET");
    let data;
    try {
      data = snapshot(JSON.parse(row.content));
    } catch {
      fail("CORRUPT_DATASET");
    }
    if (hash(data) !== row.digest) fail("CORRUPT_DATASET");
    return data;
  }
  plan(checksum) {
    if (!digest(checksum)) fail("INVALID_PLAN");
    const row = this.db
      .prepare("SELECT * FROM plans WHERE digest=?")
      .get(checksum);
    if (!row) fail("PLAN_NOT_FOUND");
    let request;
    try {
      if (Buffer.byteLength(row.request) > 16384) throw new Error();
      request = correction_request(JSON.parse(row.request));
    } catch {
      fail("CORRUPT_PLAN");
    }
    if (hash({ dataset: row.dataset, request }) !== checksum)
      fail("CORRUPT_PLAN");
    if (
      ![
        "prepared",
        "approved",
        "applied",
        "rollback_approved",
        "rolled_back",
      ].includes(row.state)
    )
      fail("CORRUPT_PLAN");
    if (
      ["applied", "rollback_approved", "rolled_back"].includes(row.state) &&
      !digest(row.after_digest)
    )
      fail("CORRUPT_PLAN");
    if (row.state === "rolled_back" && !digest(row.rollback_digest))
      fail("CORRUPT_PLAN");
    return {
      plan_digest: row.digest,
      dataset: row.dataset,
      state: row.state,
      request,
      after_digest: row.after_digest,
      rollback_digest: row.rollback_digest,
      created_at: row.created_at,
      source_skill_attested: false,
    };
  }
  preview(id, request) {
    label(id);
    correction_request(request);
    if (Buffer.byteLength(canonical(request)) > 16384)
      fail("INVALID_CORRECTION_REQUEST");
    return this.transaction(() => {
      const checksum = hash({ dataset: id, request });
      if (
        this.db.prepare("SELECT digest FROM plans WHERE digest=?").get(checksum)
      )
        return this.plan(checksum);
      const data = this.read(id);
      verify_current(data, request);
      if (this.db.prepare("SELECT count(*) AS n FROM plans").get().n >= 1000)
        fail("PLAN_CAPACITY");
      this.db
        .prepare("INSERT INTO plans VALUES(?,?,?,'prepared',NULL,NULL,?)")
        .run(checksum, id, canonical(request), Date.now());
      this.event(
        id,
        checksum,
        "prepared",
        request.snapshot_digest,
        null,
        data.dataset_revision,
      );
      return this.plan(checksum);
    });
  }
  approve(checksum, reviewed_digest) {
    if (!digest(reviewed_digest)) fail("INVALID_APPROVAL");
    return this.transaction(() => {
      const plan = this.plan(checksum);
      if (!["prepared", "approved"].includes(plan.state))
        fail("INVALID_PLAN_STATE");
      if (reviewed_digest !== plan.request.snapshot_digest)
        fail("INVALID_APPROVAL");
      const data = this.read(plan.dataset);
      verify_current(data, plan.request);
      if (plan.state === "prepared") {
        this.db
          .prepare("UPDATE plans SET state='approved' WHERE digest=?")
          .run(checksum);
        this.event(
          plan.dataset,
          checksum,
          "approved",
          reviewed_digest,
          null,
          data.dataset_revision,
        );
      }
      return this.plan(checksum);
    });
  }
  apply(checksum) {
    return this.transaction(() => {
      const plan = this.plan(checksum);
      if (["applied", "rollback_approved"].includes(plan.state))
        return this.plan(checksum);
      if (plan.state !== "approved") fail("CORRECTION_NOT_APPROVED");
      const data = this.read(plan.dataset),
        index = verify_current(data, plan.request);
      data.environments[index].asset_ids = [
        ...plan.request.proposal.proposed_asset_ids,
      ];
      data.environments[index].revision++;
      data.dataset_revision++;
      snapshot(data);
      const after = hash(data);
      this.db
        .prepare("UPDATE datasets SET content=?,digest=? WHERE id=?")
        .run(canonical(data), after, plan.dataset);
      this.db
        .prepare(
          "UPDATE plans SET state='applied',after_digest=? WHERE digest=?",
        )
        .run(after, checksum);
      this.event(
        plan.dataset,
        checksum,
        "applied",
        plan.request.snapshot_digest,
        after,
        data.dataset_revision,
      );
      return this.plan(checksum);
    });
  }
  approve_rollback(checksum, reviewed_digest) {
    if (!digest(reviewed_digest)) fail("INVALID_APPROVAL");
    return this.transaction(() => {
      const plan = this.plan(checksum);
      if (!["applied", "rollback_approved"].includes(plan.state))
        fail("INVALID_PLAN_STATE");
      if (plan.after_digest !== reviewed_digest) fail("INVALID_APPROVAL");
      const data = this.read(plan.dataset);
      if (hash(data) !== reviewed_digest) fail("STALE_DATASET");
      if (plan.state === "applied") {
        this.db
          .prepare("UPDATE plans SET state='rollback_approved' WHERE digest=?")
          .run(checksum);
        this.event(
          plan.dataset,
          checksum,
          "rollback_approved",
          reviewed_digest,
          null,
          data.dataset_revision,
        );
      }
      return this.plan(checksum);
    });
  }
  rollback(checksum) {
    return this.transaction(() => {
      const plan = this.plan(checksum);
      if (plan.state === "rolled_back") return plan;
      if (plan.state !== "rollback_approved") fail("ROLLBACK_NOT_APPROVED");
      const data = this.read(plan.dataset);
      if (hash(data) !== plan.after_digest) fail("STALE_DATASET");
      const row = data.environments.find(
        (row) => row.environment_id === plan.request.proposal.environment_id,
      );
      if (
        !row ||
        row.revision !== plan.request.proposal.expected_revision + 1 ||
        canonical(row.asset_ids) !==
          canonical(plan.request.proposal.proposed_asset_ids)
      )
        fail("STALE_ENVIRONMENT");
      row.asset_ids = [...plan.request.proposal.expected_asset_ids];
      row.revision++;
      data.dataset_revision++;
      snapshot(data);
      const after = hash(data);
      this.db
        .prepare("UPDATE datasets SET content=?,digest=? WHERE id=?")
        .run(canonical(data), after, plan.dataset);
      this.db
        .prepare(
          "UPDATE plans SET state='rolled_back',rollback_digest=? WHERE digest=?",
        )
        .run(after, checksum);
      this.event(
        plan.dataset,
        checksum,
        "rolled_back",
        plan.after_digest,
        after,
        data.dataset_revision,
      );
      return this.plan(checksum);
    });
  }
  revoke(checksum) {
    return this.transaction(() => {
      const plan = this.plan(checksum);
      if (!["approved", "rollback_approved"].includes(plan.state))
        fail("INVALID_PLAN_STATE");
      this.db
        .prepare("UPDATE plans SET state=? WHERE digest=?")
        .run(plan.state === "approved" ? "prepared" : "applied", checksum);
      this.event(
        plan.dataset,
        checksum,
        "revoked",
        hash(this.read(plan.dataset)),
        null,
        this.read(plan.dataset).dataset_revision,
      );
      return this.plan(checksum);
    });
  }
  audit(id, after = 0) {
    label(id);
    if (!Number.isSafeInteger(after) || after < 0) fail("INVALID_CURSOR");
    const rows = this.db
      .prepare(
        "SELECT * FROM audit WHERE dataset=? AND sequence>? ORDER BY sequence LIMIT 101",
      )
      .all(id, after);
    return {
      items: rows.slice(0, 100),
      next_cursor: rows.length > 100 ? rows[99].sequence : null,
    };
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
