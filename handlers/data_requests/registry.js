import { WORDNET_MAPPING_FIELDS } from "../wordnet_mappings.js";

const text = (characters, bytes, single_line = false) => ({
  validate: (value) =>
    typeof value === "string" &&
    Array.from(value).length <= characters &&
    Buffer.byteLength(value, "utf8") <= bytes &&
    !value.includes("\0") &&
    (!single_line || (value.trim().length > 0 && !/[\r\n]/.test(value))),
});

// Only non-personal application data belongs here. Registry identifiers are
// server-owned; request bodies cannot provide SQL, columns or filter expressions.
export const DATA_TABLES = {
  wordnet_mappings: {
    table: "wordnet_mappings",
    keys: {
      cardinality: {
        validate: (value) => Number.isSafeInteger(value) && value > 0,
      },
    },
    readable: WORDNET_MAPPING_FIELDS,
    writable: {
      world_name: text(255, 1020, true),
      notes: text(65535, 65535),
    },
  },
};
