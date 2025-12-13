import express from 'express'

import {handle_main_status} from "./handlers/status.js";
import {handle_tile} from "./handlers/tile.js";

const app = express();
const FRACTO_DATA_PORT = 3002;

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

// Start the server and listen for incoming requests
app.listen(FRACTO_DATA_PORT, () => {
   console.log(`Server is running on http://localhost:${FRACTO_DATA_PORT}`);
});

app.get('/', handle_main_status)
app.get('/tile', handle_tile)