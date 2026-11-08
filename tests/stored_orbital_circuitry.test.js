import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { create_orbital_data_router } from "../handlers/orbital_data_routes.js";

test("stored circuitry uses selected points at the same focal point in both modes, including single points", async () => {
  const records = {
    1: {
      orbital_id: "1",
      focal_point: { re: "0", im: "0" },
      points: [{ point: { re: "1", im: "0" } }],
    },
    2: {
      orbital_id: "2",
      focal_point: { re: "0", im: "0" },
      points: [
        { point: { re: "-0.5", im: String(Math.sqrt(3) / 2) } },
        { point: { re: "-0.5", im: String(-Math.sqrt(3) / 2) } },
      ],
    },
  };
  const reads = [];
  const app = express();
  app.use(
    "/orbital-data",
    create_orbital_data_router({
      jobs: {
        store: {
          get: async (id) => {
            reads.push(id);
            return records[id];
          },
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/orbital-data`;
    for (const interpolation of ["radial_sweep", "hermite"]) {
      const fixed = await fetch(
        `${base}/1/circuitry?interpolation=${interpolation}`,
      );
      assert.equal(fixed.status, 200);
      const single = await fixed.json();
      assert.equal(single.cardinality, 1);
      assert.deepEqual(single.orbital_points, [{ re: 1, im: 0 }]);
      assert.equal(single.point_source, "stored_orbital");
      const response = await fetch(
        `${base}/2/circuitry?interpolation=${interpolation}&optimize_polarity=true`,
      );
      assert.equal(response.status, 200);
      const curve = await response.json();
      assert.equal(curve.orbital_id, "2");
      assert.equal(curve.cardinality, 2);
      assert.equal(curve.interpolation, interpolation);
      assert.equal(curve.result.length, 101);
      assert.equal(curve.orbital_points[0].re, -0.5);
      assert.ok(Math.abs(curve.result[50].C.im + Math.sqrt(3) / 2) < 1e-10);
      assert.equal("detector" in curve, false);
    }
    assert.equal(
      (await fetch(`${base}/2/circuitry?interpolation=bad`)).status,
      400,
    );
    assert.equal((await fetch(`${base}/bad/circuitry`)).status, 400);
    assert.deepEqual(reads, ["1", "2", "1", "2"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
