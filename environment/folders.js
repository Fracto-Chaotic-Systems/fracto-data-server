import { normalize_model_folder } from "@fracto/sdk/FractoEnvironmentCatalog.js";
import {
  folder_contains,
  validate_model_management,
} from "@fracto/sdk/FractoModelManagement.js";

const fail = (code) => {
  throw new Error(code);
};
/** Definitions change in one transaction; model catalog files remain asset-owned. */
export async function manage_model_folder(pool, input) {
  const body = validate_model_management(input);
  if (!body.action.endsWith("-folder")) fail("invalid_record");
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [folders] = await db.execute(
      "SELECT folder_path FROM model_folders WHERE model_category=? FOR UPDATE",
      [body.category],
    );
    const [assets] = await db.execute(
      "SELECT folder_path FROM environment_assets WHERE archived=0 AND model_category=? FOR UPDATE",
      [body.category],
    );
    const paths = [
      ...new Set(
        [...folders, ...assets].map((row) => row.folder_path).filter(Boolean),
      ),
    ];
    const descendants = paths.filter((path) =>
      folder_contains(body.folder_path, path),
    );
    if (!descendants.length) fail("folder_not_found");
    if (body.action === "delete-folder") {
      if (
        descendants.some((path) => path !== body.folder_path) ||
        assets.some((row) => folder_contains(body.folder_path, row.folder_path))
      )
        fail("folder_not_empty");
      await db.execute(
        "DELETE FROM model_folders WHERE model_category=? AND BINARY folder_path=?",
        [body.category, body.folder_path],
      );
    } else if (body.target !== body.folder_path) {
      // Asset rows have already been updated by the asset service. Only definitions
      // collide here; target membership was checked before any catalog publication.
      if (folders.some((row) => folder_contains(body.target, row.folder_path)))
        fail("folder_conflict");
      const owned = folders.filter((row) =>
        folder_contains(body.folder_path, row.folder_path),
      );
      const targets = new Set([
        body.target,
        ...owned.map((row) =>
          normalize_model_folder(
            body.target + row.folder_path.slice(body.folder_path.length),
          ),
        ),
      ]);
      for (const row of owned) {
        await db.execute(
          "DELETE FROM model_folders WHERE model_category=? AND BINARY folder_path=?",
          [body.category, row.folder_path],
        );
      }
      for (const target of targets)
        await db.execute(
          "INSERT INTO model_folders (model_category,folder_path) VALUES (?,?)",
          [body.category, target],
        );
    }
    await db.commit();
    return {
      folder_path: body.folder_path,
      ...(body.target ? { target: body.target } : {}),
    };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
