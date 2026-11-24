import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { create_component_document } from "@fracto/sdk/FractoComponentDocument.js";
import { create_component_router } from "../components/routes.js";
import { create_component_database } from "../components/database.js";
import { open_environment_asset_pool } from "../environment/database.js";
import { construction_builds } from "@fracto/sdk/testing/ConstructionBuilds.js";
import { construction_instances } from "@fracto/sdk/testing/ConstructionMetrics.js";
import { apply_component_commands } from "@fracto/sdk/FractoComponentTools.js";
import { component_document_json } from "@fracto/sdk/FractoComponentDocument.js";

test(
  "representative build documents persist/reopen with exact transforms and stale-save protection in MySQL",
  { skip: process.env.FRACTO_TEST_COMPONENT_DATABASE !== "1" },
  async () => {
    const pool = await open_environment_asset_pool(),
      connection = await pool.getConnection();
    try {
      await connection.query(
        "CREATE TEMPORARY TABLE component_build_evaluation LIKE component_documents",
      );
      const open = async () => ({
        execute: (sql, values) =>
          connection.execute(
            sql.replaceAll("component_documents", "component_build_evaluation"),
            values,
          ),
      });
      const { materials, builds } = construction_builds(randomUUID);
      for (const build of builds) {
        const document = {
            ...apply_component_commands(build.base, build.commands, materials),
            id: randomUUID(),
          },
          first = create_component_database({ open });
        await first.save(document, 0);
        const second = create_component_database({ open }),
          loaded = await second.load(document.id);
        assert.equal(
          component_document_json(loaded.document),
          component_document_json(document),
          build.id,
        );
        const signature = (snapshot) =>
          JSON.stringify(
            construction_instances(snapshot, materials).map(
              ({ asset, position, rotation, scale }) => [
                asset.id,
                asset.revision,
                position,
                rotation,
                scale,
              ],
            ),
          );
        assert.equal(signature(loaded.document), signature(document), build.id);
        const changed = { ...document, name: `${document.name} revised` };
        await second.save(changed, 1);
        await assert.rejects(first.save(document, 1), /component_conflict/);
        assert.equal(
          component_document_json((await first.load(document.id)).document),
          component_document_json(changed),
          build.id,
        );
      }
    } finally {
      connection.release();
      await pool.end();
    }
  },
);

test("component API authorizes before parsing, enforces origin/schema and preserves conflicts", async (t) => {
  let record = null,
    writes = 0,
    unavailable = false;
  const app = express();
  app.use(
    "/documents",
    create_component_router({
      authorize(req, res, next) {
        if (req.get("X-Test-Token") !== "allowed") return res.sendStatus(403);
        next();
      },
      database: {
        async list() {
          return {
            documents: record
              ? [
                  {
                    id: record.document.id,
                    name: record.document.name,
                    revision: record.revision,
                  },
                ]
              : [],
            next_cursor: null,
          };
        },
        async load() {
          if (!record) throw new Error("component_not_found");
          return record;
        },
        async save(document, expected_revision) {
          writes++;
          if (unavailable) throw new Error("private SQL credentials");
          if ((record?.revision || 0) !== expected_revision)
            throw new Error("component_conflict");
          return (record = { document, revision: expected_revision + 1 });
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const document = create_component_document(randomUUID(), "Path");
  document.animation_speed = 0.25;
  const root = `http://127.0.0.1:${server.address().port}/documents`;
  const origin =
    process.env.FRACTO_UI_ORIGIN ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const headers = {
    "X-Test-Token": "allowed",
    Origin: origin,
    "Content-Type": "application/json",
  };
  const send = (body, overrides = {}) =>
    fetch(`${root}/${document.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
      ...overrides,
    });
  assert.equal(
    (
      await send(
        {},
        { headers: { "Content-Type": "application/json" }, body: "{" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send(
        {},
        { headers: { ...headers, Origin: "http://untrusted.invalid" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send({
        document: { ...document, account_id: "excluded" },
        expected_revision: 0,
      })
    ).status,
    400,
  );
  assert.equal((await send({ document, expected_revision: -1 })).status, 400);
  assert.equal(writes, 0);
  assert.equal(
    (await fetch(`${root}/${document.id}`, { headers })).status,
    404,
  );
  const saved = await send({ document, expected_revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await saved.json(), { document, revision: 1 });
  assert.equal(
    (
      await send({
        document: { ...document, name: "Stale" },
        expected_revision: 0,
      })
    ).status,
    409,
  );
  assert.deepEqual(
    await (await fetch(`${root}/${document.id}`, { headers })).json(),
    { document, revision: 1 },
  );
  assert.equal((await fetch(`${root}?after=invalid`, { headers })).status, 400);
  unavailable = true;
  const failure = await send({ document, expected_revision: 1 });
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "component_unavailable" });
});

test("database writes use atomic expected revisions and bound document values", async () => {
  const calls = [];
  let affectedRows = 1,
    duplicate = false;
  const database = create_component_database({
    open: async () => ({
      async execute(sql, values) {
        calls.push({ sql, values });
        if (duplicate)
          throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        return [{ affectedRows }];
      },
    }),
  });
  const document = create_component_document(randomUUID(), "A 'quoted' path");
  assert.equal((await database.save(document, 0)).revision, 1);
  assert.ok(!calls[0].sql.includes(document.name));
  assert.ok(calls[0].values.includes(document.name));
  await database.save(document, 1);
  assert.match(calls[1].sql, /WHERE document_id = \? AND revision = \?/);
  assert.deepEqual(calls[1].values.slice(-2), [document.id, 1]);
  affectedRows = 0;
  await assert.rejects(database.save(document, 1), /component_conflict/);
  duplicate = true;
  await assert.rejects(database.save(document, 0), /component_conflict/);
  await assert.rejects(database.list("invalid"), /invalid_component_document/);
});

test(
  "MySQL saves survive a new repository instance and stale writers cannot overwrite",
  { skip: process.env.FRACTO_TEST_COMPONENT_DATABASE !== "1" },
  async () => {
    const pool = await open_environment_asset_pool();
    const connection = await pool.getConnection();
    try {
      await connection.query(
        "CREATE TEMPORARY TABLE component_document_test LIKE component_documents",
      );
      const open = async () => ({
        execute: (sql, values) =>
          connection.execute(
            sql.replaceAll("component_documents", "component_document_test"),
            values,
          ),
      });
      const first = create_component_database({ open });
      const document = create_component_document(randomUUID(), "Saved path");
      document.floor = {
        asset: { id: "dirt", revision: "a".repeat(64) },
        size: [4, 12],
        texture_repeat: [2, 6],
        texture_file: "dirt.png",
      };
      document.objects = [
        {
          id: randomUUID(),
          asset: { id: "tree", revision: "b".repeat(64) },
          position: [2, 0, 1],
          rotation: [0, 1, 0],
          scale: [1, 1, 1],
          group_id: null,
        },
      ];
      document.scatters = [
        {
          id: randomUUID(),
          asset: { id: "tree", revision: "b".repeat(64) },
          seed: 1,
          count: 2,
          bounds: [-10, -10, 10, 10],
          exclusions: [],
          scale: [1, 1],
          group_id: null,
          algorithm: "footprint-xz-v1",
        },
      ];
      await first.save(document, 0);
      const reopened = create_component_database({ open });
      assert.deepEqual(await reopened.load(document.id), {
        document,
        revision: 1,
      });
      const changed = { ...document, name: "Changed path" };
      await reopened.save(changed, 1);
      await assert.rejects(
        first.save({ ...document, name: "Stale" }, 1),
        /component_conflict/,
      );
      await assert.rejects(first.save(document, 0), /component_conflict/);
      assert.deepEqual(await first.load(document.id), {
        document: changed,
        revision: 2,
      });
      const listed = await reopened.list();
      assert.deepEqual(listed.documents, [
        { id: document.id, name: changed.name, revision: 2 },
      ]);
      assert.equal(listed.next_cursor, null);
    } finally {
      connection.release();
      await pool.end();
    }
  },
);

test(
  "deployed component API saves and reopens through the UI proxy",
  { skip: !process.env.FRACTO_TEST_COMPONENT_LIVE_URL },
  async () => {
    const base = process.env.FRACTO_TEST_COMPONENT_LIVE_URL;
    const document = create_component_document(
      randomUUID(),
      "Component persistence integration fixture",
    );
    document.floor = {
      asset: null,
      texture_file: null,
      size: [4, 12],
      texture_repeat: [1, 1],
    };
    const changed = {
      ...document,
      name: "Component persistence integration fixture revised",
    };
    const headers = {
      "Content-Type": "application/json",
      Origin: process.env.FRACTO_UI_ORIGIN || "http://localhost:3106",
    };
    const send = (snapshot, expected_revision) =>
      fetch(`${base}/${document.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ document: snapshot, expected_revision }),
        signal: AbortSignal.timeout(15000),
      });
    const pool = await open_environment_asset_pool();
    try {
      const created = await send(document, 0);
      assert.equal(created.status, 200);
      assert.deepEqual(await created.json(), { document, revision: 1 });
      const updated = await send(changed, 1);
      assert.equal(updated.status, 200);
      assert.deepEqual(await updated.json(), {
        document: changed,
        revision: 2,
      });
      assert.equal((await send(document, 1)).status, 409);
      const reopened = await fetch(`${base}/${document.id}`, {
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(reopened.status, 200);
      assert.deepEqual(await reopened.json(), {
        document: changed,
        revision: 2,
      });
    } finally {
      // Remove only this test's fresh UUID, known fixture names and revisions.
      await pool.execute(
        "DELETE FROM component_documents WHERE document_id = ? AND name IN (?, ?) AND revision IN (1, 2)",
        [document.id, document.name, changed.name],
      );
      await pool.end();
    }
  },
);
