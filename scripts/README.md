# scripts

Data-service maintenance executables and helpers own SQL, database catalog builds, orbital verification and tile-table loading. Private credentials come from this service’s `config/`. Shared algorithms use `@fracto/sdk`. Root compatibility commands launch declared `fracto.commands` entries without importing implementations. Tile listing downloads use `FRACTO_TILE_REMOTE_BASE_URL`, or an explicit local source.
