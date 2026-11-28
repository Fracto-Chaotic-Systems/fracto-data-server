// Realizes torch-wall.construction.json as the SDK component document
// torch-wall.component.json. Deterministic: object IDs derive from role names.
//   node servers/fracto-data-server/components/blueprints/torch-wall/generate_torch_wall.js
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validate_component_document } from "@fracto/sdk/FractoComponentDocument.js";

const here = import.meta.dirname;
const spec = JSON.parse(
  fs.readFileSync(path.join(here, "torch-wall.construction.json"), "utf8"),
);
const round = (value) => Math.round(value * 1e5) / 1e5;
// Stable UUID v4-shaped identifiers from a key, so regeneration keeps object IDs.
const stable_id = (key) => {
  const hex = createHash("sha256").update(`torch-wall:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const role = (name) => {
  const { id, revision } = spec.material_roles[name];
  return { id, revision };
};
const groups = {
  frame: { id: stable_id("group:frame"), name: "doorway frame" },
  wall: { id: stable_id("group:wall"), name: "wall courses" },
  torches: { id: stable_id("group:torches"), name: "torches" },
};
const objects = [];
const place = (key, material, position, rotation, group, extra = {}) =>
  objects.push({
    id: stable_id(key),
    asset: role(material),
    position: position.map(round),
    rotation: rotation.map(round),
    scale: [1, 1, 1],
    group_id: groups[group].id,
    ...extra,
  });

// Frame: two pillars and the lintel, projecting from the wall face toward the viewer.
const door = spec.doorway;
place("pillar:left", "pillar", [-door.pillar_center_x_m, 0, door.pillar_center_z_m], [0, 0, 0], "frame");
place("pillar:right", "pillar", [door.pillar_center_x_m, 0, door.pillar_center_z_m], [0, Math.PI, 0], "frame");
place("lintel", "lintel", [0, door.lintel_bottom_y_m, door.lintel_center_z_m], [0, 0, 0], "frame");

// Wall courses around the opening.
const wall = spec.wall;
for (let course = 0; course < wall.courses; course++) {
  const y = course * wall.course_height_m;
  const pattern = wall.course_patterns[course % wall.course_patterns.length];
  const below_lintel_top = y + wall.course_height_m <= door.lintel_top_y_m + 0.01;
  const fill = (side, from, to, direction) => {
    let x = from,
      index = course;
    const sizes = ["wall_block_large", "wall_block_medium", "wall_block_small"];
    while (true) {
      const remaining = Math.abs(to - x);
      // Follow the course pattern, but end the row with the largest block that fits.
      let material = pattern[index % pattern.length];
      if (spec.material_roles[material].length_m > remaining)
        material = sizes.find(
          (size) => spec.material_roles[size].length_m <= remaining,
        );
      if (!material) break;
      const length = spec.material_roles[material].length_m;
      place(
        `wall:${course}:${side}:${index - course}`,
        material,
        [x + (direction * length) / 2, y, wall.center_z_m],
        [0, index % 2 ? Math.PI : 0, 0],
        "wall",
      );
      x += direction * (length + wall.joint_m);
      index++;
    }
  };
  if (below_lintel_top) {
    fill("left", -door.opening_half_width_m, -wall.half_width_m, -1);
    fill("right", door.opening_half_width_m, wall.half_width_m, 1);
  } else {
    fill("full", -wall.half_width_m + (course % 2) * 0.45, wall.half_width_m, 1);
  }
}

// Torches: radial fan from a common point below the floor, mounted where each axis
// meets the elliptical bow. Viewer-left is -x; tops lean outward.
const torches = spec.torches;
const { half_width_m: A, rise_m: B, apex_above_lintel_top_m: apex } = torches.bow;
const bow_center_y = door.lintel_top_y_m + apex - B;
const [, point_y] = torches.common_point_m;
for (let i = 0; i < torches.count; i++) {
  const phi = ((-torches.outer_angle_deg + i * torches.angle_step_deg) * Math.PI) / 180;
  const dx = Math.sin(phi),
    dy = Math.cos(phi);
  const a = (dx * dx) / A ** 2 + (dy * dy) / B ** 2,
    b = (2 * dy * (point_y - bow_center_y)) / B ** 2,
    c = (point_y - bow_center_y) ** 2 / B ** 2 - 1;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  place(
    `torch:${i + 1}`,
    "torch",
    [dx * t, point_y + dy * t, spec.frame.wall_face_z_m],
    [0, 0, -phi],
    "torches",
    { flame_cardinality: torches.cardinalities_left_to_right[i] },
  );
}

const document = validate_component_document({
  schema_version: 1,
  id: spec.component.id,
  name: spec.component.name,
  units: "m",
  coordinates: "right-handed-y-up",
  floor: null,
  objects,
  groups: Object.values(groups),
  scatters: [],
  lighting: spec.lighting,
  construction_description: fs.readFileSync(
    path.join(here, spec.description_document),
    "utf8",
  ),
});
fs.writeFileSync(
  path.join(here, "torch-wall.component.json"),
  `${JSON.stringify(document, null, 2)}\n`,
);
const count = (group) => objects.filter((o) => o.group_id === groups[group].id).length;
console.log(
  `torch-wall: ${objects.length} objects (frame ${count("frame")}, wall ${count("wall")}, torches ${count("torches")})`,
);
