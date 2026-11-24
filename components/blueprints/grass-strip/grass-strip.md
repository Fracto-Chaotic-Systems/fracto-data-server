# Grass strip — construction description

Blueprint `grass-strip`, revision 7. Describes component
`0bb37175-0459-49bf-b5fc-f918bf090563`, with the original layout accepted at scene revision **8** and edge accents added at scene revision **13**, followed by sparse-grass shelter
and independent animation clocks in base scene revision **14**.
The [structured companion](grass-strip.construction.json) holds full material
pins, named parameters and measured results. The [realized snapshot](grass-strip.component.json)
holds exact placements. This readable description is also saved with the component
as `construction_description` and can be edited in its Construction document view.
Description-only saves advance the component revision without rebuilding geometry.

## Intent and requirements

Construct a 1 m wide × 20 m long dirt strip with visibly irregular grass clumps
covering most ground. Leave openings through the middle where small walking
insects can be seen. Keep one insect in each metre. Preserve believable insect
size relative to individual grass blades and slow forward walking.

The latest direction supersedes the earlier completely filled, 809-patch cover
and edge-only insects. Do not restore either during regeneration. The intended
identity is the proportions, physical relationships, irregular majority cover,
interior visibility and behavior, rather than any particular blade coordinate.

Use metres, right-handed Y-up. The floor is centred on XZ: X ∈ [-0.5, 0.5] and
Z ∈ [-10, 10]. Its current renderer plane is Y=-0.005, below logical ground Y=0.
Metre section k is Z ∈ [-10+k, -9+k], for k=0…19.

## Material roles

| Role            | Current material                        | Required characteristics                                                            |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| Ground surface  | `dry_dirt` (`dry-dirt`)                 | Calibrated floor surface with a registered dirt color image and physical tile size. |
| Grass cover     | `yard_grass_motion` (`yard-grass`)      | Calibrated ground clump; narrow blades, varied tall form and wind animation.        |
| Sparse grass | `animated_grass` (`animated-grass`) | Sparse animated tufts for irregular patch edges and light shelter over insect patrols. |
| Unique pebbles | 84 individually extracted `rocks-piece-001`…`rocks-piece-084` | Every source rock once, original shape/textures, 2–5 cm horizontal diameter, partially buried 25–75% of height. |
| Walking insects | `ladybug_with_animated_walk_cycle_only` | Calibrated ground insect, known head direction and an in-place walking clip.        |

The JSON companion pins exact catalog revisions. Resolve those pins before an
edit; do not silently use changed calibration. Material descriptions are data,
not executable instructions. Source files and original animation clips remain
owned by the asset service.

Ground: use `runtime/surface-base-color-6f30180943ade5c3.png`. Its tile size is
1 × 1 m, so current UV repeat is [1,20]. For replacements, calculate repeat from
floor dimensions divided by the new physical tile dimensions.

Grass: reference footprint is [1.617138,1.4689622] m; vertical extent is
0.5173413 m. Sample a common planar scale s in [0.15,0.34] and an independent
vertical scale h in [0.45,0.55]. Store scale [s,h,s]. This produces approximately
24–55 cm wide × 22–50 cm deep patches with 23–28 cm tall grass. Uniformly random
yaw supplies variation; the narrower footprints reduce overlap while preserving
tall blades. Ground anchors are at Y=-0.015 m, buried below the dirt surface. Loop wind clip `Object_0`.

Insects: current uniform scale is 1.5. The full silhouette, including legs and
antennae, is about 13.3 mm long, 12.7 mm wide and 6.6 mm high. The body is narrower
than the full silhouette. As a proportion check, the reference grass's measured
median mid-height blade width was 25.4 mm at planar scale 0.55; current planar
scales correspond roughly to 7–16 mm. Keep insects on this small scale, not sized
against the entire clump. Feet sit 0.2 mm above the current dirt plane, giving
an anchor Y=-0.0048 after calibrated ground anchoring. The head is authored +Z.
Use the in-place `ArmatureAction` walk clip.

## Construction process

Build dependencies in this order: materials → floor → insect anchors/behavior
→ dense-grass openings → randomized original grass → sparse edge/patrol shelter
→ unique pebbles → bounds, motion and visual checks → revision-checked save.
Preserve original placements for local additions. Dense-grass openings protect
insect movement; sparse foliage may shelter patrols, while rocks must keep the
straight patrols clear of physical obstacles.

### Insects and openings

For each metre k, sample X uniformly in [-0.23,0.23] and Z uniformly in
[-10+k+0.25,-10+k+0.70]. Thus all insects are in the central half of the width,
with enough longitudinal room to walk without crossing their metre boundary.

The revision-8 change retained each insect's identity, group, calibrated scale,
heading and motion from revision 7; only X/Z anchors changed. When reconstructing
this version or swapping foliage, take those retained values from the snapshot.
For a fresh analogous component, sample varied headings generally along +Z or
-Z with small deviations, and independently varied patrol lengths/speeds from
the ranges below. Check complete moving silhouettes, not just anchor points.

Reserve an XZ ellipse around each patrol midpoint. If starting anchor is (x,z),
heading is yaw and patrol length is d, its centre is:

```text
cx = x + sin(yaw) * d/2
cz = z + cos(yaw) * d/2
((X-cx)/0.065)^2 + ((Z-cz)/0.105)^2 < 1
```

This protects a minimum 13 × 21 cm opening. Actual gaps can be larger and
irregular because clumps are accepted or rejected as whole models. Openings are
visibility constraints, not a continuous path through the component.

### Randomized grass placement

Use the seed and algorithm parameters in the companion. The revision-8 PRNG is
an unsigned 32-bit LCG: update state with `(1664525*state+1013904223) mod 2^32`,
then return state/2^32. Start at 941723. Consume two draws per insect (X then Z,
in snapshot order), before grass candidates. UUID creation uses a separate source
and does not consume placement randomness.

Use a 50 × 1000 grid of 2 cm sample centres over the floor. Mark protected-opening
cells using the ellipses. Coverage is the union of actual leaf triangles projected
onto XZ, not the much larger rectangular clump footprints. Degenerate projected
triangles contribute no area. Grid centres inside projected triangles count as
covered; source textures are not sampled by this measurement.

Repeat at most 22,000 attempts, stopping early on 67% total coverage or the
420-clump budget:

1. Every third attempt, starting at attempt 0, choose the first metre with the
   fewest covered samples; otherwise choose a random metre.
2. In draw order, sample planar scale s, yaw in [0,2π), X, Z within that metre,
   and vertical scale h. Clip the sampled Z anchor to the floor's legal centre
   interval. Round emitted transforms to nine decimal places.
3. Bound the full rotated footprint. For reference width w and depth d:
   `hx=(abs(cos(yaw))*w+abs(sin(yaw))*d)*s/2`, and
   `hz=(abs(sin(yaw))*w+abs(cos(yaw))*d)*s/2`. Sample X between -0.5+hx and
   0.5-hx; constrain Z between -10+hz and 10-hz.
4. Project the candidate's actual triangles onto the grid. Reject any clump
   covering a protected-opening sample. Reject fewer than 35 projected samples,
   or candidates adding less than 30% new coverage relative to their own covered
   samples. Otherwise accept the whole clump and update total/per-metre coverage.

Finish with actual triangle raycasts around moving insect bodies. Remove any
clump blocking the clearance rays, then recompute coverage. Current static
checks use five body points (centre, X±3 mm, Z±3 mm) at patrol start, midpoint
and end, from above. The algorithm removed zero clumps in the saved result.

The 67% target is adjustable; 420 is the current performance/density budget, not
an artistic requirement to preserve for every replacement. Revision 8 reached
the budget at **65.072%**, within the intended 60–70% total cover range, with
60.8–70.72% cover per metre. Do not add clumps merely to force the target if doing
so hides insects or recreates the overly packed appearance. A failed target or
replacement must be reported and reviewed rather than silently discarding rules.

### Sparse grass: edges and patrol shelter (base revision 14)

This is part of the base component, not a variant. Retain all 420 original
`yard_grass_motion` patches, the dirt floor and all 20 insect anchors/behavior.
The `edge_softening` role now contains 140 `animated_grass` tufts: 120 retained
edge anchors from revision 13 and one additional shelter tuft around each of the
20 patrols. Sparse grass is allowed over insect paths and may partially conceal
walking insects from predators. The original dense grass must still respect its
protected openings; those exclusions no longer apply to the sparse material.

The calibrated reference footprint is [3.4674518,3.9124897] m, vertical extent
1.2169935 m, Y-up/+Z-forward, with source ground anchor
[-0.1333994,-0.0890255,-0.0571738] m. Retain the original edge tufts' planar scales s in [0.028,0.046]; new patrol
tufts use s in [0.028,0.040]. Their footprints stay roughly 9.7–16.0 cm wide
and 11.0–18.0 cm deep. For every sparse tuft, find the nearest original grass
patch by XZ anchor distance (first in snapshot order on ties). Match its leaf
height: target_height_m = 0.5173413 * original.scale[1], then set sparse Y scale
to target_height_m / 1.2169935. The accepted heights are **23.28–28.39 cm**,
matching the adjacent dense grass. Keep anchored roots at Y=-0.015 m, as specified by the grounding rule below.

Set each sparse object's persisted `animation_speed` to **1**. Its original
`Object_0` wind clip runs at native 1× real time, independently of the component
clock. This is an absolute authored clip rate, not an 8× compensation for the
component multiplier. Preserve the original grass and insect timing.

The following historical edge-anchor procedure explains the 120 retained
placements. Its initial patrol guard and sampled Y scales describe revision 13,
not current sparse-grass restrictions or height. Preserve those anchors; their
Y scales are now replaced by the nearest-patch height rule above. Consume the
old vertical-scale draw when replaying the historical seed so anchors repeat.

Use the same unsigned LCG as the original cover but an independent seed
**282706**, with the following `patch-edge-feather-v1` rules. This name documents
the procedure; it is not a registered SDK scatter algorithm.

1. Assign each original patch to its anchor's metre section (clamped 0–19).
   Target six accepted accents per selected patch section, up to 1,000 attempts
   per section, 20,000 attempts overall and 120 accepted accents. Choose the
   eligible section with the fewest accents, then fewest attempts, then lowest
   index. A new accent's anchor can cross its source patch's metre boundary;
   these counts describe source-patch sections, not insect assignments.
2. Consume draws in this order: original patch index within that section; one
   of its four rectangular footprint sides; side fraction t in [-0.5,0.5];
   outward offset in [-0.025,0.025] m; planar scale s; yaw in [0,2π); vertical
   scale h. On an X side use local X=±(patch width/2+offset), local Z=t*depth;
   on a Z side use local X=t*width, local Z=±(depth/2+offset). Rotate this local
   point by the original patch yaw and translate by its anchor. Random UUIDs
   use a separate source and do not consume these placement draws. Round emitted
   positions, yaw and scales to nine decimal places.
3. Measure the new material's actual geometry at 24 evenly spaced phases over
   its native 9.9666662 s clip. Form a conservative symmetric XZ bound using
   the largest absolute coordinate on each axis. Rotate and scale that bound
   for each candidate. Reject if it extends beyond the 1 × 20 m floor or
   intersects any patrol-midpoint exclusion ellipse with radii [0.075,0.115] m.
   The added 1 cm guard surrounds the original protected openings. For ellipse
   intersection, use its nearest point on the candidate's XZ bound.
4. Reject accent centres within 0.13 m of an accepted accent. On the original
   cover's unchanged 2 cm triangle-projection grid, inspect a 5 × 5 window
   centred at the candidate's grid cell, counting only samples inside the floor.
   Accept only original coverage fractions between 0.12 and 0.80. This avoids
   burying tufts inside dense cover or scattering them detached from patch edges.
5. Project the new tuft's default-pose triangles to that same grid. Require at
   least one sample overlapping original grass, at least five newly covered
   samples and a newly covered fraction between 0.20 and 0.85 of its own samples.
   Count new coverage against all previously accepted grass, then update the
   coverage grid. Preserve rejected-attempt draw consumption.
6. This completes the historical edge-anchor pass. Current shelter placement
   and acceptance are defined below; do not reapply this historical exclusion
   to the new patrol tufts or regenerate unrelated original patches.

#### Patrol shelter pass

Use an independent LCG seed **174284** with the same integer update as above.
In the existing insect snapshot order, centre one new tuft on each patrol
midpoint: [bug.x + sin(yaw)*distance/2, 0, bug.z + cos(yaw)*distance/2]. Consume
a yaw draw in [0,2π), then a planar-scale draw in [0.028,0.040]. Set the height
from the nearest original patch as above, set `animation_speed:1`, and use the
same sparse-grass group. UUID generation consumes no placement randomness.
Round emitted transforms to nine decimal places. Do not move the insects or
exclude these tufts from the patrol region. Keep every tuft inside the floor.
The tufts' footprints enclose the short patrols, allowing insects to spend their
walk beneath this sparse cover rather than in completely bare openings.

#### Acceptance and substitution

Dense grass must not obscure the protected patrols. Sparse blades may overlap
insect silhouettes and occasionally conceal them; the former requirement for
zero sparse-grass ray intersections is superseded. Inspect their transparency
and movement visually, report occlusion separately by foliage type, and ensure
no insect is permanently hidden throughout the sampled animation sequence.

The accepted 580-object scene has 420 original patches, 140 sparse tufts and 20
unchanged insects. A 73-frame test spanning one slow-grass cycle sampled the
faster sparse wind across eight cycles. All 140 sparse meshes animated and all
sampled vertices stayed within the floor. Of 7,300 overhead body rays, 4,679
intersected sparse grass and **zero** intersected the original dense grass.
Each insect had at least one geometrically clear body ray in 46–73 of 73 frames;
197 of 1,460 insect-frames had all five rays intersect sparse geometry. These
intersections are permitted shelter, not proof of visual invisibility: texture
alpha is not sampled by the ray test. Textured views confirmed an insect visible
beneath the sparse blades. Sampled sparse Y extents were -1.36 mm to 28.44 cm,
still above the dirt plane at -5 mm. The original 420 patches and all insect
transforms, sizes and patrol behavior are unchanged.

The last projected-cover measurement, **66.642%**, describes revision 13 before
the 20 shelter tufts. It is historical evidence, not a new revision-14 measurement.
See [sparse-grass evidence](grass-strip.sparse-shelter.json) for current checks
and [edge-anchor evidence](grass-strip.edge-softening.json) for the retained layout.
Sampling does not guarantee visibility from every angle or at every instant.

For material swaps, preserve the small sparse footprint, dense-grass leaf height,
partial edge overlap and light cover around patrols. Derive dimensions and the
animated envelope from replacement calibration and geometry. Preserve the sparse
material's explicit native 1× clock. Rebuild only this role unless changed geometry
requires wider review; retain all original-cover and insect IDs and behavior.

### Central, partially buried rocks (base revision 16)

Keep exactly the same **84 unique source rocks** introduced in revision 15,
with the same object IDs, material pins, textures, aspect ratios and yaw. There
is still one instance of every original mesh and no whole-array instance. The
source `rocks` array and its 84 individually extracted assets remain unchanged.

#### Source and size

The source is the 84-mesh array in `terrain/rocks`. Derived materials
`rocks-piece-001`…`rocks-piece-084` live in `terrain/rocks/individual-rocks`.
Each contains one original mesh with its ancestor transforms, material, UVs,
normals/tangents and embedded image bytes. A new root removes the array layout
by centring XZ, grounding minimum Y and normalizing maximum XZ extent to one metre.
This is a derived coordinate convention, not an assumed real-world source size.
Original embedded creator/license credit is preserved: Loïc Norgeot, “Lowpoly
Rocks - Free Download”. The [original extraction and part map](grass-strip.rocks.json)
records source identities, pins and the revision-15 baseline sizing.

**Double every revision-15 object's XYZ scale exactly once.** Do not sample a new
size, change its aspect ratio, or apply the doubling repeatedly to an already
updated scene. Preserve each rock's relative size and orientation. The resulting
full horizontal diameters are **20.08–49.19 mm** (target range 2–5 cm), measured as
the maximum XZ distance between transformed vertices before soil occlusion.
Grass remains about 233–284 mm tall. Burial can make the exposed rock cap look
smaller than the full rock; do not compensate by changing these physical sizes.
The [current part map](grass-strip.buried-rocks.json) records previous/current
per-object scales and all accepted placements.

#### Central gap distribution

Use the documented `central-buried-rocks-v1` procedure, with independent unsigned
LCG seed **150216** and the same integer update as the earlier grass/rock passes.
This refines the existing rock role; it is not a new SDK scatter algorithm.

1. Begin with the 84 existing rocks in component snapshot order and Fisher–Yates
   shuffle a copy (i=83 down to 1, j=floor(R*(i+1))). Keep the actual scene's
   object order and IDs unchanged. Retain each rock's assigned metre from the
   revision-15 part map: the strip still has four or five rocks per metre.
2. In shuffled processing order, assign the first three rocks in each metre to
   its central half-width, X∈[-0.25,0.25] m. Place all other rocks in outer gap
   bands, |X|∈[0.25,0.43] m. This gives **60 central rocks** (three in each metre)
   and 24 others, versus only 15 central rocks before this refinement. Positions
   are randomized within those regions rather than placed on a visible grid.
3. Draw one burial fraction f uniformly in **[0.25,0.75]** for each rock and keep
   it fixed during position attempts. Its scale is exactly twice its baseline,
   and its previous yaw is retained; no new size/yaw draws are consumed.
4. Sample each central candidate's X uniformly in [-0.25,0.25], then sample Z
   uniformly within its assigned metre and legal whole-rock floor bounds.
   For an outer candidate, draw the X sign first (equal probability), then
   |X|=0.25+R*0.18, then Z. Preserve the draws of rejected attempts.
5. Classify grass gaps using the original and sparse foliage's default-pose
   triangle projections on a 1 cm floor grid, without sampling texture alpha.
   Require the rock centre clear of original dense-grass projection and at most
   three occupied samples in its 3 × 3 dense-grass neighbourhood. Require
   foliage at three or more of eight compass samples on a circle of radius
   0.08 m. This favours gaps among plants instead of exposed edge-only dirt;
   sparse grass and wind may naturally cover parts of a rock.
6. Keep every full rotated footprint within X∈[-0.5,0.5], Z∈[-10,10], including
   buried geometry. Keep rock centres at least radius_A+radius_B+0.005 m apart,
   and farther than rock_radius+0.010 m from every full ladybug patrol segment.
   Radius is the scaled furthest XZ vertex from the normalized rock origin.
   Preserve insect anchors and their straight patrol behavior.
7. Try at most 12,000 candidate positions per rock; report a fit failure rather
   than drop or duplicate a piece. Round emitted position coordinates to nine
   decimal places. Retain the exact doubled scales and original yaw values.

#### Burial and verification

The dirt surface is at Y=-0.005. With the normalized rock's minimum Y at zero,
place its anchor at:

`anchor_y = -0.005 - f * native_height * doubled_scale_y`

This puts 25–75% of its total vertical extent below the soil plane. The opaque
dirt surface hides that geometry; only its upper portion remains exposed. The
accepted fractions are **26.49–74.39%**, with exposed heights of about
**4.34–29.73 mm**. This replaces the old uniform 8% burial rule.

The accepted pass used 1,034 attempts, retains all 84 source identities, and
leaves 60 rocks in the middle half-width, three in every metre. All complete
rock meshes remain inside the floor, each partially below and partially above
the dirt. The minimum patrol clearance beyond rock radius is 19.15 mm. Original
vegetation, sparse-grass native 1× clocks, ladybug sizes/motion and the inherited
0.125× component clock are unchanged. Scene content remains 664 objects.
Textured views were inspected for central grass-gap placement and partial burial.

See [buried-rock evidence](grass-strip.buried-rocks.json) for the per-piece
fractions, doubled scales, source pins and vertex-based measurements. The older
[rock evidence](grass-strip.rocks.json) describes initial extraction and the
superseded smaller, mostly edge-biased layout; its old 42/42 open/gap split is no
longer a current requirement.

For substitutions, retain a set of 84 distinct pieces, the current per-piece
physical diameters, central distribution and individual burial fractions.
Recalibrate replacement geometry, derive uniform scale from its true horizontal
diameter, recompute Y from its scaled height, then recheck gaps, bounds, overlaps
and patrol clearance. Preserve unrelated vegetation/insects. A changed shape may
require local resampling; it is not permission to duplicate or discard rocks.

## Grass grounding (base revision 17)

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

## Animation and movement

The component's saved inherited animation multiplier is **0.125×**. Original
`yard_grass_motion` wind, insect walk clips and patrol translation use that
clock. Sparse `animated_grass` objects instead carry `animation_speed:1` and
run their wind at native **1×** regardless of the component multiplier, including
when it is zero. An object's explicit clock affects clips, not patrol translation.
Hiding the stage pauses all rendering. Zoomies changes only insect rates; both
grass types keep these base clocks.

Each insect has `facing-patrol-v1`: walk 25–40 mm along its heading, turn 180° at
the endpoint, then walk back. Native speeds are 0.0056–0.008 m per component
second, giving about **0.7–1.0 mm per real second** at the current multiplier.
The saved extrema are 0.702993–0.975790 mm/s. Preserve these physical/effective
speed distinctions if the component multiplier changes. Forward means the
calibrated model head direction, not an assumed original source axis. Never
slide a model backwards while continuing a forward walk cycle.

The stored transform is the patrol's initial anchor, not a continuously saved
rendered pose. Reloading/rebuilding resets playback time. The 20 patrols vary in
length/speed, so their turnarounds do not all occur together.

## Swapping materials

Bind a replacement to a role. Keep the floor size, insect sections, protected
openings, accepted coverage range and behavioral intent. Resolve its current
calibration and resources first.

For grass, preserve the physical dimensions implied by the reference samples:
`target_width=1.617138*s`, `target_depth=1.4689622*s`,
`target_height=0.5173413*h`. Derive the replacement's X/Z scales from its oriented
footprint and its Y scale from the calibrated vertical extent. Check whether
that anisotropic fit remains natural; discuss a materially different plant form.
Rerun projected coverage/visibility with the new geometry. Keep insect anchors
and behavior; clump coordinates and counts may change. A seed alone cannot make
different geometry visually equivalent.

For insects, use uniform scale to target approximately 13.3 mm total forward
length. Check body/blade proportions and patrol bounds, then derive grounding
from the actual feet anchor and floor height. Preserve identity, metre assignment,
headings and behavior where compatible. Recheck the opening against the new
silhouette and its animation envelope. A flying, giant or uncalibrated model, or
one lacking a suitable in-place clip, needs a design decision instead of a silent
substitution. Root-motion clips must not double the authored patrol translation.

For ground, retain floor geometry and physical texture scale. A ground material
swap normally needs no insect or grass redistribution.

## Verification and safe minor edits

Check floor dimensions, exact role pins/resources, total budget, one insect per
metre, central X range, grounding and complete moving bounds. Measure actual
projected cover and inspect overall distribution plus interior close-ups. Sample
visibility with wind and walking enabled. Current evidence is 300 clear overhead
body rays across real times 0/10/20/30/40 seconds, all 20 animated rigs and
forward-facing patrols checked over 160 sampled seconds, and exact save/reload.
These samples do not guarantee visibility from every camera or at every instant.

The companion records the repository snapshot's scene hash. Measurements above
describe the original layout accepted at revision 8; the edge-softening section
records additions accepted at revision 13. Description-only saves need not repeat
unchanged geometry checks. Read the live component's description and current revision before
editing; reconcile model differences and preserve unaffected
roles/IDs. Examples:

- Change dirt: update its role/pin/tiling, preserve placements.
- Make grass sparser: revise the coverage goal/budget, regenerate grass around
  existing openings, preserve insects and behavior.
- Change walking speed: change insect motion parameters, preserve anchors/clumps
  if existing paths still fit; recheck turning and bounds.
- Move an insect or enlarge an opening: update that anchor/region and affected
  nearby foliage, then recheck local coverage/visibility.

Update this description and the structured parameters with every accepted model
revision. Record measured results separately from targets. The future Fracto AI
should propose these small, named changes and show their effects; a request to
edit a parameter is not permission to redesign unrelated parts.

## Decision record

- Initial dense cover: 809 overlapping patches; superseded as overly packed.
- Revision 7: 20 small walking ladybugs in visible edge gaps.
- Revision 8: 420 randomized narrower clumps, majority cover and central openings;
  supersedes edge-only placement. Insect scale/behavior and 0.125× timing retained.
- Blueprint revision 1: documents this accepted construction for collaborative
  maintenance, material substitution and eventual document-assisted minor edits.
  Runtime blueprint ingestion is not yet implemented.
- Blueprint revision 2: readable Markdown is saved inside the component and
  editable in the editor. Geometry and behavior are unchanged; structured AI
  ingestion remains future work.

- Blueprint revision 3 / base scene revision 13: added 120 small animated edge
  tufts to soften selected square patch outlines. Original 420 patches, dirt,
  insects and 0.125× timing are unchanged. Existing zoomies overrides inherit
  this updated base; insect speed/clip multipliers remain 8×.

- Blueprint revision 4 / base scene revision 14: retain edge accents, match their
  height to adjacent dense grass, add 20 sparse patrol-centred shelter tufts and
  author independent 1× clip clocks for all 140 sparse-grass objects. Sparse
  foliage may cover insect paths; dense-grass exclusions remain unchanged.

- Blueprint revision 5 / base scene revision 15: added every one of the 84 source
  rocks exactly once as 1–2.5 cm pebbles, in seeded open-ground and grass-gap
  positions. Original vegetation, insect patrols and animation clocks are unchanged.

- Blueprint revision 6 / base scene revision 16: preserve the same 84 rocks,
  double each baseline scale once, move 60 into the central half-width and apply
  individual 25–75% burial. This supersedes revision-15 rock sizes, 42/42 modes,
  edge bias and 8% burial; all non-rock content remains unchanged.

- Blueprint revision 7 / base scene revision 17: lower all 560 grass anchors to
  Y=-0.015 m for at least 5 mm soil overlap through sampled wind poses. All
  other placements, scales, pins, animation rates and insect motion are retained.
