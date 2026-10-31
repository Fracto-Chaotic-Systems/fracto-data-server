import assert from "node:assert/strict";
import test from "node:test";
import {
  create_world_notes_handler,
  require_world_notes_origin,
} from "../handlers/world_notes.js";
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
test("browser route delegates only notes and a mandatory expected value", () => {
  let body;
  const handle = create_world_notes_handler({
    request_handler: (req) => {
      body = req.body;
    },
  });
  handle(
    {
      params: { cardinality: "1" },
      body: { notes: "Cogito only", expected_notes: "old notes" },
    },
    response(),
  );
  assert.deepEqual(body, {
    operation: "update",
    table: "wordnet_mappings",
    key: { cardinality: 1 },
    values: { notes: "Cogito only" },
    expected: { notes: "old notes" },
  });
  for (const invalid of [
    { notes: "new" },
    { notes: "new", expected_notes: "old", world_name: "not permitted" },
    null,
    [],
  ]) {
    const res = response();
    body = null;
    handle({ params: { cardinality: "1" }, body: invalid }, res);
    assert.equal(res.code, 400);
    assert.equal(body, null);
  }
});
test("browser notes route checks the configured UI origin", () => {
  const previous = process.env.FRACTO_UI_ORIGIN;
  process.env.FRACTO_UI_ORIGIN = "http://localhost:3106";
  try {
    let next = 0;
    require_world_notes_origin(
      { method: "PUT", headers: { origin: "http://localhost:3106" } },
      response(),
      () => next++,
    );
    assert.equal(next, 1);
    for (const origin of [undefined, "http://untrusted.test"]) {
      const res = response();
      require_world_notes_origin(
        { method: "PUT", headers: { origin } },
        res,
        () => next++,
      );
      assert.equal(res.code, 403);
    }
    assert.equal(next, 1);
  } finally {
    if (previous === undefined) delete process.env.FRACTO_UI_ORIGIN;
    else process.env.FRACTO_UI_ORIGIN = previous;
  }
});
