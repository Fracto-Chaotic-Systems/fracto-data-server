import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fracto-data-config-"),
  );
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("fracto-data-config-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  // Reproduce the lab layout: root credentials exist, service credentials do not.
  fs.mkdirSync(path.join(directory, "config"));
  fs.writeFileSync(
    path.join(directory, "config/mysql.json"),
    '{"host":"root-db"}',
  );
  const service = path.join(directory, "servers", "fracto-data-server");
  fs.mkdirSync(path.join(service, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(service, "package.json"), '{"type":"module"}');
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entry = manifest.fracto.commands.startup_check;
  fs.copyFileSync(
    new URL(`../${entry}`, import.meta.url),
    path.join(service, entry),
  );
  return {
    configure: (source) => {
      fs.mkdirSync(path.join(service, "config"), { recursive: true });
      fs.writeFileSync(path.join(service, "config/mysql.json"), source);
    },
    run: () =>
      spawnSync(process.execPath, [entry], {
        cwd: service,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      }),
  };
}

test("startup rejects missing service config even when the root config exists", (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /servers\/fracto-data-server\/config\/mysql.json/,
  );
  assert.match(
    result.stderr,
    /root config\/mysql.json does not configure this service/,
  );
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|root-db/);
});

test("startup validates configuration without echoing malformed secrets", (t) => {
  const { configure, run } = fixture(t);
  configure('{"password":"fixture-secret",');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain valid JSON/);
  assert.doesNotMatch(result.stderr + result.stdout, /fixture-secret/);
});

test("startup rejects non-object configuration", (t) => {
  const { configure, run } = fixture(t);
  for (const source of ["null", "[]", '"fixture-secret"']) {
    configure(source);
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must contain a JSON object/);
    assert.doesNotMatch(result.stderr, /fixture-secret/);
  }
});

test("provisioned service config passes without SDK, database access or credential output", (t) => {
  const { configure, run } = fixture(t);
  configure('{"host":"unreachable.invalid","password":"fixture-secret"}');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /service configuration is readable/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /fixture-secret|unreachable.invalid/,
  );
});
