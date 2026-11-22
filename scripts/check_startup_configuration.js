import fs from "node:fs";
import path from "node:path";

const service_root = path.resolve(import.meta.dirname, "..");

export function check_startup_configuration() {
  const file = path.join(service_root, "config", "mysql.json");
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      "fracto-data-server: required service configuration config/mysql.json is missing or unreadable. " +
        "Provision servers/fracto-data-server/config/mysql.json on the host; production Compose mounts that directory read-only. " +
        "The root config/mysql.json does not configure this service. Git updates do not supply private configuration.",
    );
  }
  let config;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error(
      "fracto-data-server: config/mysql.json must contain valid JSON.",
    );
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(
      "fracto-data-server: config/mysql.json must contain a JSON object.",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    check_startup_configuration();
    console.log(
      "fracto-data-server: service configuration is readable and valid JSON.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
