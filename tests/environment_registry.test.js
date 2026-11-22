import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { create_environment_registry_router } from "../environment/routes.js";
import { environment_registration } from "@fracto/sdk/FractoEnvironmentCatalog.js";

test("private registry validates requests and returns no provenance or database details", async (t) => {
  const prior = process.env.FRACTO_INTERNAL_SERVICE_TOKEN;
  process.env.FRACTO_INTERNAL_SERVICE_TOKEN = "registry-test-token";
  t.after(() => {
    if (prior === undefined) delete process.env.FRACTO_INTERNAL_SERVICE_TOKEN;
    else process.env.FRACTO_INTERNAL_SERVICE_TOKEN = prior;
  });
  let writes = 0,
    fail = false;
  const app = express();
  app.use(
    "/registry",
    create_environment_registry_router({
      database: {
        async sync() {
          writes++;
          if (fail) throw new Error("private database credentials");
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/registry/grass`;
  const body = environment_registration(
    {
      id: "grass",
      name: "Grass",
      version: "1",
      description: "Grass",
      attribution: { status: "unresolved" },
      sources: [],
      history: [],
    },
    "a".repeat(64),
  );
  const send = (value, token = "registry-test-token") =>
    fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Fracto-Service-Token": token,
      },
      body: JSON.stringify(value),
    });
  assert.equal((await send(body, "wrong")).status, 403);
  assert.equal(writes, 0);
  assert.equal((await send({ ...body, private: "excluded" })).status, 400);
  assert.equal(
    (await send({ ...body, record: { ...body.record, id: "other" } })).status,
    400,
  );
  const response = await send(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "grass",
    revision: body.revision,
  });
  fail = true;
  const failure = await send(body);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "catalog_unavailable" });
});
