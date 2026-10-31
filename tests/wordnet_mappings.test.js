import test from "node:test";
import assert from "node:assert/strict";
import { create_wordnet_mappings_handler } from "../handlers/wordnet_mappings.js";
const response = () => ({
  code: 200,
  setHeader() {},
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
test("returns all mappings ordered with explicit safe fields and closes connections", async () => {
  let closed = false;
  const res = response();
  await create_wordnet_mappings_handler({
    connect: () => ({
      promise: () => ({
        query: async (sql) => {
          assert.match(sql, /ORDER BY cardinality ASC/);
          assert.doesNotMatch(sql, /SELECT \*/);
          return [
            [
              {
                cardinality: 1,
                synset_id: "00002137",
                word: "existence",
                world_name: "world 1",
                definition: "being",
                gloss: "being",
                notes: "ground",
                factorization: "1",
                wordnet_version: "3.1",
                email: "excluded",
              },
            ],
          ];
        },
      }),
    }),
    disconnect: () => {
      closed = true;
    },
  })({}, res);
  assert.equal(res.body.result.length, 1);
  assert.equal(res.body.result[0].synset_id, "00002137");
  assert.ok(!("email" in res.body.result[0]));
  assert.equal(res.body.result[0].world_name, "world 1");
  assert.ok(closed);
});
test("database failures are retryable without leaking connection details", async () => {
  let closed = false;
  const res = response();
  await create_wordnet_mappings_handler({
    connect: () => ({
      promise: () => ({
        query: async () => {
          throw Error("private database details");
        },
      }),
    }),
    disconnect: () => {
      closed = true;
    },
  })({}, res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, { error: "WordNet mappings unavailable" });
  assert.ok(closed);
});
