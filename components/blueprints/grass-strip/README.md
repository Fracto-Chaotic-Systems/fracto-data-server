# Grass strip

Component `0bb37175-0459-49bf-b5fc-f918bf090563`, blueprint key `grass-strip`.
This folder holds the files for the 1 × 20 m grass strip, including its procedural
grass distribution and twenty walking ladybugs.

- [Construction description](grass-strip.md): editable intent, material roles,
  generation rules, animation and acceptance criteria; exported from the component.
- [Structured parameters](grass-strip.construction.json): material pins, measured
  results, saved revision and canonical snapshot hash.
- [Accepted scene snapshot](grass-strip.component.json): exact realized placements
  and the associated description. Geometry was accepted at scene revision 8;
  current base revision 17 includes edge/shelter grass, buried rocks and grounded roots.
- [Edge-softening evidence](grass-strip.edge-softening.json): generation parameters,
  animated bounds, coverage and insect visibility checks.
- [Sparse-grass shelter evidence](grass-strip.sparse-shelter.json): matched blade
  heights, independent 1× wind, patrol cover and animated visibility checks.
- [Unique-rock evidence and part map](grass-strip.rocks.json): 84 source identities,
  material pins, sizes, scatter modes and grounded-placement checks.
- [Central burial evidence](grass-strip.buried-rocks.json): the same 84 rocks at
  double scale, 60 central placements and individual 25–75% burial.
- [Grass grounding evidence](grass-strip.grounding.json): all 560 grasses lowered
  15 mm, with at least 5 mm soil overlap throughout the sampled wind poses.
- [Pre-grounding backup](grass-strip.before-grounding.json): saved revision 16
  before the vertical-only grass correction.
- [Variants](variants/README.md): changes inherited from this base.
  [Ladybug zoomies](variants/ladybug-zoomies/README.md) scales insect movement and walk animation by 8×.

The live component is owned by the revision-checked component API. These files are
versioned exports; read the current saved scene and description before editing.
Refresh the description, companion metadata and snapshot together when recording
an accepted repository version. See the [workflow](../README.md).

To restore a snapshot, read the destination revision and use the documented
`PUT /component-documents/:id` with its document and that expected revision.
Review before replacing a newer scene. This folder is not an automatic seed or
database migration, and material binaries remain owned by the asset service.

Base revision 14 adds sparse cover around all 20 patrols and matches all sparse
grass to adjacent dense-grass height. All sparse clips run at their own native 1×;
original grass and insects retain the inherited 0.125× component clock.

Base revision 15 adds exactly 84 unique centimetre-scale pebbles from the source
rock array, with no duplicated pieces. The previous 580 objects are preserved.

Base revision 16 supersedes the initial rock sizes and layout: each rock is twice
its revision-15 size, 60 lie in the central half-width, and all are partly buried
by individually sampled fractions between 25% and 75% of their height.

Base revision 17 lowers all 420 dense grass patches and 140 sparse tufts from
Y=0 to -0.015 m. Dirt stays at -0.005 m; precise animated bounds over 49 native
wind poses show at least 6.847 mm dense-grass and 10 mm sparse-grass overlap.
Every X/Z location, scale, heading, clip rate, ladybug and rock is preserved.
The associated construction document supersedes the former Y=0 grass rule.
