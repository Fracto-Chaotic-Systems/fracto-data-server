import express from 'express'
import chalk from "chalk";
import path from "path";

import {FRACTO_DATA_PORT} from "../../constants.js";

import {handle_main_status} from "./handlers/status.js";
import {handle_logs} from "./handlers/logs.js";
import {
   handle_put_radial_point,
   handle_radian_data
} from "./handlers/radial_points.js";
import {handle_fracto_calc} from "./handlers/fracto_calc.js";
import {handle_farey_sequence} from "./handlers/utils.js";
import {handle_minibrots} from "./handlers/minibrots.js";
import {handle_asset, handle_assets} from "./handlers/handle_asset.js";
import {handle_backup} from "./handlers/handle_backup.js";
import {handle_solve} from "./handlers/solve.js";
import {handle_hyper_complex_buffer} from "./handlers/hyper-complex.js";
import {handle_tiles} from "./handlers/handle_tiles.js";
import {handle_orbital, handle_orbitals} from "./handlers/handle_orbital.js";
import {handle_tile_coverage} from "./handlers/handle_coverage.js";
import {handle_tile, handle_tile_get} from "./handlers/handle_tile.js";
import {handle_lore_categories} from "./handlers/handle_lore.js";

export const SEPARATOR = path.sep;

export const app = express();

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

app.use(express.json()); // For application/json
app.use(express.urlencoded({ extended: true })); // For application/x-www-form-urlencoded

// Start the server and listen for incoming requests
app.listen(FRACTO_DATA_PORT, () => {
   console.log(chalk.green(`fracto-data-server is running on http://localhost:${FRACTO_DATA_PORT}`));
});

app.get('/', handle_main_status)
app.get('/logs', handle_logs)

app.get('/fracto_calc', handle_fracto_calc)

app.get('/utils/farey_sequence', handle_farey_sequence)
app.get('/radian_data', handle_radian_data)
app.put('/radial_point', handle_put_radial_point)

app.get('/minibrots', handle_minibrots)
app.get('/asset', handle_asset)
app.get('/assets', handle_assets)

app.get('/tiles', handle_tiles)
app.get('/tile_coverage', handle_tile_coverage)
app.get('/tile', handle_tile_get)
app.put('/tile', handle_tile)
app.get('/backup', handle_backup)

app.get('/solve', handle_solve)
app.get('/orbital', handle_orbital)
app.get('/orbitals', handle_orbitals)

app.get('/lore_categories', handle_lore_categories)

app.get('/hyper_complex_buffer', handle_hyper_complex_buffer)

