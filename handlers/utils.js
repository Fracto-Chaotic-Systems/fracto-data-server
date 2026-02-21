import fs from 'fs';
import csv from 'csv-parser'
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const csv_to_json = async (csv_file, cb) => {
   const results = []
   fs.createReadStream(csv_file)
      .pipe(csv())
      .on("data", (data) => {
         results.push(data); // Each 'data' event provides a JSON object for a row
      })
      .on("end", () => {
         cb(results)
      });
}

export const handle_farey_sequence = (req, res) => {
   csv_to_json(`${__dirname}/../farey_sequence.csv`, result =>{
      res.json(result)
   });
}