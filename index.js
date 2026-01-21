import express from 'express'
import chalk from "chalk";
import path from "path";
import {execSync} from 'child_process'

import {FRACTO_DATA_PORT} from "../../constants.js";

import {handle_main_status} from "./handlers/status.js";
import {handle_logs} from "./handlers/logs.js";
import {db_connect} from "./mysql.js";
import {handle_core_calc} from "./handlers/core_calc.js";
import {handle_put_radial_point} from "./handlers/radial_points.js";

export const SEPARATOR = path.sep;

export const app = express();
export const db = db_connect()

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

execSync(`php .${SEPARATOR}php${SEPARATOR}startup.php`)

// Start the server and listen for incoming requests
app.listen(FRACTO_DATA_PORT, () => {
   console.log(chalk.green(`fracto-data-server is running on http://localhost:${FRACTO_DATA_PORT}`));
});

app.get('/', handle_main_status)
app.get('/logs', handle_logs)

app.get('/core_calc', handle_core_calc)

app.put('/radial_point', handle_put_radial_point)
