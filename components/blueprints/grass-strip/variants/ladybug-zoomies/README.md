# Ladybug zoomies

Variant `ladybug-zoomies`, revision **6**.

## Base

Inherit all properties of the [grass strip](../../grass-strip.md), blueprint
revision **7**, component `0bb37175-0459-49bf-b5fc-f918bf090563`, saved scene
revision **17**. The [delta record](ladybug-zoomies.variant.json) pins the
base scene hash and contains only the two overrides below.

## Changes

| Target role       | Property                               | Operation           | Value |
| ----------------- | -------------------------------------- | ------------------- | ----- |
| `walking_insects` | Translation speed (`motion.speed_mps`) | Multiply base value | 8×    |
| `walking_insects` | Walk-clip playback rate                | Multiply base value | 8×    |

Apply both multipliers once to each insect's base value, under the inherited
component clock. Matching factors retain the base relationship between distance
traveled and walk cycles. No placement regeneration is requested. All omitted
properties inherit from the pinned base.

## Verification and realization

The base and its snapshot matched saved scene revision 12 when this variant
was authored. The role resolves to 20 insects. The two equally scaled rates
preserve their relative speed variation and walk-cycle-to-distance ratio.
At the inherited component clock, movement is approximately 5.62–7.81 mm/s and
walk playback is 1× native clip time (8 × the base 0.125× rate).

Before realization, resolve the pinned base and apply the two overrides; validate
patrol bounds, facing, visibility and walk timing over complete out-and-back
cycles. The inherited acceptance criteria remain in force.

Only this delta is saved. No full scene copy or live component edit was made.
The stage now previews these two overrides with insect-specific clip rates.
Select Ladybug zoomies to preview it; click it again to restore the base.
`walk_clip.playback_rate` names a semantic property resolved to renderer options,
not a persisted SDK scene field. The base scene and delta remain separate.

Live renderer verification used all 20 saved insects and the real walk rig,
checking base → zoomies → base across three time steps per mode. Patrol positions
and bone transforms matched independently sampled motion and clip clocks. The
saved component remained unchanged at revision 12. Grass/shared-source clip-rate
isolation is covered separately by renderer tests.

Revision 2 explicitly rebases the unchanged pair of 8× overrides onto base scene
13 / blueprint 3, inheriting its edge-softening grass. No full variant scene is
stored. Earlier revision-12 verification above describes the original delta;
the rebased preview was also verified against saved base 13: all 20 patrols and
walk-bone transforms matched base/zoomies/base clocks, with no scene writes.

Revision 3 rebases the same two 8× insect overrides onto base scene 14 / blueprint 4. Sparse grass inherits native 1× wind and patrol shelter; original grass retains
0.125× wind. No full variant scene is stored.

Revision 4 rebases the same two 8× insect overrides onto base scene 15 / blueprint
5, inheriting all 84 uniquely extracted rocks. The rocks and vegetation are
unchanged by zoomies, and no full variant scene is stored.

Revision 5 rebases the unchanged pair of 8× insect overrides onto base scene 16 /
blueprint 6. It inherits the same 84 doubled, centrally distributed, partially
buried rocks; vegetation and rock settings are unchanged by zoomies.

Revision 6 rebases the unchanged two 8× insect overrides onto base scene 17 /
blueprint 7. Both grasses inherit the deeper ground contact; insect rates,
placements and rock settings remain unchanged by this variant.
