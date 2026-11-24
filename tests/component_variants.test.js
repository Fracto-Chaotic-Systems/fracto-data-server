import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { readFile } from "node:fs/promises";
import { create_component_variants } from "../components/variants.js";
import { create_component_router } from "../components/routes.js";

const strip = "0bb37175-0459-49bf-b5fc-f918bf090563";
const other = "9ec97fe4-aa47-4d31-bdd8-ff6f42669892";

test("variant list associates authored deltas only with their base component", async () => {
  const list = create_component_variants();
  const result = await list(strip);
  const blueprint = JSON.parse(
    await readFile(
      new URL(
        "../components/blueprints/grass-strip/grass-strip.construction.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const variant = JSON.parse(
    await readFile(
      new URL(
        "../components/blueprints/grass-strip/variants/ladybug-zoomies/ladybug-zoomies.variant.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(result, {
    variants: [
      {
        key: "ladybug-zoomies",
        name: "Ladybug zoomies",
        revision: variant.variant_revision,
        base: {
          component_id: strip,
          scene_revision: variant.base.scene_revision,
        },
        role_groups: blueprint.realization.role_groups,
        overrides: [
          {
            target: { role: "walking_insects", property: "motion.speed_mps" },
            operation: "multiply",
            value: 8,
          },
          {
            target: {
              role: "walking_insects",
              property: "walk_clip.playback_rate",
            },
            operation: "multiply",
            value: 8,
          },
        ],
      },
    ],
  });
  assert.deepEqual(await list(other), { variants: [] });
});

test("variant endpoint validates IDs and query, reuses authorization, and needs no scene write", async (t) => {
  const app = express();
  app.use(
    "/component-documents",
    create_component_router({
      database: {},
      authorize(req, res, next) {
        if (req.headers["x-test-denied"]) return res.sendStatus(403);
        next();
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/component-documents`;
  const result = await fetch(`${base}/${strip}/variants`);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await result.json()).variants[0].name, "Ladybug zoomies");
  assert.deepEqual(await (await fetch(`${base}/${other}/variants`)).json(), {
    variants: [],
  });
  assert.equal((await fetch(`${base}/bad-id/variants`)).status, 400);
  assert.equal(
    (await fetch(`${base}/${strip}/variants?path=elsewhere`)).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/${strip}/variants`, {
        headers: { "x-test-denied": "1" },
      })
    ).status,
    403,
  );
});
