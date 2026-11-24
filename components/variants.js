import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const default_root = fileURLToPath(new URL("./blueprints/", import.meta.url));
const key_pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function directories(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length > 1000) throw new Error("variant_limit");
    return entries.filter(
      (entry) => entry.isDirectory() && key_pattern.test(entry.name),
    );
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function json_file(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 65536)
    throw new Error("invalid_variant_file");
  return JSON.parse(await readFile(file, "utf8"));
}

// Only the data service reads its authored blueprint exports. Caller-supplied
// component IDs are compared with metadata, never interpolated into file paths.
export function create_component_variants({ root = default_root } = {}) {
  return async (component_id) => {
    const variants = [];
    for (const component of await directories(root)) {
      const folder = path.join(root, component.name);
      let blueprint;
      try {
        blueprint = await json_file(
          path.join(folder, `${component.name}.construction.json`),
        );
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (blueprint.realization?.component_id !== component_id) continue;
      const variant_root = path.join(folder, "variants");
      // Do not traverse a symlink in place of the variants directory.
      try {
        if (!(await lstat(variant_root)).isDirectory())
          throw new Error("invalid_variant_directory");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      for (const entry of await directories(variant_root)) {
        const variant = await json_file(
          path.join(variant_root, entry.name, `${entry.name}.variant.json`),
        );
        if (
          variant.format !== "fracto.component-construction-variant" ||
          variant.format_version !== 1 ||
          variant.variant_key !== entry.name ||
          variant.base?.component_id !== component_id ||
          typeof variant.name !== "string" ||
          !variant.name.trim() ||
          variant.name.length > 120 ||
          !Number.isInteger(variant.variant_revision) ||
          variant.variant_revision < 1 ||
          !Array.isArray(variant.overrides) ||
          variant.overrides.length > 100 ||
          variant.overrides.some(
            (override) =>
              typeof override.target?.role !== "string" ||
              override.target.role.length > 120 ||
              typeof override.target?.property !== "string" ||
              override.target.property.length > 120 ||
              !["multiply", "replace", "add", "remove"].includes(
                override.operation,
              ) ||
              !(
                (typeof override.value === "string" &&
                  override.value.length <= 1000) ||
                (typeof override.value === "number" &&
                  Number.isFinite(override.value)) ||
                typeof override.value === "boolean" ||
                override.value === null
              ),
          )
        )
          throw new Error("invalid_component_variant");
        if (
          variants.some((item) => item.key === variant.variant_key) ||
          variants.length >= 100
        )
          throw new Error("variant_limit");
        variants.push({
          key: variant.variant_key,
          name: variant.name,
          revision: variant.variant_revision,
          base: {
            component_id: variant.base.component_id,
            scene_revision: variant.base.scene_revision,
          },
          role_groups: blueprint.realization.role_groups,
          overrides: variant.overrides,
        });
      }
    }
    return {
      variants: variants.sort(
        (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
      ),
    };
  };
}
