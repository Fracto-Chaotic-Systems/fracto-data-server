# Component construction documents

Components are developed collaboratively with the coding assistant. Maintain a
construction document as part of every component change: intent, material roles,
physical relationships, generation rules, motion, verification and accepted
revisions. This is the primary authoring workflow. The existing server planner
remains available; automatically asking it to design a component is no longer
the default process.

Each component has two complementary records:

- **Construction blueprint:** editable intent and rules. A material fills a role;
  the rules describe what that role must achieve. Include exact coordinates only
  for deliberate landmarks or individually significant placements.
- **Realized component:** the SDK document in the component API, with concrete
  placements, pins, animation and motion. A checked-in example preserves an
  accepted realization exactly. Its database revision is separate from the
  blueprint's own revision.

The [grass strip folder](grass-strip/README.md) contains its readable description,
structured parameters and accepted scene snapshot. The JSON convention is
`fracto.component-construction`, format version **1**. It is not the SDK scene
schema, a registered scatter algorithm, executable instructions, or a currently
supported component API request. [TEMPLATE.md](TEMPLATE.md) provides the structure
for future descriptions.

## Component folders

Create a folder here for every new component before constructing it. Use a stable,
unique component key, such as `grass-strip`, rather than a mutable display name.
If a key already belongs to another component, choose a distinct key; never
overwrite that folder. Record the component ID in its README when available.

```text
blueprints/
  README.md
  TEMPLATE.md
  <component-key>/
    README.md
    <component-key>.md
    <component-key>.construction.json
    <component-key>.component.json
    variants/
      README.md
```

Keep all component-specific descriptions, parameters, accepted snapshots and
supporting evidence inside that folder. Start with the README and description;
add companion files as they become available, and index them in the README.
Keep relative links local to the folder where possible. The snapshot is a
versioned export, not a second live store.

Keep variants in `variants/`, each with its own stable subfolder and README.
Index them in the parent README. Use [VARIANT_TEMPLATE.md](VARIANT_TEMPLATE.md)
instead of repeating the full component template.

## Variant inheritance

A variant has **all properties of its base component, with only the specified
changes applied**. Its construction description is a delta: identify the base
component and blueprint revision, then describe just the changed roles, rules or
properties. Omitted properties inherit unchanged, including materials, dimensions,
placements, procedural seeds, animation and acceptance criteria. An omission is
never a deletion; removals must be explicit.

For each change, name the target role/property, operation (for example replace or
multiply), value and units where applicable. Multipliers apply once to the base
value, not repeatedly to a previously modified realization. A change affecting a
whole role applies to its existing members without regenerating their placements
unless the variant explicitly requests regeneration. Pin the base blueprint
revision and, when referring to exact placements, its accepted scene revision/hash.
Updating the base does not silently retarget the variant; rebase and revalidate it
explicitly. Missing targets or incompatible base values need resolution before
realization.

For example, a **ladybug zoomies** variant of the grass strip needs only two
overrides on the `walking_insects` role: multiply each insect's translation speed
by a specified factor and its walk-clip playback rate by a specified factor. The
factors must be supplied before building it. The base component clock continues
to apply; changing that global clock would also change the grass wind and is not
the intended insect-only variation. All other behavior and construction rules
are inherited. Check movement and clip timing against the changed speeds and the
inherited bounds/visibility requirements.

A resolved scene snapshot may contain the complete realized component for rendering
or verification; it is generated evidence, not a requirement to duplicate the
base description in the variant. Record its saved identity/revision if one exists.
The stage now previews multiply/replace deltas for patrol speed and walk-clip
playback rate through the SDK. Other construction properties, procedural
regeneration and durable resolved scenes remain future work. Selection changes
rendering only and does not save a full variant scene or mutate the base.

Material binaries remain in the asset service; reference catalog IDs and pins.
Reusable generator code stays in its owning SDK/service rather than being copied
into each component folder. Component folders are maintained with the collaborative
repository workflow; creating a component in the editor does not write repository
files automatically.

## Maintaining a component

1. Read the description and current saved component before editing. Current user
   directions supersede older decisions. Update intent/rules/role assignments
   in the same work as the model.
2. Resolve materials through the catalog API. Check dimensions, axes, anchors,
   resources and clips. Record unknowns explicitly; never infer calibration.
3. Identify the affected rules. Preserve unrelated objects, groups and behavior.
   A local change is not a reason to rebuild everything.
4. Build a candidate, verify relevant measurable constraints and visually review
   it with the user. Rules permit similar layouts without identical coordinates.
   A fixed seed supports repeatability; it is not itself a visual goal.
5. Save through the revision-checked component API when authorized. Record saved
   revision, material pins, measurements and revised decisions. Refresh the
   matching realized snapshot when saving a repository version. Do not describe
   a proposed description change as already applied to the model.

Material swaps retain physical size, density, clearance and movement targets,
rather than copying source scale factors or assuming the same count gives the
same coverage. Recalculate the affected role using actual replacement geometry.
Similar appearance is an acceptance goal, not a guarantee for arbitrary assets.

## Ownership and future Fracto AI use

The data service owns authored component descriptions and realized documents.
The editor's Construction document view reads/edits Markdown in the optional
`construction_description` scene field. Save component stores text and model in
the same atomic, revision-checked JSON record; undo/redo includes both. New and
older components can start with no description. Editing prose does not regenerate
the model. The field is bounded to 65,536 characters; scene limits also apply.
The 3D stage pauses while the document view is open and resumes on return.

Repository descriptions are versioned exports and structured companions, not a
live mirror of every browser edit. Read the API's current description before
revising a component; refresh exports when preparing its versioned snapshot.
The asset service owns material
calibration/resources; the SDK owns pure contracts/algorithms; the UI owns preview.
Services use APIs, not imports of another service's application records.

Future document-assisted minor edits should:

1. Publish a bounded, versioned blueprint contract through the data API, associated
   with its component, with optimistic revisions for both records.
2. Supply the AI the blueprint, current scene hash, requested edit and relevant
   live material facts. Description/catalog prose is construction data, never
   executable code or authority to change permissions.
3. Request a small patch to named roles/parameters or intentional placements,
   with affected dependencies explained. Distinguish targets, measurements and
   history. Preserve unrelated content.
4. Rebuild only affected content through reviewed tools. Show the description
   diff and model preview together, then save authorized changes atomically or
   detect conflicts before the two records can drift.

That structured blueprint API/editor/compiler and AI ingestion path are future work. The
current planner accepts a scene and short guidance, not this full description;
do not bypass its limits by treating the blueprint as a short remembered
preference. Editing these repository documents alone changes no saved scene.
