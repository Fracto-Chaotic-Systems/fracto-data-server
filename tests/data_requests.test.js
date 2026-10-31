import test from "node:test";
import assert from "node:assert/strict";
import { parse_data_request } from "../handlers/data_requests/contract.js";
import { create_data_request_handler } from "../handlers/data_requests/handler.js";
import { create_data_request_authorizer } from "../handlers/data_requests/authorization.js";

const request = (values = { world_name: "Aimward" }) => ({
  table: "wordnet_mappings",
  operation: "update",
  key: { cardinality: 37 },
  values,
});
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
function store(
  initial = {
    cardinality: 37,
    synset_id: "05982152",
    world_name: "world 37",
    notes: "keep notes",
    email: "must never be returned",
  },
  options = {},
) {
  let row = structuredClone(initial),
    snapshot;
  const calls = [];
  const db = {
    async beginTransaction() {
      calls.push("begin");
      snapshot = structuredClone(row);
    },
    async commit() {
      calls.push("commit");
    },
    async rollback() {
      calls.push("rollback");
      row = snapshot;
    },
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.startsWith("SELECT"))
        return [[...(options.missing ? [] : [structuredClone(row)])]];
      if (options.fail)
        throw Object.assign(Error("private SQL/server detail"), {
          code: options.fail,
        });
      const fields = sql
        .match(/SET (.+) WHERE/)[1]
        .split(",")
        .map((part) => part.match(/`([^`]+)`/)[1]);
      fields.forEach((field, index) => {
        row[field] = parameters[index];
      });
      return [{ affectedRows: 1 }];
    },
  };
  return {
    calls,
    get row() {
      return row;
    },
    handler: create_data_request_handler({
      connect: () => ({ promise: () => db }),
      disconnect: () => calls.push("close"),
      ...(options.registry ? { registry: options.registry } : {}),
    }),
  };
}
test("validates named keys, field types and narrow update permissions before connecting", async () => {
  let opened = false;
  const handler = create_data_request_handler({
    connect: () => {
      opened = true;
    },
    disconnect() {},
  });
  const invalid = [
    { ...request(), table: "users" },
    { ...request(), table: "wordnet_mappings; DROP TABLE users" },
    { ...request(), key: {} },
    { ...request(), key: { cardinality: "37" } },
    { ...request(), key: { cardinality: 37, email: "private" } },
    request({ synset_id: "00000001" }),
    request({ email: "private" }),
    request({ world_name: "" }),
    request({ world_name: "x".repeat(256) }),
    request({ world_name: { sql: "anything" } }),
    request({ notes: "x".repeat(65536) }),
    request({ notes: null }),
    { ...request(), operation: "delete" },
    { ...request(), where: "1=1" },
    request({}),
    {
      table: "wordnet_mappings",
      operation: "get",
      key: { cardinality: 37 },
      values: { notes: "not allowed" },
    },
  ];
  for (const body of invalid) {
    const res = response();
    await handler({ body }, res);
    assert.equal(res.code, 400);
    assert.ok(!JSON.stringify(res.body).includes("private"));
  }
  assert.equal(opened, false);
  assert.doesNotThrow(() =>
    parse_data_request(
      request({ world_name: "\u03bb's world", notes: "multiline\nnotes" }),
    ),
  );
});
test("updates one row atomically with bound values and returns only registered fields", async () => {
  const state = store();
  const res = response();
  const name = "x', notes='not SQL";
  await state.handler(
    {
      body: {
        ...request({ world_name: name }),
        expected: { world_name: "world 37" },
      },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.result.world_name, name);
  assert.equal(state.row.notes, "keep notes");
  assert.ok(!("email" in res.body.result));
  const update = state.calls.find((call) => call.sql?.startsWith("UPDATE"));
  assert.deepEqual(update.parameters, [name, 37]);
  assert.ok(!update.sql.includes(name));
  assert.ok(state.calls.some((call) => call.sql?.endsWith("FOR UPDATE")));
  assert.ok(state.calls.includes("commit"));
  assert.equal(state.calls.at(-1), "close");
});
test("expected-value conflicts roll back without overwriting a concurrent edit", async () => {
  const state = store();
  const res = response();
  await state.handler(
    { body: { ...request(), expected: { world_name: "stale" } } },
    res,
  );
  assert.equal(res.code, 409);
  assert.equal(res.body.code, "data_conflict");
  assert.equal(state.row.world_name, "world 37");
  assert.ok(state.calls.includes("rollback"));
  assert.ok(!state.calls.some((call) => call.sql?.startsWith("UPDATE")));
});
test("no-op updates and reads preserve records; missing rows return 404", async () => {
  const state = store();
  let res = response();
  await state.handler({ body: request({ world_name: "world 37" }) }, res);
  assert.equal(res.body.changed, false);
  assert.ok(!state.calls.some((call) => call.sql?.startsWith("UPDATE")));
  res = response();
  await state.handler(
    {
      body: {
        table: "wordnet_mappings",
        operation: "get",
        key: { cardinality: 37 },
      },
    },
    res,
  );
  assert.equal(res.body.result.cardinality, 37);
  assert.ok(!("email" in res.body.result));
  const missing = store(undefined, { missing: true });
  res = response();
  await missing.handler({ body: request() }, res);
  assert.equal(res.code, 404);
  assert.ok(missing.calls.includes("rollback"));
});
test("database failures are sanitized and rolled back", async () => {
  for (const code of ["ER_ACCESS_DENIED_ERROR", "ER_DUP_ENTRY"]) {
    const state = store(undefined, { fail: code });
    const res = response();
    await state.handler({ body: request() }, res);
    assert.equal(res.code, code === "ER_DUP_ENTRY" ? 409 : 503);
    assert.ok(!JSON.stringify(res.body).includes("private"));
    assert.ok(state.calls.includes("rollback"));
    assert.equal(state.calls.at(-1), "close");
  }
});
test("additional registered tables can supply numeric, boolean and JSON codecs", async () => {
  const registry = {
    sample_records: {
      table: "sample_records",
      keys: { id: { validate: Number.isSafeInteger } },
      readable: ["id", "count", "enabled", "payload"],
      writable: {
        count: { validate: Number.isSafeInteger },
        enabled: {
          validate: (value) => typeof value === "boolean",
          encode: (value) => (value ? 1 : 0),
          decode: Boolean,
        },
        payload: {
          validate: (value) =>
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value),
          encode: JSON.stringify,
          decode: (value) =>
            typeof value === "string" ? JSON.parse(value) : value,
        },
      },
    },
  };
  const state = store(
    { id: 1, count: 0, enabled: 0, payload: "{}" },
    { registry },
  );
  const res = response();
  await state.handler(
    {
      body: {
        table: "sample_records",
        operation: "update",
        key: { id: 1 },
        values: { count: 2, enabled: true, payload: { items: [1, 2] } },
      },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.result.enabled, true);
  assert.deepEqual(res.body.result.payload, { items: [1, 2] });
  assert.deepEqual(
    state.calls.find((call) => call.sql?.startsWith("UPDATE")).parameters,
    [2, 1, '{"items":[1,2]}', 1],
  );
});
test("editor authorization accepts only direct local CLI in auth-disabled mode, or the private service token", () => {
  let next = 0,
    verified = 0;
  const authorize = create_data_request_authorizer({
    env: {},
    verify_internal: () => verified++,
  });
  const req = (address, origin, headers = {}) => ({
    socket: { remoteAddress: address },
    get: (key) => (key === "origin" ? origin : headers[key]),
  });
  authorize(req("127.0.0.1"), response(), () => next++);
  assert.equal(next, 1);
  for (const candidate of [
    req("192.0.2.1"),
    req("127.0.0.1", "http://untrusted.test"),
    req("192.0.2.1", undefined, { "x-forwarded-for": "127.0.0.1" }),
  ]) {
    const res = response();
    authorize(candidate, res, () => next++);
    assert.equal(res.code, 403);
  }
  assert.equal(next, 1);
  for (const env of [
    { FRACTO_AUTH_REQUIRED: "true" },
    { FRACTO_INTERNAL_SERVICE_TOKEN: "configured" },
  ]) {
    create_data_request_authorizer({ env, verify_internal: () => verified++ })(
      req("127.0.0.1"),
      response(),
      () => next++,
    );
  }
  assert.equal(verified, 2);
  assert.equal(next, 1);
});
