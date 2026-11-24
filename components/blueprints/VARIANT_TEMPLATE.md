# Variant: <name>

## Base

Record the variant key/revision and reference the base component ID, blueprint
key/revision and relative description path. If exact realized placements matter,
also pin the base scene revision and canonical hash from its companion record.

This variant inherits every property of that base except the changes below.
Do not copy the full base construction description here.

## Changes

For each override, specify:

- Target role and property or construction rule.
- Operation: replace, multiply, add or explicitly remove, as appropriate.
- Value, units and scope (for example every member of a named role).

Apply changes once to the referenced base, never cumulatively to an already
modified realization. Omitted properties inherit unchanged. State regeneration
explicitly if required. Unresolved values or missing/incompatible targets must be
resolved before building. A new base revision requires an explicit rebase.

## Verification and realization

Record checks needed for the changed properties and their dependencies. The base
acceptance criteria remain in force except where explicitly overridden above.
Add a scene ID/revision, generated snapshot link and measured results when realized.
A full resolved snapshot is optional evidence, not a second construction description.
