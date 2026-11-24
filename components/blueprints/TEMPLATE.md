# Component: <name>

Create `blueprints/<component-key>/` first, using a stable unique key. Save this
description as `<component-key>.md` there. Add a README identifying the component
and linking its description, structured parameters, accepted scene snapshot and
supporting evidence as they become available. Keep these files in that folder.
Create `variants/README.md` to reserve space for future variants. Each future
variant gets its own subfolder and uses [VARIANT_TEMPLATE.md](VARIANT_TEMPLATE.md):
reference the base revision and describe only specific overrides. All omitted
properties inherit from the base; do not repeat this entire component description.
Document saved scene identity/revision if realized. The stage previews patrol
speed and walk-clip rate overrides; other runtime overrides remain future work.

## Identity and intent

Record a stable blueprint key/revision, component ID and observed saved revision.
Describe intended use, units, dimensions, orientation and what makes a result
recognizably correct. Separate user requirements from adjustable defaults.

## Material roles

For each role, record purpose, current catalog ID/revision, kind/placement,
calibration, physical size and appearance targets, surface/clip selection and
acceptable substitutes. Explain size relationships between roles. Source scale
factors are reference evidence, not universal requirements for replacements.

## Construction rules and dependency order

Describe reference frame, semantic regions, distribution, counts versus density,
seed/random source, spacing, scale/yaw variation, exclusions, overlap, grounding,
landmarks and stopping/failure rules. Identify dependencies. Use regions/rules
instead of listing coordinates unless a particular location is intentional.

## Animation and behavior

Specify clips, forward direction, component clock, physical and effective speeds,
path limits, turning/looping, variation and pause. Record renderer conventions
affecting grounding. Keep authored behavior separate from transient render poses.

## Material substitution

Explain replacement sizing/grounding, what stays fixed, what regenerates, what
may vary, and which incompatibilities need discussion. Do not promise identical
results from different geometry or invent missing animations.

## Acceptance and evidence

List bounds/counts/coverage/visibility/motion checks and visual-review views.
State sampling, tolerances, observations, limitations and unmeasured qualities.
Link the realized snapshot and record its canonical scene hash when available.
Keep a full-scene hash in a companion record rather than self-referencing text
inside the scene being hashed. Read the current API revision before saving.

## Safe minor edits

Give examples of small role/parameter changes and affected dependencies. Preserve
unrelated placements and IDs. Read revisions, preview, validate and save with
conflict checks. Update description and realization together.

## Decision log

Record current rules and reasons for major revisions. Mark superseded decisions
clearly so they cannot silently return during regeneration.
