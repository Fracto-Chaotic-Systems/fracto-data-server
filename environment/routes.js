import { validate_model_management } from "@fracto/sdk/FractoModelManagement.js";
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
  router
    .route("/folders")
    .get(async (req, res) => {
      try {
        if (Object.keys(req.query).some((key) => key !== "category"))
          throw new Error("invalid_record");
        if (typeof req.query.category !== "string")
          throw new Error("invalid_record");
        validate_model_category(req.query.category);
      } catch {
        return res.status(400).json({ error: "invalid_record" });
      }
      try {
        res.json(await database.folders(req.query.category));
      } catch {
        res.status(503).json({ error: "catalog_unavailable" });
      }
    })
    .post(async (req, res) => {
      try {
        if (
          !req.body ||
          Object.keys(req.body).some(
            (key) => !["category", "folder_path"].includes(key),
          )
        )
          throw new Error("invalid_record");
        if (typeof req.body.category !== "string")
          throw new Error("invalid_record");
        validate_model_category(req.body.category);
        res.json(
          await database.add_folder(req.body.category, req.body.folder_path),
        );
      } catch (error) {
        const invalid = ["invalid_record", "invalid_folder"].includes(
          error.message,
        );
        res
          .status(invalid ? 400 : 503)
          .json({ error: invalid ? error.message : "catalog_unavailable" });
      }
    });
  router.post("/folders/manage", async (req, res) => {
    try {
      const body = validate_model_management(req.body);
      if (!body.action.endsWith("-folder")) throw new Error("invalid_record");
      res.json(await database.manage_folder(req.body));
    } catch (error) {
      const conflict = [
        "folder_not_empty",
        "folder_conflict",
        "folder_not_found",
      ].includes(error.message);
      const invalid = ["invalid_record", "invalid_folder"].includes(
        error.message,
      );
      res.status(conflict ? 409 : invalid ? 400 : 503).json({
        error: conflict || invalid ? error.message : "catalog_unavailable",
      });
    }
  });
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
      const invalid = [
        "invalid_record",
        "invalid_url",
        "invalid_folder",
      ].includes(error.message);
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
