import express from "express";
import { require_enabled_user_if_configured } from "@fracto/sdk/utils/ServiceAuthorization.js";
import { trusted_mutation_origin } from "@fracto/sdk/utils/AuthRequestOrigin.js";
import {
  validate_component_document,
  validate_component_id,
} from "@fracto/sdk/FractoComponentDocument.js";
import { create_component_database } from "./database.js";
import { create_component_variants } from "./variants.js";
import {
  summarize_component_change,
  folder_move_entry,
  validate_edit_notes,
} from "./history.js";

export function create_component_router({
  database = create_component_database(),
  authorize = require_enabled_user_if_configured,
  list_variants = create_component_variants(),
  log = console,
} = {}) {
  // History is recorded after a successful change; a history failure never
  // fails the save itself.
  const record = async (id, revision, entry) => {
    try {
      await database.record_history?.(id, revision, entry);
    } catch (error) {
      log.warn?.(`Component history not recorded for ${id}: ${error.message}`);
    }
  };
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
    "/:id/history",
    handle((req) => {
      validate_component_id(req.params.id);
      if (Object.keys(req.query).length)
        throw new Error("invalid_component_document");
      return database.history(req.params.id);
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
    handle(async (req) => {
      validate_component_id(req.params.id);
      if (
        !req.body ||
        Object.keys(req.body).length !== 1 ||
        typeof req.body.folder_path !== "string"
      )
        throw new Error("invalid_component_document");
      const result = await database.move(req.params.id, req.body.folder_path);
      const { revision } = await database.load(req.params.id);
      await record(
        req.params.id,
        revision,
        folder_move_entry(result.folder_path),
      );
      return result;
    }),
  );
  router.put(
    "/:id",
    handle(async (req) => {
      validate_component_id(req.params.id);
      if (
        !req.body ||
        Object.keys(req.body).some(
          (key) => !["document", "expected_revision", "notes"].includes(key),
        ) ||
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
      // Optional editor labels for the edits since the last save.
      const notes = validate_edit_notes(req.body.notes);
      // The saved version being replaced, to summarize what changed.
      const before = req.body.expected_revision
        ? await database
            .load(req.params.id)
            .then((saved) =>
              saved.revision === req.body.expected_revision
                ? saved.document
                : null,
            )
            .catch(() => null)
        : null;
      const saved = await database.save(document, req.body.expected_revision);
      if (!req.body.expected_revision || before)
        await record(
          document.id,
          saved.revision,
          summarize_component_change(before, saved.document, notes),
        );
      return saved;
    }),
  );
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === "entity.too.large" ? 413 : 400;
    res.status(status).json({ error: "invalid_component_document" });
  });
  return router;
}
