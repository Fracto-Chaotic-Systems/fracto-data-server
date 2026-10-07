import { parentPort } from "node:worker_threads";

import { calculate_orbital_spectrum } from "./handle_orbital_spectrum.js";
import { calculate_seed_survey } from "./handle_orbital.js";
import { calculate_logistic_orbit } from "./logistic_map/calculator.js";

// Keep task names allowlisted. Worker messages contain only cloneable payloads;
// HTTP request/response objects and database connections stay on the main thread.
const task_handlers = {
  orbital_spectrum: ({ query }) => {
    const response = {
      status_code: 200,
      body: null,
      status(status_code) {
        this.status_code = status_code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    calculate_orbital_spectrum(query, response);
    return { status: response.status_code, body: response.body };
  },
  orbital_seed_survey: ({ parameter }, id) => calculate_seed_survey(
    parameter,
    undefined,
    (progress) => parentPort.postMessage({
      id,
      progress: { kind: "seed_survey_progress", ...progress },
    }),
  ),
  logistic_map_level_one: ({ iteration_cap, transient_limit }, id) => {
    const outcomes = [];
    const started_at = Date.now();
    for (let index = 0; index < 256; index += 1) {
      const r = 3 + index / 256;
      parentPort.postMessage({
        id,
        progress: {
          kind: "parameter_started",
          completed: outcomes.length,
          total: 256,
          index,
          r,
          iterations_completed: 0,
        },
      });
      const calculation = calculate_logistic_orbit(r, {
        iteration_cap,
        transient_limit,
        retain_sample: false,
        on_progress: ({ iterations_completed }) => parentPort.postMessage({
          id,
          progress: {
            kind: "iteration_progress",
            completed: outcomes.length,
            total: 256,
            index,
            r,
            iterations_completed,
          },
        }),
      });
      const outcome = {
        index,
        r: calculation.r?.represented_value ?? r,
        status: calculation.status,
        reason_code: calculation.reason?.code ?? null,
        period: calculation.cycle?.period ?? null,
        iterations_completed: calculation.iteration_counts?.iterations_completed ?? 0,
        timing: calculation.timing,
      };
      outcomes.push(outcome);
      parentPort.postMessage({
        id,
        progress: { kind: "parameter_completed", completed: outcomes.length, total: 256, outcome },
      });
    }
    return { started_at, completed_at: Date.now(), outcomes };
  },
};

parentPort.on("message", async ({ id, task, payload }) => {
  if (!Object.hasOwn(task_handlers, task)) {
    parentPort.postMessage({ id, error: "unknown_task" });
    return;
  }
  try {
    const handler = task_handlers[task];
    parentPort.postMessage({ id, result: await handler(payload, id) });
  } catch {
    parentPort.postMessage({ id, error: "task_failed" });
  }
});
