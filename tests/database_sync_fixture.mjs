import express from "express";
import { serve_fixture } from "@fracto/sdk/testing/ServiceFixture.js";
import { require_internal_service } from "@fracto/sdk/utils/ServiceAuthorization.js";
import {
  create_database_sync_router,
  create_sync_peer_router,
} from "../handlers/database_sync.js";

if (process.argv.includes("--serve-fixture")) {
  const options = JSON.parse(process.env.FRACTO_TEST_FIXTURE_OPTIONS || "{}");
  process.env.FRACTO_INTERNAL_SERVICE_TOKEN = options.service_token;
  process.env.FRACTO_DATABASE_SYNC_PEERS = "{}";
  const app = express();
  app.use(
    "/internal/database-sync-peer",
    require_internal_service,
    create_sync_peer_router(),
  );
  app.use(
    "/internal/database-sync",
    require_internal_service,
    express.json({ limit: "16kb" }),
    create_database_sync_router(),
  );
  await serve_fixture(app, express);
}
