import express from "express";
import chalk from "chalk";
import path from "path";
import { require_administrator } from "../../utils/admin_authorization.js";
import { require_enabled_user_if_configured, require_internal_service } from "../../utils/service_authorization.js";

const FRACTO_DATA_PORT = Number(process.env.FRACTO_DATA_PORT || 3002);

import { handle_main_status } from "./handlers/status.js";
import { handle_health } from "./handlers/health.js";
import { handle_logs } from "./handlers/logs.js";
import {
  handle_put_radial_point,
  handle_radian_data,
} from "./handlers/radial_points.js";
import { handle_fracto_calc } from "./handlers/fracto_calc.js";
import { handle_farey_sequence } from "./handlers/utils.js";
import { handle_minibrot, handle_minibrots } from "./handlers/minibrots.js";
import { handle_asset, handle_assets } from "./handlers/handle_asset.js";
import { handle_video } from "./handlers/handle_video.js";
import { handle_video_get } from "./handlers/handle_video_get.js";
import { handle_video_update } from "./handlers/handle_video_update.js";
import { handle_backup } from "./handlers/handle_backup.js";
import { handle_query } from "./handlers/handle_query.js";
import {
  handle_login_event,
  handle_session_user,
  handle_login_events,
  handle_user_bootstrap,
  handle_user_upsert,
  handle_user_update,
  handle_users,
} from "./handlers/handle_users.js";
import { handle_ensure_table } from "./handlers/handle_ensure_table.js";
import {
  handle_automation,
  handle_automation_create,
} from "./handlers/handle_automation.js";
import { initialize_automation_table } from "./handlers/initialize_automation.js";
import { initialize_user_tables } from "./handlers/initialize_users.js";
import { handle_claim_automation } from "./handlers/claim_automation.js";
import { handle_automation_update } from "./handlers/handle_automation_update.js";
import { handle_solve } from "./handlers/solve.js";
import { handle_hyper_complex_buffer } from "./handlers/hyper-complex.js";
import { handle_tiles } from "./handlers/handle_tiles.js";
import { handle_orbital, handle_orbitals } from "./handlers/handle_orbital.js";
import { handle_circuitry } from "./handlers/handle_circuitry.js";
import { handle_orbital_discovery } from "./handlers/handle_orbital_discovery.js";
import {
  handle_orbital_spectrum,
  handle_orbital_pyramid,
} from "./handlers/handle_orbital_spectrum.js";
import { handle_orbital_newton } from "./handlers/handle_orbital_newton.js";
import { handle_tile_coverage } from "./handlers/handle_coverage.js";
import { handle_tile, handle_tile_get } from "./handlers/handle_tile.js";
import {
  handle_lore_categories,
  handle_lore_content,
  handle_lore_storage,
  handle_lore_content_list,
} from "./handlers/handle_lore.js";

export const SEPARATOR = path.sep;

export const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const ui_origin = process.env.FRACTO_UI_ORIGIN || `http://localhost:${process.env.FRACTO_UI_PORT || 3006}`;
  const credentialed = origin && (origin === ui_origin || process.env.FRACTO_ALLOW_CORS_ALL === "true");
  res.setHeader("Access-Control-Allow-Origin", credentialed ? origin : "*");
  res.vary("Origin");
  if (credentialed) res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  ); // Specify allowed methods
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Automation jobs may contain thousands of shortcodes. Keep this configurable
// for installations with larger or stricter request-size requirements.
const json_body_limit = process.env.FRACTO_JSON_BODY_LIMIT || "25mb";
app.use(express.json({ limit: json_body_limit })); // For application/json
app.use(express.urlencoded({ extended: true })); // For application/x-www-form-urlencoded

// Start the server and listen for incoming requests
await initialize_automation_table().catch((error) => {
  console.error(
    chalk.red(`automation table initialization failed: ${error.message}`),
  );
});
await initialize_user_tables().catch((error) => {
  console.error(
    chalk.red(`user table initialization failed: ${error.message}`),
  );
});

app.listen(FRACTO_DATA_PORT, () => {
  console.log(
    chalk.green(
      `fracto-data-server is running on http://localhost:${FRACTO_DATA_PORT}`,
    ),
  );
});

app.get("/", handle_main_status);
app.get("/healthz", handle_health);
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/healthz" ||
      (req.method === "GET" && req.path === "/assets" &&
        Object.keys(req.query).length === 3 && req.query.asset_type === "image" &&
        req.query.width === "4800" && req.query.height === "4800") ||
      req.path.startsWith("/user/session/") ||
      ["/login_event", "/user/bootstrap", "/user/upsert"].includes(req.path) ||
      req.path === "/ensure_table") return next();
  return require_enabled_user_if_configured(req, res, next);
});
app.get("/logs", handle_logs);

app.get("/fracto_calc", handle_fracto_calc);

app.get("/utils/farey_sequence", handle_farey_sequence);
app.get("/radian_data", handle_radian_data);
app.put("/radial_point", handle_put_radial_point);

app.get("/minibrots", handle_minibrots);
app.put("/minibrot", handle_minibrot);

app.get("/asset", handle_asset);
app.get("/assets", handle_assets);
app.post("/video", handle_video);
app.get("/video/:id", handle_video_get);
app.put("/video/:id", handle_video_update);

app.get("/tiles", handle_tiles);
app.get("/tile_coverage", handle_tile_coverage);
app.get("/tile", handle_tile_get);
app.put("/tile", handle_tile);
app.post("/backup", require_administrator, handle_backup);
app.get("/query", (req, res, next) => req.query.table === "users"
  ? require_administrator(req, res, next) : next(), handle_query);
app.get("/user/session/:id", handle_session_user);
app.get("/users", require_administrator, handle_users);
app.get("/login_events", require_administrator, handle_login_events);
app.post("/login_event", handle_login_event);
app.post("/user/bootstrap", handle_user_bootstrap);
app.post("/user/upsert", handle_user_upsert);
app.put("/user/:id", require_administrator, handle_user_update);
app.post("/ensure_table", (req, res, next) => {
  if (["users", "login_events"].includes(`${req.body?.table || ""}`.toLowerCase())) {
    return require_administrator(req, res, next);
  }
  if (process.env.FRACTO_AUTH_REQUIRED === "true") {
    return require_internal_service(req, res, next);
  }
  return next();
}, handle_ensure_table);
app.get("/automation", handle_automation);
app.post("/automation", handle_automation_create);
app.post("/automation/claim", handle_claim_automation);
app.put("/automation/:id", handle_automation_update);

app.get("/solve", handle_solve);
app.get("/orbital", handle_orbital);
app.get("/orbitals", handle_orbitals);
app.get("/circuitry", handle_circuitry);
app.get("/orbital_discovery", handle_orbital_discovery);
app.get("/orbital_spectrum", handle_orbital_spectrum);
app.get("/orbital_pyramid", handle_orbital_pyramid);
app.get("/orbital_newton", handle_orbital_newton);

app.get("/lore_categories", handle_lore_categories);
app.get("/lore_content", handle_lore_content);
app.put("/lore_storage", handle_lore_storage);
app.get("/lore_content_list", handle_lore_content_list);

app.get("/hyper_complex_buffer", handle_hyper_complex_buffer);
