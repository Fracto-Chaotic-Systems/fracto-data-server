import fs from "node:fs";
import path from "node:path";
import { CorrectionStore } from "./storage.js";
import { CorrectionError, fail } from "./contract.js";
const read_json = (file, limit) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    fail("INVALID_CORRECTION_FILE");
  const bytes = fs.readFileSync(file);
  if (bytes.length > limit) fail("INVALID_CORRECTION_FILE");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};
let store;
try {
  const [command, ...args] = process.argv.slice(2),
    counts = {
      import: [2],
      export: [1],
      preview: [2],
      plan: [1],
      approve: [2],
      apply: [1],
      "approve-rollback": [2],
      rollback: [1],
      revoke: [1],
      audit: [1, 2],
    };
  if (!Object.hasOwn(counts, command) || !counts[command].includes(args.length))
    fail("INVALID_CORRECTION_COMMAND");
  if (fs.existsSync("/.dockerenv") && !process.env.FRACTO_DATA_CORRECTION_DIR)
    fail("CORRECTION_CONFIGURATION_ERROR");
  store = new CorrectionStore(
    process.env.FRACTO_DATA_CORRECTION_DIR ||
      path.join(import.meta.dirname, "../runtime/corrections"),
    { read_only: ["export", "plan", "audit"].includes(command) },
  );
  let result;
  if (command === "import")
    result = store.register(args[0], read_json(args[1], 8 * 1024 ** 2));
  if (command === "export") result = store.read(args[0]);
  if (command === "preview")
    result = store.preview(args[0], read_json(args[1], 16384));
  if (command === "plan") result = store.plan(args[0]);
  if (command === "approve") result = store.approve(...args);
  if (command === "apply") result = store.apply(args[0]);
  if (command === "approve-rollback") result = store.approve_rollback(...args);
  if (command === "rollback") result = store.rollback(args[0]);
  if (command === "revoke") result = store.revoke(args[0]);
  if (command === "audit")
    result = store.audit(args[0], args[1] === undefined ? 0 : Number(args[1]));
  console.log(
    JSON.stringify(result, null, command === "export" ? undefined : 2),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        error instanceof CorrectionError
          ? error.code
          : "CORRECTION_STORAGE_UNAVAILABLE",
    }),
  );
  process.exitCode = 1;
} finally {
  store?.close();
}
