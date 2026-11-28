# Component: torch_wall

Blueprint key `torch-wall`, revision 4. Component name `torch_wall`, folder
`interiors`. Units meters, right-handed, Y up. The wall face is the plane z = 0;
the viewer stands on the +z side, so the viewer's left is −x.

## Identity and intent

A ceremonial stone doorway set into an ashlar wall, lit by a bow of eight torches
above the lintel (based on the user's reference image, with corrected torch spacing).
It reads as correct when: the pale limestone frame (two pillars and a lintel) stands
out clearly from the darker granite wall; the torches form one even, symmetrical fan
above the lintel reaching well beyond its ends; every flame burns straight up; and
the flame colors run through the orbital pattern colors 1, 3, 5 … 15 from left to right.

User requirements: torch tilt at most 30° either way; torches aimed at one common
point below the floor with exactly equal angles between neighbours; bow close to
the lintel; flame colors in pattern order left to right; frame lighter than the wall.
Adjustable defaults: wall width and height, block pattern, bow size, torch count.

## Material roles

- **pillar** — `stone-pillar` (pale limestone, about 1.0 × 2.5 × 0.8 m, slightly
  tapered). Two, one each side of the opening, projecting in front of the wall face.
- **lintel** — `stone-lintel` (pale limestone, about 5.2 × 0.55 × 0.95 m). Rests on the
  pillars and projects further than they do.
- **wall blocks** — `stone-wall-block-large/-medium/-small` (weathered granite,
  1.8/1.2/0.75 × 0.7 × 0.6 m). Stacked in 0.706 m courses behind the frame.
- **torch** — `fire-torch` (about 1.0 m, centimetre model; anchor at the back of the
  bracket at foot height, front facing +z). Its material carries the fire effect;
  each placement sets `flame_cardinality`.

The stone materials are generated placeholders (see the deployment checklist); a
replacement must keep the frame clearly lighter than the wall.

## Construction rules and dependency order

1. **Frame.** Pillars at x = ±1.27, centred 0.15 m in front of the wall face; the
   opening between them is about 1.54 m wide. The lintel sits on the pillars
   (bottom 2.504 m, top 3.059 m), centred at z = 0.2.
2. **Wall.** Eight courses of blocks centred 0.302 m behind the wall face (front faces
   at z ≈ 0). Courses whose top is below the lintel top fill outward from the opening
   to ±6.6 m; higher courses run the full width, alternate courses offset 0.45 m.
   Three repeating length patterns stagger the joints, and each row ends with the
   largest block that still fits inside ±6.6 m; blocks alternate 180° yaw for
   surface variety. 10 mm joints.
3. **Torches.** Eight torches on the wall face (z = 0). Their axes all pass through a
   common point 5.37 m below the floor (x = 0). Angles from vertical are
   −30° + k × 60°/7 (k = 0 … 7), so neighbours differ by exactly 8.571°. Each mounting
   point is where its axis meets an elliptical bow (half-width 5.0 m, rise 1.25 m) whose
   apex is 0.3 m above the lintel top. Resulting mounts: x ≈ ±0.65, ±1.97, ±3.30, ±4.60;
   y ≈ 3.34, 3.25, 3.04, 2.60. Tops lean outward. Flame cardinality 1, 3, 5, 7, 9, 11,
   13, 15 from left (−x) to right (+x).

The frame depends on the opening width; the bow depends on the lintel top.

## Lighting

An interior lit by its torches: stage sun 0.4 and ambient (sky) light 0.3, so the
firelight dominates the wall and the torches' shadows read clearly.

## Animation and behavior

No clips or motion. Each torch's fire is live (material effect): noise flames,
sparks and a flickering, slightly drifting light that casts the torch's crown and
handle shadow onto the wall behind it, always rising along world up regardless of the
torch's tilt; light range scales with the world size.

## Material substitution

Replacement stones keep the role sizes or the generator's dimensions must change
with them. A replacement torch needs construction metadata with the anchor at its
mounting point and a fire effect on its material.

## Acceptance and evidence

Rendered in the browser pane before saving: frame distinct from the wall; eight
evenly spaced torches (neighbour gaps 1.31–1.37 m along the bow), symmetrical,
tops leaning outward, flames vertical, colors in pattern order.

## Safe minor edits

Change parameters in `torch-wall.construction.json` and re-run
`generate_torch_wall.js`; object IDs are derived from role keys, so unchanged roles
keep their IDs. Read the saved revision and save with `expected_revision`.

## Decision log

- Rev 4: interior lighting (sun 0.4, ambient 0.3) so the torch shadows are strong;
  fire shadow bias raised to remove square artifacts on the uneven stone.

- Rev 3: torch fire light casts shadows from 30 units up and 35 out from the wall, so
  each torch throws a dancing shadow on the wall; torch pin updated.

- Rev 2: torch fire made much taller and fuller in the `fire-torch` material (size 100,
  width 60, intensity 0.7); torch pin updated to that material revision.

- Rev 1: torches arranged as a radial fan with equal angles (supersedes evenly spaced
  angles around the ellipse, which crowded the outer torches); bow lowered close to the
  lintel; pale limestone frame distinct from the granite wall.
