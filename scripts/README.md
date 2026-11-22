# scripts

`check_startup_configuration.js` is a dependency-free startup executable declared
as `fracto.commands.startup_check`. It verifies this service's `config/mysql.json`
is readable and contains a JSON object, with actionable, credential-free failures.
It does not use the root configuration, contact MySQL or create configuration files.

Data-service maintenance executables and helpers own SQL, database catalog builds, orbital verification and tile-table loading. Private credentials come from this service’s `config/`. Shared algorithms use `@fracto/sdk`. Root compatibility commands launch declared `fracto.commands` entries without importing implementations. Tile listing downloads use `FRACTO_TILE_REMOTE_BASE_URL`, or an explicit local source.
