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

test("category listing is private, bounded and uses only the database result", async (t) => {
  let query,
    calls = 0;
  const app = express();
  app.use(
    "/registry",
    create_environment_registry_router({
      authorize(req, res, next) {
        if (req.get("X-Test-Token") !== "private") return res.sendStatus(403);
        next();
      },
      database: {
        async list(value) {
          calls++;
          query = value;
          return {
            assets: [
              {
                id: "scene",
                name: "Scene",
                category: value.category,
                model: null,
                format: null,
              },
            ],
            next_cursor: null,
          };
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
  const base = "http://127.0.0.1:" + server.address().port + "/registry";
  assert.equal((await fetch(base + "?category=area")).status, 403);
  const headers = { "X-Test-Token": "private" };
  for (const suffix of [
    "category=wrong",
    "category[]=area",
    "limit=201",
    "after=../x",
    "extra=private",
  ])
    assert.equal((await fetch(base + "?" + suffix, { headers })).status, 400);
  assert.equal(calls, 0);
  const response = await fetch(base + "?category=area&limit=10&after=grass", {
    headers,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(query, { category: "area", after: "grass", limit: 10 });
  assert.equal((await response.json()).assets[0].id, "scene");
});

test("folder endpoints enforce service auth, category and bounded path validation", async t=>{
 const app=express();let calls=0;
 app.use("/registry",create_environment_registry_router({authorize:(req,res,next)=>req.get("X-Test-Token")==="allowed"?next():res.sendStatus(403),database:{
   async folders(category){calls++;return {folders:[category+"/Empty"]};},
   async add_folder(category,path){calls++; if(path==="../escape")throw Error("invalid_folder");return {folder_path:path};}
 }}));
 const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const url=`http://127.0.0.1:${server.address().port}/registry/folders`;
 assert.equal((await fetch(url+"?category=material")).status,403);assert.equal(calls,0);
 const headers={"X-Test-Token":"allowed","Content-Type":"application/json"};
 assert.deepEqual(await (await fetch(url+"?category=area",{headers})).json(),{folders:["area/Empty"]});
 const post=body=>fetch(url,{method:"POST",headers,body:JSON.stringify(body)});
 assert.equal((await post({category:"bad",folder_path:"Test"})).status,400);
 assert.equal((await post({category:"material",folder_path:"Test",extra:true})).status,400);
 assert.equal((await post({category:"material",folder_path:"../escape"})).status,400);
 assert.deepEqual(await (await post({category:"component",folder_path:"Empty"})).json(),{folder_path:"Empty"});
});
