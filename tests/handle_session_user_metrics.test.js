import test from "node:test";
import assert from "node:assert/strict";

import { create_session_user_handler } from "../handlers/handle_users.js";

const create_response = () => {
  const listeners = new Map();
  return {
    statusCode: 200,
    body: null,
    once(event, callback) { listeners.set(event, callback); },
    setHeader() {},
    status(status) { this.statusCode = status; return this; },
    json(body) {
      this.body = body;
      listeners.get("finish")?.();
      return this;
    },
  };
};

test("session lookup reports arrival, connect, query, and handler timing separately", () => {
  const metrics = [];
  const metric = (...sample) => metrics.push(sample);
  const response = create_response();
  let clock = 0;
  let on_connect;
  let on_query;
  let disconnected = false;
  const connection = {
    query(_sql, _values, callback) { on_query = callback; },
  };
  const handler = create_session_user_handler({
    connection_factory(callback) { on_connect = callback; return connection; },
    disconnect() { disconnected = true; },
    record_metric: metric,
    now: () => clock,
  });

  handler({
    params: { id: "7" },
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  }, response);
  assert.deepEqual(metrics[0], ["auth_user_record_request_arrival", 0, "received"]);

  clock = 40;
  on_connect(null);
  clock = 48;
  on_query(null, [{ id: 7, enabled: 1, role: "admin" }]);

  assert.equal(disconnected, true);
  assert.deepEqual(response.body, { user: { id: 7, enabled: 1, role: "admin" } });
  assert.deepEqual(metrics, [
    ["auth_user_record_request_arrival", 0, "received"],
    ["auth_user_record_connection", 40, "success"],
    ["auth_user_record_sql_query", 8, "success"],
    ["auth_user_record_query", 48, "success"],
    ["auth_user_record_handler_duration", 48, "200"],
  ]);
});

test("session lookup marks SQL as not run when connection fails", () => {
  const metrics = [];
  let clock = 0;
  let on_connect;
  let on_query;
  const response = create_response();
  const handler = create_session_user_handler({
    connection_factory(callback) {
      on_connect = callback;
      return { query(_sql, _values, callback) { on_query = callback; } };
    },
    disconnect() {},
    record_metric: (...sample) => metrics.push(sample),
    now: () => clock,
  });

  handler({
    params: { id: "7" },
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  }, response);
  clock = 5000;
  on_connect(new Error("connect failed"));
  on_query(new Error("connect failed"));

  assert.equal(response.statusCode, 503);
  assert.ok(metrics.some(([name, duration, outcome]) =>
    name === "auth_user_record_connection" && duration === 5000 && outcome === "error"));
  assert.ok(metrics.some(([name, duration, outcome]) =>
    name === "auth_user_record_sql_query" && duration === 0 && outcome === "not_run"));
});
