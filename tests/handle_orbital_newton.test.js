import test from "node:test";
import assert from "node:assert/strict";
import { handle_orbital_newton } from "../handlers/handle_orbital_newton.js";

const invoke = (query) => {
  const response = {
    code: null,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  handle_orbital_newton({ query }, response);
  return response;
};

test("orbital Newton endpoint returns detector and Newton data", () => {
  const response = invoke({
    re: "0.1517440416",
    im: "0.5760073226",
    iterations: "512",
    newton_limit: "1",
    newton_mode: "native",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, "cardinality_passed_to_newton");
  assert.equal(response.body.detection.candidate_cardinality, 65);
  assert.equal(response.body.newton.cardinality_supplied, true);
});

test("orbital Newton endpoint reports inconclusive detection normally", () => {
  const response = invoke({
    re: "0.1517440416",
    im: "0.5760073226",
    iterations: "128",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, "cardinality_inconclusive");
  assert.equal(response.body.newton, null);
});

test("orbital Newton endpoint rejects invalid coordinates", () => {
  const response = invoke({ re: "not-a-number", im: "0" });
  assert.equal(response.code, 400);
  assert.match(response.body.error, /finite numbers/);
});
