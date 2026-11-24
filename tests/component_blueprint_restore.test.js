import assert from "node:assert/strict";
import test from "node:test";
import { restore_component_blueprint } from "../components/restore_blueprint.js";

const options = {
  blueprint: "grass-strip",
  endpoint: "http://lab.invalid/api/data/component-documents",
};
const response = (status, body) => ({
  status,
  json: async () => structuredClone(body),
});
test("explicit blueprint restore creates only a missing component and verifies exact reopen", async () => {
  let record,
    writes = 0,
    reads = 0;
  const result = await restore_component_blueprint({
    ...options,
    request: async (url, request) => {
      assert.match(
        url,
        /\/component-documents\/0bb37175-0459-49bf-b5fc-f918bf090563$/,
      );
      if (request.method === "PUT") {
        writes++;
        const body = JSON.parse(request.body);
        assert.equal(body.expected_revision, 0);
        assert.equal(request.headers.Origin, "http://lab.invalid");
        record = { document: body.document, revision: 1 };
        return response(200, record);
      }
      reads++;
      return record
        ? response(200, record)
        : response(404, { error: "component_not_found" });
    },
  });
  assert.equal(result.status, "created");
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  const retained = await restore_component_blueprint({
    ...options,
    request: async () =>
      response(200, {
        ...record,
        document: { ...record.document, name: "Existing lab edits" },
        revision: 4,
      }),
  });
  assert.equal(retained.status, "retained_existing");
  assert.equal(retained.matches_blueprint, false);
});
test("restore rejects proxy HTML, database errors and concurrent creates without a write retry", async () => {
  let writes = 0;
  await assert.rejects(
    restore_component_blueprint({
      ...options,
      request: async () => ({
        status: 404,
        json: async () => {
          throw new Error("HTML");
        },
      }),
    }),
    /check_proxy/,
  );
  await assert.rejects(
    restore_component_blueprint({
      ...options,
      request: async () => response(503, { error: "component_unavailable" }),
    }),
    /read_failed_503/,
  );
  await assert.rejects(
    restore_component_blueprint({
      ...options,
      request: async (url, request) => {
        if (request.method === "PUT") {
          writes++;
          return response(409, { error: "component_conflict" });
        }
        return response(404, { error: "component_not_found" });
      },
    }),
    /create_failed_409/,
  );
  assert.equal(writes, 1);
});
