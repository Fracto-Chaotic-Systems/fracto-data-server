import { DATA_TABLES } from "./registry.js";

export const request_error = (status, code, message) =>
  Object.assign(Error(message), { status, code });
const invalid = (message) => {
  throw request_error(400, "invalid_data_request", message);
};
const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const identifier = (name) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw Error("Invalid registry identifier");
  return `\`${name}\``;
};
const validate_fields = (values, fields, required) => {
  if (!object(values) || Object.keys(values).length === 0)
    invalid("A nonempty field object is required");
  const keys = Object.keys(values);
  if (
    required &&
    (keys.length !== Object.keys(fields).length ||
      Object.keys(fields).some((key) => !Object.hasOwn(values, key)))
  )
    invalid("The complete record key is required");
  for (const key of keys) {
    if (!Object.hasOwn(fields, key) || !fields[key].validate(values[key]))
      invalid("Unsupported field or invalid value");
  }
  return values;
};
export function parse_data_request(body, registry = DATA_TABLES) {
  if (!object(body) || Buffer.byteLength(JSON.stringify(body), "utf8") > 150000)
    invalid("Invalid data request body");
  if (!["get", "update"].includes(body.operation))
    invalid("Unsupported data operation");
  const allowed =
    body.operation === "update"
      ? ["operation", "table", "key", "values", "expected"]
      : ["operation", "table", "key"];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    invalid("Unsupported request property");
  if (typeof body.table !== "string" || !Object.hasOwn(registry, body.table))
    invalid("Unsupported data table");
  const spec = registry[body.table];
  const key = validate_fields(body.key, spec.keys, true);
  const values =
    body.operation === "update"
      ? validate_fields(body.values, spec.writable, false)
      : null;
  const expected = Object.hasOwn(body, "expected")
    ? validate_fields(body.expected, spec.writable, false)
    : null;
  return { operation: body.operation, spec, key, values, expected };
}
export const encoded = (field, value) =>
  field.encode ? field.encode(value) : value;
