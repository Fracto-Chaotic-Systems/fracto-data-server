import fs from "node:fs";
import vm from "node:vm";
import express from "express";
import { serve_fixture } from "@fracto/sdk/testing/ServiceFixture.js";
import { require_administrator } from "@fracto/sdk/utils/AdminAuthorization.js";
import { require_enabled_user_if_configured, require_internal_service } from "@fracto/sdk/utils/ServiceAuthorization.js";
import { require_data_editor } from "../handlers/data_requests/authorization.js";
import { require_world_notes_origin } from "../handlers/world_notes.js";

if (process.argv.includes("--serve-fixture")) {
  const app = express(), routes_app=express.Router();routes_app.use(express.json());
  const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const routes = source.slice(source.indexOf('app.get("/",'));
  const context = { app:routes_app, process, require_administrator, require_enabled_user_if_configured, require_internal_service, require_data_editor, require_world_notes_origin,
    create_orbital_data_router: () => express.Router().get("/", (req, res) => res.json({ handler: "orbital_data" })),
    create_user_upsert_route: () => (req, res) => res.json({ handler: "handle_user_upsert" }),
    create_user_bootstrap_route: () => (req, res) => res.json({ handler: "handle_user_bootstrap" }),
  };
  for (const name of new Set(routes.match(/\bhandle_\w+/g))) context[name] = (req, res) => res.json({ handler: name });
  // Only this service evaluates its own route declarations; database handlers are markers.
  vm.runInNewContext(routes, context);
  await serve_fixture(app, express, { configure: values => {
    for (const key of ["FRACTO_SERVER_PORT", "FRACTO_AUTH_REQUIRED", "FRACTO_INTERNAL_SERVICE_TOKEN", "FRACTO_AUTH_MODE", "FRACTO_ADMIN_READONLY_BYPASS", "FRACTO_UI_ORIGIN"])
      if (values[key] === undefined) delete process.env[key]; else process.env[key] = String(values[key]);
  } });
  app.use(routes_app);
}
