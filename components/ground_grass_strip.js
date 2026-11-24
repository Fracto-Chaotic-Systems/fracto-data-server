import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { component_document_json } from "@fracto/sdk/FractoComponentDocument.js";

// One accepted editorial correction, guarded against applying to a newer scene.
const folder = new URL("./blueprints/grass-strip/", import.meta.url);
const url =
  "http://localhost:3102/component-documents/0bb37175-0459-49bf-b5fc-f918bf090563";
const read = async (path) =>
  JSON.parse(await fs.readFile(new URL(path, folder), "utf8"));
const write = (path, value) =>
  fs.writeFile(new URL(path, folder), JSON.stringify(value, null, 2) + "\n");
const get = async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  return response.json();
};
const before = await get();
assert.equal(
  before.revision,
  16,
  "Read and reconcile a newer base before repeating this edit",
);
const parameters = await read("grass-strip.construction.json");
const hash = (document) =>
  createHash("sha256").update(component_document_json(document)).digest("hex");
assert.equal(
  hash(before.document),
  parameters.realization.canonical_scene_sha256,
);
const document = structuredClone(before.document);
const ids = new Set(["yard-grass", "animated-grass"]);
const grasses = document.objects.filter((o) => ids.has(o.asset.id));
assert.equal(grasses.length, 560);
assert.ok(grasses.every((o) => o.position[1] === 0));
for (const object of grasses) object.position[1] = -0.015;
const section = `## Grass grounding (base revision 17)

All 420 dense patches and 140 sparse tufts have calibrated root anchors at
Y=-0.015 m. This lowers every grass object 15 mm from revision 16. Dirt remains
at Y=-0.005 m, so nominal roots extend 10 mm below the soil. The requirement is
at least 5 mm of soil overlap, including wind movement. A 49-pose sample across
each actual native wind clip found a maximum dense-grass base lift of 3.153 mm
at the largest current vertical scale: the least sampled overlap is 6.847 mm.
Sparse-grass sampled overlap is at least 10 mm. This supersedes the earlier
logical-Y=0 root-placement rule for both grasses.

Preserve every X/Z anchor, yaw, scale, material pin and animation rate. Ladybugs,
rocks and the floor are unchanged. When swapping grass materials, resolve the
calibrated source ground anchor, sample the replacement wind clip, and lower
the placement enough that the highest sampled root/base stays at least 5 mm
below the actual dirt plane. Do not change catalog calibration to bury one
component's grass. See [grounding evidence](grass-strip.grounding.json).

`;
document.construction_description =
  document.construction_description
    .replace(
      "Blueprint `grass-strip`, revision 6.",
      "Blueprint `grass-strip`, revision 7.",
    )
    .replace(
      "Ground anchors are at logical Y=0.",
      "Ground anchors are at Y=-0.015 m, buried below the dirt surface.",
    )
    .replace(
      "Keep anchored roots at Y=0.",
      "Keep anchored roots at Y=-0.015 m, as specified by the grounding rule below.",
    )
    .replace(
      "## Animation and movement",
      section + "## Animation and movement",
    ) +
  "\n- Blueprint revision 7 / base scene revision 17: lower all 560 grass anchors to\n  Y=-0.015 m for at least 5 mm soil overlap through sampled wind poses. All\n  other placements, scales, pins, animation rates and insect motion are retained.\n";
assert.equal(document.objects.length, before.document.objects.length);
for (let i = 0; i < document.objects.length; i++) {
  const expected = structuredClone(before.document.objects[i]);
  if (ids.has(expected.asset.id)) expected.position[1] = -0.015;
  assert.deepEqual(document.objects[i], expected);
}
await write("grass-strip.before-grounding.json", before);
const response = await fetch(url, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Origin: "http://localhost:3106",
  },
  body: JSON.stringify({ document, expected_revision: before.revision }),
  signal: AbortSignal.timeout(20000),
});
assert.equal(
  response.status,
  200,
  "No automatic write retry; reload to resolve any lost response",
);
const saved = await response.json(),
  reopened = await get();
assert.equal(saved.revision, 17);
assert.deepEqual(reopened, saved);
assert.equal(
  component_document_json(saved.document),
  component_document_json(document),
);
parameters.blueprint_revision = 7;
parameters.realization.observed_saved_revision = saved.revision;
parameters.realization.canonical_scene_sha256 = hash(saved.document);
for (const role of ["grass_cover", "edge_softening"])
  parameters.material_roles[role].anchor_y_m = -0.015;
parameters.grass_grounding = {
  saved_revision: saved.revision,
  floor_y_m: -0.005,
  anchor_y_m: -0.015,
  minimum_required_soil_overlap_m: 0.005,
  verification_document: "grass-strip.grounding.json",
  replacement_rule:
    "Recalibrate root anchor and sample wind; highest animated base must stay at least 0.005 m below the dirt plane.",
};
await write("grass-strip.component.json", saved.document);
await fs.writeFile(
  new URL("grass-strip.md", folder),
  saved.document.construction_description,
);
await write("grass-strip.construction.json", parameters);
const evidence = {
  from_revision: before.revision,
  saved_revision: saved.revision,
  floor_y_m: -0.005,
  previous_anchor_y_m: 0,
  anchor_y_m: -0.015,
  vertical_translation_m: -0.015,
  dense_grass_count: 420,
  sparse_grass_count: 140,
  minimum_required_overlap_m: 0.005,
  sampled_frames_per_native_clip: 49,
  measured_native_base_y_range_m: {
    "yard-grass": [-0.0010971635529509402, 0.005734671211337541],
    "animated-grass": [-0.00588385959522561, -4.959058762243895e-8],
  },
  minimum_sampled_dense_overlap_m: 0.006847658896648492,
  minimum_sampled_sparse_overlap_m: 0.010000009487255804,
  method:
    "Actual registered GLBs, stage anchoring/unit transforms, first wind clip sampled at 49 evenly spaced poses, precise posed vertex bounds and every current object vertical scale.",
  preserved:
    "All object IDs, X/Z positions, yaw, scales, material pins and clocks; floor, insects and 84 unique rocks unchanged.",
  exact_save_reload_verified: true,
  canonical_scene_sha256: hash(saved.document),
};
await write("grass-strip.grounding.json", evidence);
const variantPath = "variants/ladybug-zoomies/ladybug-zoomies.variant.json";
const variant = await read(variantPath);
assert.equal(variant.base.scene_revision, before.revision);
variant.variant_revision++;
variant.base.scene_revision = saved.revision;
variant.base.blueprint_revision = parameters.blueprint_revision;
variant.base.canonical_scene_sha256 = hash(saved.document);
await write(variantPath, variant);
const variantReadme = new URL("variants/ladybug-zoomies/README.md", folder);
let text = await fs.readFile(variantReadme, "utf8");
text = text
  .replace("revision **5**", "revision **6**")
  .replace("revision **6**, component", "revision **7**, component")
  .replace("revision **16**.", "revision **17**.");
await fs.writeFile(
  variantReadme,
  text +
    "\nRevision 6 rebases the unchanged two 8× insect overrides onto base scene 17 /\nblueprint 7. Both grasses inherit the deeper ground contact; insect rates,\nplacements and rock settings remain unchanged by this variant.\n",
);
console.log(
  JSON.stringify({
    revision: saved.revision,
    grasses_lowered: grasses.length,
    anchor_y_m: -0.015,
    exact_save_reload_verified: true,
    variant_revision: variant.variant_revision,
  }),
);
