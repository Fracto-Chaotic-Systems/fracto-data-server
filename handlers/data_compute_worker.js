import { parentPort } from "node:worker_threads";

import { calculate_orbital_spectrum } from "./handle_orbital_spectrum.js";

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
};

parentPort.on("message", async ({ id, task, payload }) => {
  if (!Object.hasOwn(task_handlers, task)) {
    parentPort.postMessage({ id, error: "unknown_task" });
    return;
  }
  try {
    const handler = task_handlers[task];
    parentPort.postMessage({ id, result: await handler(payload) });
  } catch {
    parentPort.postMessage({ id, error: "task_failed" });
  }
});
