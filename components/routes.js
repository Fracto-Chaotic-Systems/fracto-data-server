import express from "express";
import { require_enabled_user_if_configured } from "@fracto/sdk/utils/ServiceAuthorization.js";
import { trusted_mutation_origin } from "@fracto/sdk/utils/AuthRequestOrigin.js";
import {
  validate_component_document,
  validate_component_id,
} from "@fracto/sdk/FractoComponentDocument.js";
import { create_component_database } from "./database.js";
import { create_component_variants } from "./variants.js";

export function create_component_router({
  database = create_component_database(),
  authorize = require_enabled_user_if_configured,
  list_variants = create_component_variants(),
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    authorize(req, res, next);
  });
  router.use((req, res, next) => {
    if (trusted_mutation_origin(req, res)) next();
  });
  router.use(express.json({ limit: "1mb", strict: true }));
  const handle = (operation) => async (req, res) => {
    try {
      res.json(await operation(req));
    } catch (error) {
      const status =
        {
          invalid_component_document: 400,
          component_not_found: 404,
          component_conflict: 409,
          invalid_folder: 400,
        }[error.message] || 503;
      res.status(status).json({
        error: status === 503 ? "component_unavailable" : error.message,
      });
    }
  };
  router.get(
    "/",
    handle((req) => {
      if (
        Object.keys(req.query).some((key) => key !== "after") ||
        (req.query.after !== undefined && typeof req.query.after !== "string")
      )
        throw new Error("invalid_component_document");
      if (req.query.after) validate_component_id(req.query.after);
      return database.list(req.query.after || "");
    }),
  );
  router.get(
    "/:id/variants",
    handle((req) => {
      validate_component_id(req.params.id);
      if (Object.keys(req.query).length)
        throw new Error("invalid_component_document");
      return list_variants(req.params.id);
    }),
  );
  router.get(
    "/:id",
    handle((req) => {
      validate_component_id(req.params.id);
      return database.load(req.params.id);
    }),
  );
  router.put(
    "/:id/folder",
    handle((req) => {
      validate_component_id(req.params.id);
      if (
        !req.body ||
        Object.keys(req.body).length !== 1 ||
        typeof req.body.folder_path !== "string"
      )
        throw new Error("invalid_component_document");
      return database.move(req.params.id, req.body.folder_path);
    }),
  );
  router.put(
    "/:id",
    handle((req) => {
      validate_component_id(req.params.id);
      if (
        !req.body ||
        Object.keys(req.body).length !== 2 ||
        !Object.hasOwn(req.body, "document") ||
        !Object.hasOwn(req.body, "expected_revision") ||
        !Number.isInteger(req.body.expected_revision) ||
        req.body.expected_revision < 0 ||
        req.body.expected_revision >= 4294967295
      )
        throw new Error("invalid_component_document");
      const document = validate_component_document(req.body.document);
      if (document.id !== req.params.id)
        throw new Error("invalid_component_document");
      return database.save(document, req.body.expected_revision);
    }),
  );
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === "entity.too.large" ? 413 : 400;
    res.status(status).json({ error: "invalid_component_document" });
  });
  return router;
}
