import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { create_minibrot_terrain_region_handler } from "../handlers/minibrot_terrain_region.js";
const record = {
  id: 55,
  display_settings: JSON.stringify({
    focal_point: { x: -0.16, y: 1.035 },
    scope: 0.024,
  }),
};
const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
test("data endpoint reads only the selected freeform region with a bound query", async () => {
  let query,
    disconnected = false;
  const handler = create_minibrot_terrain_region_handler({
    connect: () => ({
      promise: () => ({
        query: async (...args) => {
          query = args;
          return [[record]];
        },
      }),
    }),
    disconnect: () => {
      disconnected = true;
    },
  });
  const res = response();
  await handler({ params: { id: "55" } }, res);
  assert.deepEqual(query[1], [55]);
  assert.match(query[0], /is_node = 0 AND is_inline = 0/);
  assert.equal(res.body.result.id, 55);
  assert.deepEqual(Object.keys(res.body.result), ["id", "display_settings"]);
  assert.ok(disconnected);
});

test("terrain region handler imports and runs injected requests without database configuration", async () => {
  const source = await fs.readFile(
    new URL("../handlers/minibrot_terrain_region.js", import.meta.url),
    "utf8",
  );
  // A data URL has no neighboring mysql.js or config directory, even on configured developer hosts.
  const isolated = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  let closed = false;
  const handler = isolated.create_minibrot_terrain_region_handler({
    connect: () => ({ promise: () => ({ query: async () => [[record]] }) }),
    disconnect: () => {
      closed = true;
    },
  });
  const res = response();
  await handler({ params: { id: "55" } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.result.id, 55);
  assert.equal(closed, true);
  const invalid = response();
  await isolated.handle_minibrot_terrain_region(
    { params: { id: "bad" } },
    invalid,
  );
  assert.equal(invalid.code, 400);
});
