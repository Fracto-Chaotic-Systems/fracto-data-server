# Grass strip variants

Each variant inherits the referenced base blueprint and describes only explicit
changes. See the [variant template](../../VARIANT_TEMPLATE.md).

- [Ladybug zoomies](ladybug-zoomies/README.md): 8× insect translation speed and
  matching 8× walk-clip playback, relative to grass strip blueprint revision 6,
  saved scene revision 16. Authored delta only; no realized scene is saved.

Keep each variant in its own stable subfolder and reference it from the parent
component README. The stage supports selecting a variant to preview its supported
overrides, then clicking it again to restore the base. Only one variant can be
selected. Other construction overrides and durable resolved scenes remain future
work.
