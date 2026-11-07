import express from "express";
import { require_data_editor } from "./data_requests/authorization.js";
import {
  discovery_request,
  positive_id,
  run_id,
  focal_identity,
  fail,
} from "./orbital_data_contract.js";
import { OrbitalDiscoveryJobs } from "./orbital_data_jobs.js";
import { trusted_mutation_origin } from "../../../utils/auth_request_origin.js";

const safe = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    const missing = ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(
      error.code,
    );
    const status = missing ? 503 : error.status || 500;
    if (!error.status && !missing)
      console.error(
        "orbital_data_request_failed",
        /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "INTERNAL_ERROR",
      );
    res.status(status).json({
      error: missing
        ? "orbital_schema_pending"
        : error.status
          ? error.code
          : "orbital_data_unavailable",
    });
  }
};

/** Mount below the service's existing enabled-user middleware; mutations are private. */
export const create_orbital_data_router = ({
  jobs = new OrbitalDiscoveryJobs(),
  authorize = require_data_editor,
} = {}) => {
  const router = express.Router();
  // Narrow browser action. Global enabled-user middleware precedes this router;
  // the browser supplies only an ID and cannot widen the server's compute limits.
  router.post(
    "/bailiwicks/:id/discovery-jobs",
    (req, res, next) => {
      if (trusted_mutation_origin(req, res)) next();
    },
    safe(async (req, res) => {
      if (
        req.body == null ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length
      )
        throw fail("invalid_request");
      const run = await jobs.start(
        discovery_request({
          free_bailiwick_id: positive_id(req.params.id),
        }),
      );
      res.status(202).json({ result: run });
    }),
  );
  router.post(
    "/discovery-jobs",
    authorize,
    safe(async (req, res) => {
      const run = await jobs.start(discovery_request(req.body));
      res.status(202).json({ result: run });
    }),
  );
  router.get(
    "/discovery-jobs/:id",
    safe(async (req, res) => {
      res.json({ result: await jobs.store.get_run(run_id(req.params.id)) });
    }),
  );
  router.post(
    "/discovery-jobs/:id/cancel",
    authorize,
    safe(async (req, res) => {
      res.json({ result: await jobs.cancel(run_id(req.params.id)) });
    }),
  );
  router.get(
    "/",
    safe(async (req, res) => {
      let parameter;
      try {
        parameter = focal_identity({
          re: req.query.focal_re,
          im: req.query.focal_im,
        }).parameter;
      } catch {
        throw fail("invalid_focal_point");
      }
      if (req.query.view === "survey") {
        res.json(await jobs.store.latest_survey(parameter));
        return;
      }
      if (req.query.view !== undefined) throw fail("invalid_view");
      const limit = Number(req.query.limit ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw fail("invalid_limit");
      const after =
        req.query.after === undefined ? "0" : positive_id(req.query.after);
      res.json({ result: await jobs.store.list(parameter, limit, after) });
    }),
  );
  router.get(
    "/:id",
    safe(async (req, res) => {
      res.json({ result: await jobs.store.get(positive_id(req.params.id)) });
    }),
  );
  return router;
};
