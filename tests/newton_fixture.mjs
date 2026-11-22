import express from "express";
import { serve_fixture } from "@fracto/sdk/testing/ServiceFixture.js";
import { handle_orbital_newton } from "../handlers/handle_orbital_newton.js";
if (process.argv.includes("--serve-fixture")) {
  const app = express(); app.get("/orbital-newton", handle_orbital_newton);
  await serve_fixture(app, express);
}
