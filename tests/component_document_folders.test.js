import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { create_component_router } from "../components/routes.js";
import { create_component_database } from "../components/database.js";
import { create_environment_asset_database } from "../environment/database.js";
import { manage_model_folder } from "../environment/folders.js";

const recorder = (affectedRows = 1) => {
  const calls = [];
  return {
    calls,
    open: async () => ({
      async execute(sql, values) {
        calls.push({ sql, values });
        return [{ affectedRows }];
      },
    }),
  };
};

test("moving a component document stores only its folder and keeps the folder definition", async () => {
  const id = randomUUID();
  const db = recorder();
  const database = create_component_database({ open: db.open });
  assert.deepEqual(await database.move(id, " Vegetation / Grasses "), {
    id,
    folder_path: "Vegetation/Grasses",
  });
  assert.match(
    db.calls[0].sql,
    /^UPDATE component_documents SET folder_path = \? WHERE document_id = \?$/,
  );
  assert.deepEqual(db.calls[0].values, ["Vegetation/Grasses", id]);
  assert.match(
    db.calls[1].sql,
    /INSERT IGNORE INTO model_folders .*'component'/,
  );
  assert.deepEqual(db.calls[1].values, ["Vegetation/Grasses"]);
  assert.ok(db.calls.every((call) => !/revision|document_json/.test(call.sql)));

  db.calls.length = 0;
  assert.deepEqual(await database.move(id, ""), { id, folder_path: "" });
  assert.equal(db.calls.length, 1);

  db.calls.length = 0;
  for (const bad of ["../escape", "a:b", "a\\b", "a//b", 7])
    await assert.rejects(database.move(id, bad), /invalid_folder/);
  assert.equal(db.calls.length, 0);
  await assert.rejects(
    database.move("not-an-id", "a"),
    /invalid_component_document/,
  );

  const missing = recorder(0);
  await assert.rejects(
    create_component_database({ open: missing.open }).move(id, "a"),
    /component_not_found/,
  );
  assert.equal(missing.calls.length, 1);
});

test("documents list their folder; legacy rows without one are at the root", async () => {
  const id = randomUUID();
  const database = create_component_database({
    open: async () => ({
      async execute(sql) {
        assert.match(
          sql,
          /SELECT document_id, name, revision, folder_path FROM/,
        );
        return [
          [
            {
              document_id: id,
              name: "Grass strip",
              revision: 3,
              folder_path: "Plants",
            },
            { document_id: randomUUID(), name: "Legacy", revision: 1 },
          ],
        ];
      },
    }),
  });
  const { documents } = await database.list();
  assert.equal(documents[0].folder_path, "Plants");
  assert.equal(documents[1].folder_path, "");
});

test("PUT /:id/folder validates the body and maps folder errors", async (t) => {
  const moves = [];
  const app = express();
  app.use(
    "/documents",
    create_component_router({
      authorize: (req, res, next) => next(),
      database: {
        async move(id, folder_path) {
          if (folder_path === "../x") throw new Error("invalid_folder");
          if (folder_path === "missing") throw new Error("component_not_found");
          moves.push([id, folder_path]);
          return { id, folder_path };
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const id = randomUUID();
  const origin =
    process.env.FRACTO_UI_ORIGIN ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const send = (body, headers = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/documents/${id}/folder`, {
      method: "PUT",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const ok = await send({ folder_path: "Plants" });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id, folder_path: "Plants" });
  assert.equal((await send({ folder_path: "Plants", extra: 1 })).status, 400);
  assert.equal((await send({ folder_path: 3 })).status, 400);
  const invalid = await send({ folder_path: "../x" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_folder" });
  assert.equal((await send({ folder_path: "missing" })).status, 404);
  assert.equal(
    (
      await send(
        { folder_path: "Plants" },
        { Origin: "http://untrusted.invalid" },
      )
    ).status,
    403,
  );
  assert.deepEqual(moves, [[id, "Plants"]]);
});

test("component folder listing includes folders that hold authored documents", async () => {
  const queries = [];
  const registry = create_environment_asset_database({
    open: async () => ({
      async execute(sql, values) {
        queries.push({ sql, values });
        return [[{ folder_path: "Plants" }]];
      },
    }),
  });
  assert.deepEqual(await registry.folders("component"), {
    folders: ["Plants"],
  });
  assert.match(
    queries[0].sql,
    /UNION SELECT folder_path FROM component_documents WHERE folder_path <> ''/,
  );
  await registry.folders("material");
  assert.doesNotMatch(queries[1].sql, /component_documents/);
});

function folder_pool({ folders = [], assets = [], documents = [] }) {
  const calls = [];
  let committed = false,
    rolled_back = false;
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT folder_path FROM model_folders"))
        return [folders.map((folder_path) => ({ folder_path }))];
      if (sql.startsWith("SELECT folder_path FROM environment_assets"))
        return [assets.map((folder_path) => ({ folder_path }))];
      if (
        sql.startsWith(
          "SELECT document_id, folder_path FROM component_documents",
        )
      )
        return [documents];
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {
      committed = true;
    },
    rollback: async () => {
      rolled_back = true;
    },
    release() {},
  };
  return {
    calls,
    state: () => ({ committed, rolled_back }),
    pool: { getConnection: async () => connection },
  };
}

test("component folders cannot be deleted while they hold documents", async () => {
  const f = folder_pool({
    folders: ["Plants"],
    documents: [{ document_id: "d1", folder_path: "Plants" }],
  });
  await assert.rejects(
    manage_model_folder(f.pool, {
      action: "delete-folder",
      category: "component",
      folder_path: "Plants",
    }),
    /folder_not_empty/,
  );
  assert.equal(f.state().rolled_back, true);
  assert.ok(!f.calls.some((call) => call.sql.startsWith("DELETE")));
});

test("renaming a component folder moves its documents in the same transaction", async () => {
  const f = folder_pool({
    folders: ["Plants", "Plants/Herbs"],
    documents: [
      { document_id: "d1", folder_path: "Plants/Herbs" },
      { document_id: "d2", folder_path: "Plants" },
      { document_id: "d3", folder_path: "Plantsy" },
    ],
  });
  assert.deepEqual(
    await manage_model_folder(f.pool, {
      action: "rename-folder",
      category: "component",
      folder_path: "Plants",
      name: "Flora",
    }),
    { folder_path: "Plants", target: "Flora" },
  );
  const moved = f.calls
    .filter((call) => call.sql.startsWith("UPDATE component_documents"))
    .map((call) => call.values);
  assert.deepEqual(moved, [
    ["Flora/Herbs", "d1"],
    ["Flora", "d2"],
  ]);
  assert.equal(f.state().committed, true);
});

test("material folders never read component documents", async () => {
  const f = folder_pool({ folders: ["Plants"] });
  await manage_model_folder(f.pool, {
    action: "delete-folder",
    category: "material",
    folder_path: "Plants",
  });
  assert.ok(!f.calls.some((call) => call.sql.includes("component_documents")));
});
