import express from "express";
import { serve_fixture } from "@fracto/sdk/testing/ServiceFixture.js";
import { CorrectionStore } from "../corrections/storage.js";

if (process.argv.includes("--serve-fixture")) {
  const options = JSON.parse(process.env.FRACTO_TEST_FIXTURE_OPTIONS || "{}");
  const store = new CorrectionStore(options.directory);
  process.on("SIGTERM", () => store.close());
  await serve_fixture(express(), express, {
    register: ({ id, snapshot }) => store.register(id, snapshot),
    read: ({ id }) => store.read(id),
    preview: ({ id, request }) => store.preview(id, request),
    approve: ({ digest, revision }) => store.approve(digest, revision),
    apply: ({ digest }) => store.apply(digest),
    approve_rollback: ({ digest, revision }) => store.approve_rollback(digest, revision),
    rollback: ({ digest }) => store.rollback(digest),
  });
}
