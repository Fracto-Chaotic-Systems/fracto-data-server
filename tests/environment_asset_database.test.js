import assert from "node:assert/strict";
import test from "node:test";
import {
  create_environment_asset_database,
  environment_asset_row,
  open_environment_asset_pool,
} from "../environment/database.js";

const record = {
  id: "test-grass",
  name: "Grass",
  version: "1.0.0",
  attribution: {
    creator_name: "Creator",
    source_url: "https://example.com/grass",
    license_name: "CC0",
    notes: "Review",
  },
  sources: [
    {
      path: "source/grass.fbx",
      format: "fbx",
      sha256: "a".repeat(64),
      private_extension: "excluded",
    },
  ],
  runtime: { path: "runtime/grass.glb", format: "glb" },
  history: [
    {
      date: "2026-11-22",
      action: "import",
      description: "Imported.",
      account: "excluded",
    },
  ],
  account: "excluded",
};

test("asset rows explicitly retain provenance, model references, checksums and history", () => {
  const row = environment_asset_row(record, "a".repeat(64));
  assert.equal(row.creator_name, "Creator");
  assert.equal(row.license_name, "CC0");
  assert.equal(row.credit_text, null);
  assert.equal(row.model_path, "runtime/grass.glb");
  assert.equal(row.record_path, "test-grass/asset.json");
  assert.equal(JSON.parse(row.sources)[0].sha256, "a".repeat(64));
  assert.equal(
    JSON.parse(row.modification_history)[0].description,
    "Imported.",
  );
  assert.ok(!JSON.stringify(row).includes("excluded"));
});

test(
  "MySQL registry retains edits and preserves timestamps on identical registrations",
  { skip: process.env.FRACTO_TEST_ENVIRONMENT_ASSET_DATABASE !== "1" },
  async () => {
    const pool = await open_environment_asset_pool();
    const connection = await pool.getConnection();
    try {
      // A connection-local copy exercises real column types without editing assets.
      await connection.query(
        "CREATE TEMPORARY TABLE environment_asset_registry_test LIKE environment_assets",
      );
      const registry = create_environment_asset_database({
        open: async () => ({
          execute: (sql, values) =>
            connection.execute(
              sql.replaceAll(
                "environment_assets",
                "environment_asset_registry_test",
              ),
              values,
            ),
        }),
      });
      await registry.sync(record, "a".repeat(64));
      const [initial] = await connection.query(
        "SELECT * FROM environment_asset_registry_test WHERE asset_id=?",
        [record.id],
      );
      await registry.sync(record, "a".repeat(64));
      const [repeated] = await connection.query(
        "SELECT * FROM environment_asset_registry_test WHERE asset_id=?",
        [record.id],
      );
      assert.equal(+initial[0].updated_at, +repeated[0].updated_at);
      const changed = structuredClone(record);
      changed.attribution.creator_name = "Updated creator";
      changed.history.push({
        date: "2026-11-22",
        action: "catalog-note",
        description: "Modified structure.",
      });
      await registry.sync(changed, "b".repeat(64));
      const [saved] = await connection.query(
        "SELECT * FROM environment_asset_registry_test WHERE asset_id=?",
        [record.id],
      );
      assert.equal(saved.length, 1);
      assert.equal(saved[0].creator_name, "Updated creator");
      assert.equal(saved[0].revision, "b".repeat(64));
      const history =
        typeof saved[0].modification_history === "string"
          ? JSON.parse(saved[0].modification_history)
          : saved[0].modification_history;
      assert.equal(history.at(-1).description, "Modified structure.");
      assert.equal(+saved[0].created_at, +initial[0].created_at);
      for (const category of ["component", "area"])
        await registry.sync(
          { ...record, id: "test-" + category, model_category: category },
          "c".repeat(64),
        );
      for (const category of ["material", "component", "area"]) {
        const page = await registry.list({ category });
        assert.equal(page.assets.length, 1);
        assert.equal(page.assets[0].category, category);
      }
    } finally {
      await connection.query(
        "DROP TEMPORARY TABLE IF EXISTS environment_asset_registry_test",
      );
      connection.release();
      await pool.end();
    }
  },
);

test("registry binds values, reuses connections and retries pool creation failures", async () => {
  let attempts = 0,
    closed = false;
  const queries = [];
  const registry = create_environment_asset_database({
    open: async () => {
      if (++attempts === 1) throw new Error("offline");
      return {
        execute: async (...args) => queries.push(args),
        end: async () => {
          closed = true;
        },
      };
    },
  });
  await assert.rejects(registry.sync(record, "a".repeat(64)), /offline/);
  await registry.sync(record, "a".repeat(64));
  await registry.sync(record, "a".repeat(64));
  assert.equal(attempts, 2);
  assert.equal(queries.length, 2);
  assert.match(queries[0][0], /ON DUPLICATE KEY UPDATE/);
  assert.ok(!queries[0][0].includes("Creator"));
  assert.ok(queries[0][1].includes("Creator"));
  await registry.close();
  assert.equal(closed, true);
});

test("all model categories query one table using bound filters and stable pagination", async () => {
  const calls = [];
  const registry = create_environment_asset_database({
    open: async () => ({
      execute: async (sql, params) => {
        calls.push({ sql, params });
        return [
          [
            {
              asset_id: "a",
              name: "A",
              model_category: params[1] || "material",
              model_path: null,
              model_format: null,
            },
            {
              asset_id: "b",
              name: "B",
              model_category: params[1] || "material",
              model_path: null,
              model_format: null,
            },
          ],
        ];
      },
    }),
  });
  for (const category of ["material", "component", "area"]) {
    const page = await registry.list({ category, limit: 1 });
    assert.equal(page.assets[0].category, category);
    assert.equal(page.next_cursor, "a");
    assert.deepEqual(calls.at(-1).params, ["", category]);
    assert.match(
      calls.at(-1).sql,
      /FROM environment_assets WHERE asset_id > \? AND model_category = \?/,
    );
  }
  await assert.rejects(
    registry.list({ category: "invalid" }),
    /invalid_record/,
  );
  await assert.rejects(registry.list({ limit: 201 }), /invalid_query/);
  await assert.rejects(registry.list({ after: "' OR 1=1" }), /invalid_query/);
  assert.equal(calls.length, 3);
});
