# Authored component snapshots

Component-specific snapshots now live beside their construction descriptions and
parameters in individual [blueprint folders](../blueprints/README.md).

The [grass strip folder](../blueprints/grass-strip/README.md) contains the accepted
scene snapshot, readable description, structured parameters and reserved variants
directory. Geometry remains the revision-8 model captured by
`milestone/component-construction-v1`; later description saves do not rebuild it.

Keep new component snapshots in their component's blueprint folder rather than
this shared examples directory. These exports are not automatic seeds or database
migrations; the live component remains owned by the component API.
