# Torch wall

Component `6d9ef545-91e9-47c1-8c56-a9f885276f4c`, name `torch_wall`, folder `interiors`, blueprint key
`torch-wall`. A stone doorway with a pale limestone frame in a granite ashlar wall,
lit by a radial fan of eight pattern-colored fire torches.

- [Construction description](torch-wall.md): intent, roles, rules and decisions.
- [Structured parameters](torch-wall.construction.json): material pins, doorway,
  wall courses, torch fan and colors.
- [Generator](generate_torch_wall.js): realizes the parameters as the SDK scene.
- [Scene snapshot](torch-wall.component.json): the realized document as saved.
- [Variants](variants/README.md): none yet.

Regenerate with `node servers/fracto-data-server/components/blueprints/torch-wall/generate_torch_wall.js`,
then save through `PUT /component-documents/:id` with the current revision. The live
component is owned by the component API; these files are versioned exports.
