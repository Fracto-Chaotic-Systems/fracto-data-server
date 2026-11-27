import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { create_component_document } from "@fracto/sdk/FractoComponentDocument.js";
import { create_component_router } from "../components/routes.js";
import { create_component_database } from "../components/database.js";
import {
  summarize_component_change,
  folder_move_entry,
  validate_edit_notes,
} from "../components/history.js";

const object = (id = randomUUID()) => ({
  id,
  asset: { id: "yard-grass", revision: "r1" },
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  group_id: null,
});

test("history summaries describe what a save changed", () => {
  const before = create_component_document(randomUUID(), "Grass strip");
  before.objects = [
    object("a1b2c3d4-0000-4000-8000-000000000001"),
    object("a1b2c3d4-0000-4000-8000-000000000002"),
  ];
  assert.deepEqual(summarize_component_change(null, before), {
    action: "create-component",
    description:
      'Created "Grass strip" with 2 placed objects and 0 scatter rules.',
  });
  assert.deepEqual(summarize_component_change(before, { ...before }), {
    action: "update-component",
    description: "Saved without changes.",
  });
  assert.deepEqual(
    summarize_component_change(before, { ...before, name: "Meadow" }),
    {
      action: "rename-component",
      description: 'Renamed "Grass strip" to "Meadow".',
    },
  );
  const after = structuredClone(before);
  after.objects[0].scale = [2, 2, 2];
  after.objects.splice(1, 1);
  after.objects.push(object(), object(), object());
  after.floor = {
    asset: { id: "dry-dirt", revision: "r1" },
    size: [1, 20],
    texture_repeat: [1, 20],
  };
  after.lighting = { direction_degrees: 90, intensity: 2 };
  after.construction_description = "# Grass";
  assert.deepEqual(summarize_component_change(before, after), {
    action: "update-component",
    description:
      "Added 3 placed objects; removed 1 placed object; changed 1 placed object; added a floor; changed the lighting; updated the construction document.",
  });
  assert.deepEqual(
    summarize_component_change(before, { ...before, name: "Meadow" }, [
      "placed 30 × yard-grass",
      "adjusted the lighting",
    ]),
    {
      action: "update-component",
      description:
        'Placed 30 × yard-grass; adjusted the lighting. Renamed "Grass strip" to "Meadow".',
    },
  );
  assert.equal(
    summarize_component_change(null, before, ["placed 2 × yard-grass"])
      .description,
    'Placed 2 × yard-grass. Created "Grass strip" with 2 placed objects and 0 scatter rules.',
  );
  assert.equal(
    summarize_component_change(before, before, Array(20).fill("x".repeat(200)))
      .description.length,
    1000,
  );
  assert.deepEqual(folder_move_entry(""), {
    action: "move-folder",
    description: "Moved to the category root.",
  });
});

test("edit notes are optional, bounded strings", () => {
  assert.deepEqual(validate_edit_notes(undefined), []);
  assert.deepEqual(validate_edit_notes([" removed 2 items "]), [
    "removed 2 items",
  ]);
  for (const bad of [
    "placed",
    [1],
    [""],
    ["  "],
    ["x".repeat(201)],
    ["line\nbreak"],
    Array(21).fill("x"),
  ])
    assert.throws(() => validate_edit_notes(bad), /invalid_component_document/);
});

test("database history appends entries and lists them newest first", async () => {
  const calls = [];
  const id = randomUUID();
  const database = create_component_database({
    open: async () => ({
      async execute(sql, values) {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT"))
          return [
            [
              {
                revision: 2,
                recorded_at: new Date("2026-11-27T15:04:05Z"),
                action: "update-component",
                description: "Changed the lighting.",
              },
            ],
          ];
        return [{ affectedRows: 1 }];
      },
    }),
  });
  await database.record_history(id, 2, {
    action: "update-component",
    description: "x".repeat(1200),
  });
  assert.match(calls[0].sql, /^INSERT INTO component_document_history/);
  assert.deepEqual(calls[0].values.slice(0, 3), [id, 2, "update-component"]);
  assert.equal(calls[0].values[3].length, 1000);
  assert.deepEqual(await database.history(id), {
    history: [
      {
        date: "2026-11-27",
        recorded_at: "2026-11-27T15:04:05.000Z",
        revision: 2,
        action: "update-component",
        description: "Changed the lighting.",
      },
    ],
  });
  assert.match(calls[1].sql, /ORDER BY history_id DESC LIMIT 200/);
  await assert.rejects(database.history("bad"), /invalid_component_document/);
});

test("saves record create/update history; history failures never fail a save", async (t) => {
  const documents = new Map(),
    histories = [];
  let history_down = false;
  const warnings = [];
  const app = express();
  app.use(
    "/documents",
    create_component_router({
      authorize: (req, res, next) => next(),
      log: { warn: (message) => warnings.push(message) },
      database: {
        async load(id) {
          if (!documents.has(id)) throw new Error("component_not_found");
          return structuredClone(documents.get(id));
        },
        async save(document, expected_revision) {
          const current = documents.get(document.id)?.revision ?? 0;
          if (current !== expected_revision)
            throw new Error("component_conflict");
          const saved = { document, revision: expected_revision + 1 };
          documents.set(document.id, saved);
          return saved;
        },
        async record_history(id, revision, entry) {
          if (history_down) throw new Error("history table missing");
          histories.push({ id, revision, ...entry });
        },
        async history(id) {
          return {
            history: histories
              .filter((entry) => entry.id === id)
              .reverse()
              .map(({ revision, action, description }) => ({
                revision,
                action,
                description,
              })),
          };
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin =
    process.env.FRACTO_UI_ORIGIN ||
    `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const base = `http://127.0.0.1:${server.address().port}/documents`;
  const document = create_component_document(randomUUID(), "Grass strip");
  const put = (body) =>
    fetch(`${base}/${document.id}`, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await put({ document, expected_revision: 0 })).status, 200);
  assert.equal(
    (
      await put({
        document: { ...document, name: "Meadow", animation_speed: 2 },
        expected_revision: 1,
        notes: ["changed the animation speed (×2)"],
      })
    ).status,
    200,
  );
  // Notes must be valid; an unknown body key is rejected.
  assert.equal(
    (await put({ document, expected_revision: 1, notes: [3] })).status,
    400,
  );
  assert.equal(
    (await put({ document, expected_revision: 1, extra: true })).status,
    400,
  );
  // A stale save is a conflict and records nothing.
  assert.equal((await put({ document, expected_revision: 1 })).status, 409);
  history_down = true;
  const lit = {
    ...document,
    name: "Meadow",
    animation_speed: 2,
    lighting: { direction_degrees: 90, intensity: 2 },
  };
  assert.equal(
    (await put({ document: lit, expected_revision: 2 })).status,
    200,
  );
  assert.equal(warnings.length, 1);
  const listed = await (
    await fetch(`${base}/${document.id}/history`, {
      headers: { Origin: origin },
    })
  ).json();
  assert.deepEqual(listed.history, [
    {
      revision: 2,
      action: "update-component",
      description:
        'Changed the animation speed (×2). Renamed "Grass strip" to "Meadow"; changed the animation speed.',
    },
    {
      revision: 1,
      action: "create-component",
      description:
        'Created "Grass strip" with 0 placed objects and 0 scatter rules.',
    },
  ]);
  assert.equal(
    (
      await fetch(`${base}/${document.id}/history?x=1`, {
        headers: { Origin: origin },
      })
    ).status,
    400,
  );
});
