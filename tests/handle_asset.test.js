import assert from "node:assert/strict";
import test from "node:test";

import { build_assets_query } from "../handlers/handle_asset.js";

test("assets query preserves the legacy width filter by default", () => {
  const query = build_assets_query();
  assert.equal(query.where, "width = 4800");
  assert.equal(query.order, "id desc");
});

test("welcome-image filters are composed from allowlisted values", () => {
  const query = build_assets_query({
    asset_type: "image",
    width: "4800",
    height: "4800",
  });
  assert.equal(
    query.where,
    "width = 4800 AND height = 4800 AND asset_type = 'image' AND public_url <> ''",
  );
});

test("invalid asset filters are rejected", () => {
  assert.throws(() => build_assets_query({ width: "not-a-number" }), /width/);
  assert.throws(() => build_assets_query({ asset_type: "image' OR 1=1" }), /asset_type/);
});
