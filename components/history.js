/**
 * One-line summaries of component document changes for the history log
 * (same shape as a material record's history: date, action, description).
 */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const json = (value) => JSON.stringify(value ?? null);

function compare(before = [], after = []) {
  const old = new Map(before.map((item) => [item.id, json(item)]));
  const ids = new Set(after.map((item) => item.id));
  return {
    added: after.filter((item) => !old.has(item.id)).length,
    removed: before.filter((item) => !ids.has(item.id)).length,
    changed: after.filter(
      (item) => old.has(item.id) && old.get(item.id) !== json(item),
    ).length,
  };
}
function describe(label, { added, removed, changed }) {
  const parts = [];
  if (added) parts.push(`added ${count(added, label)}`);
  if (removed) parts.push(`removed ${count(removed, label)}`);
  if (changed) parts.push(`changed ${count(changed, label)}`);
  return parts;
}

/** Editor labels sent with a save: at most 20 strings of 1–200 characters. */
export function validate_edit_notes(notes) {
  if (notes === undefined) return [];
  if (
    !Array.isArray(notes) ||
    notes.length > 20 ||
    notes.some(
      (note) =>
        typeof note !== "string" ||
        !note.trim() ||
        note.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(note),
    )
  )
    throw new Error("invalid_component_document");
  return notes.map((note) => note.trim());
}

const capitalize = (text) => text.replace(/^./, (first) => first.toUpperCase());
/** The editor's labels first ("Placed 30 × yard-grass; adjusted the lighting."), then the computed changes. */
const with_notes = (notes, description) =>
  (notes.length
    ? `${capitalize(notes.join("; "))}. ${description}`
    : description
  ).slice(0, 1000);

/**
 * Summarizes a save as `{action, description}`; `before` is null for a new
 * component. `notes` are the editor's labels for the edits since the last save.
 */
export function summarize_component_change(before, after, notes = []) {
  if (!before)
    return {
      action: "create-component",
      description: with_notes(
        notes,
        `Created "${after.name}" with ${count(after.objects.length, "placed object")} and ${count(after.scatters.length, "scatter rule")}.`,
      ),
    };
  const parts = [];
  if (before.name !== after.name)
    parts.push(`renamed "${before.name}" to "${after.name}"`);
  parts.push(
    ...describe("placed object", compare(before.objects, after.objects)),
  );
  parts.push(
    ...describe("scatter rule", compare(before.scatters, after.scatters)),
  );
  parts.push(...describe("group", compare(before.groups, after.groups)));
  if (json(before.floor) !== json(after.floor))
    parts.push(
      !after.floor
        ? "removed the floor"
        : !before.floor
          ? "added a floor"
          : "changed the floor",
    );
  if (json(before.lighting) !== json(after.lighting))
    parts.push("changed the lighting");
  if (json(before.animation_speed) !== json(after.animation_speed))
    parts.push("changed the animation speed");
  if (before.construction_description !== after.construction_description)
    parts.push("updated the construction document");
  const only_name = parts.length === 1 && before.name !== after.name;
  const sentence = parts.length
    ? parts.join("; ").replace(/^./, (first) => first.toUpperCase()) + "."
    : "Saved without changes.";
  return {
    action:
      only_name && !notes.length ? "rename-component" : "update-component",
    description: with_notes(notes, sentence),
  };
}

/** History entry for a folder move (direct or through a folder rename/move). */
export const folder_move_entry = (folder_path) => ({
  action: "move-folder",
  description: folder_path
    ? `Moved to the folder "${folder_path}".`
    : "Moved to the category root.",
});
