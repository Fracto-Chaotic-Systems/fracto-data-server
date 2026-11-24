import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { component_document_json } from "@fracto/sdk/FractoComponentDocument.js";

const hash = (document) =>
  createHash("sha256").update(component_document_json(document)).digest("hex");

// Explicit editorial import through the public revision-checked API. Never a
// startup seed, SQL write, or automatic replacement of an existing component.
export async function restore_component_blueprint({
  blueprint,
  endpoint,
  origin,
  request = fetch,
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(blueprint || ""))
    throw new Error("invalid_blueprint_key");
  const base = new URL(endpoint);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("invalid_component_endpoint");
  const folder = new URL(`./blueprints/${blueprint}/`, import.meta.url);
  const document = JSON.parse(
    await fs.readFile(new URL(`${blueprint}.component.json`, folder), "utf8"),
  );
  const parameters = JSON.parse(
    await fs.readFile(
      new URL(`${blueprint}.construction.json`, folder),
      "utf8",
    ),
  );
  const sha256 = hash(document);
  if (
    parameters.blueprint_key !== blueprint ||
    parameters.realization.component_id !== document.id ||
    parameters.realization.canonical_scene_sha256 !== sha256
  )
    throw new Error("blueprint_snapshot_mismatch");
  const url = base.href.replace(/\/$/, "") + "/" + document.id;
  const get = () => request(url, { signal: AbortSignal.timeout(20000) });
  const initial = await get();
  let existing;
  try {
    existing = await initial.json();
  } catch {
    throw new Error("component_route_not_json_check_proxy");
  }
  if (initial.status === 200) {
    if (
      existing.document?.id !== document.id ||
      !Number.isInteger(existing.revision) ||
      existing.revision < 1
    )
      throw new Error("invalid_component_response");
    return {
      status: "retained_existing",
      id: document.id,
      revision: existing.revision,
      matches_blueprint: hash(existing.document) === sha256,
    };
  }
  if (initial.status !== 404 || existing.error !== "component_not_found")
    throw new Error(`component_read_failed_${initial.status}`);
  const saved = await request(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: origin || base.origin,
    },
    body: JSON.stringify({ document, expected_revision: 0 }),
    signal: AbortSignal.timeout(20000),
  });
  if (saved.status !== 200)
    throw new Error(
      `component_create_failed_${saved.status}_reload_before_retry`,
    );
  const committed = await saved.json();
  if (
    committed.revision !== 1 ||
    committed.document?.id !== document.id ||
    hash(committed.document) !== sha256
  )
    throw new Error("component_save_verification_failed_reload_before_retry");
  const reopened = await get();
  if (reopened.status !== 200)
    throw new Error("component_reopen_failed_reload_before_retry");
  const result = await reopened.json();
  if (
    result.revision !== committed.revision ||
    hash(result.document) !== sha256
  )
    throw new Error("component_reopen_mismatch");
  return {
    status: "created",
    id: document.id,
    revision: result.revision,
    canonical_scene_sha256: sha256,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--blueprint", "--endpoint", "--origin"].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        "Usage: node components/restore_blueprint.js --blueprint grass-strip --endpoint http://HOST:3000/api/data/component-documents [--origin http://HOST:3000]",
      );
    options[args[i].slice(2)] = args[i + 1];
  }
  console.log(JSON.stringify(await restore_component_blueprint(options)));
}
