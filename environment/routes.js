import express from "express";
import { create_environment_asset_database } from "./database.js";
import {
  validate_environment_registration,
  validate_model_category,
  validate_model_asset_page,
} from "@fracto/sdk/FractoEnvironmentCatalog.js";
import { require_internal_service } from "@fracto/sdk/utils/ServiceAuthorization.js";

export function authorize_environment_registry(req, res, next) {
  // An explicitly unauthenticated lab installation permits local service traffic.
  // Configured tokens are always enforced; remote browser writes never qualify.
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    req.socket.remoteAddress,
  );
  if (
    process.env.FRACTO_AUTH_REQUIRED !== "true" &&
    !process.env.FRACTO_INTERNAL_SERVICE_TOKEN &&
    local
  )
    return next();
  return require_internal_service(req, res, next);
}

export function create_environment_registry_router({
  database = create_environment_asset_database(),
  authorize = authorize_environment_registry,
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    authorize(req, res, next);
  });
  router.use(express.json({ limit: "8mb", strict: true }));
  router.get("/", async (req, res) => {
    let query;
    try {
      if (
        Object.keys(req.query).some(
          (key) => !["category", "after", "limit"].includes(key),
        )
      )
        throw new Error();
      const { category, after = "", limit = "200" } = req.query;
      if (category !== undefined) validate_model_category(category);
      if (
        typeof after !== "string" ||
        (after && !/^[a-z][a-z0-9-]{0,63}$/.test(after)) ||
        typeof limit !== "string" ||
        !/^\d{1,3}$/.test(limit) ||
        Number(limit) < 1 ||
        Number(limit) > 200
      )
        throw new Error();
      query = { category, after, limit: Number(limit) };
    } catch {
      return res.status(400).json({ error: "invalid_query" });
    }
    try {
      res.json(
        validate_model_asset_page(await database.list(query), query.category),
      );
    } catch {
      res.status(503).json({ error: "catalog_unavailable" });
    }
  });
  router.put("/:id", async (req, res) => {
    try {
      const { record, revision } = validate_environment_registration(req.body);
      if (record.id !== req.params.id)
        throw Object.assign(new Error("invalid_record"), { status: 400 });
      await database.sync(record, revision);
      res.json({ id: record.id, revision });
    } catch (error) {
      const invalid = ["invalid_record", "invalid_url"].includes(error.message);
      res
        .status(invalid ? 400 : 503)
        .json({ error: invalid ? "invalid_record" : "catalog_unavailable" });
    }
  });
  router.use((error, req, res, next) => {
    if (!error) return next();
    res
      .status(error.type === "entity.too.large" ? 413 : 400)
      .json({ error: "invalid_record" });
  });
  return router;
}
