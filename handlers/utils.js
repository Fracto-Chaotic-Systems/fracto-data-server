import fs from 'fs';
import csv from 'csv-parser'
import {fileURLToPath} from 'url';
import {dirname} from 'path';

import Complex from "../../../sdk/math/Complex.js";
import FractoFastCalc from "../../../sdk/FractoFastCalc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_MAGNITUDE = 1.618
const MAX_ITERATIONS = 10000

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
   csv_to_json(`${__dirname}/../farey_sequence.csv`, result => {
      res.json(result)
   });
}

const orbital_recurse = (
   negative_P, negative_Q, seed, all_points, iteration, limit) => {
   if (iteration > limit) {
      return false
   }

   const step_1a = seed.add(negative_P)
   const step_1b = step_1a.sqrt()
   const seed_1 = step_1b.add(negative_Q)
   if (seed_1.magnitude() < MAX_MAGNITUDE) {
      const seed_1_str = seed_1.toString()
      if (all_points[seed_1_str]) {
         console.log(`found cycle: ${iteration - all_points[seed_1_str].iteration}`)
         return true
      }
      all_points[seed_1_str] = {point: seed_1, iteration: iteration}
      const recurse_1 = orbital_recurse(
         negative_P, negative_Q, seed_1, all_points, iteration + 1, limit)
      if (recurse_1) {
         console.log(seed_1_str)
         return true
      }
   }

   const step_2b = step_1b.scale(-1)
   const seed_2 = step_2b.add(negative_Q)
   if (seed_2.magnitude() < MAX_MAGNITUDE) {
      const seed_2_str = seed_2.toString()
      if (all_points[seed_2_str]) {
         console.log(`found cycle: ${iteration - all_points[seed_2_str].iteration}`)
         return true
      }
      all_points[seed_2_str] = {point: seed_2, iteration: iteration}
      const recurse_2 = orbital_recurse(
         negative_P, negative_Q, seed_2, all_points, iteration + 1, limit)
      if (recurse_2) {
         console.log(seed_2_str)
         return true
      }
   }
   return false
}

export const derive_orbital_not = (focal_point, limit = 10) => {
   console.log('derive_orbital', focal_point)
   if (Number.isNaN(focal_point.x) || Number.isNaN(focal_point.y)) {
      return {error: 'bad numbers', focal_point}
   }

   const P = new Complex(focal_point.x, focal_point.y)
   const Q_minus = FractoFastCalc.calculate_cardioid_Q(
      focal_point.x, focal_point.y, -1)
   const Q = new Complex(Q_minus.x, Q_minus.y)
   const negative_Q = Q.scale(-1)
   const negative_P = P.scale(-1)

   const negative_P_add_Q = negative_Q.add(negative_P)
   const sqrt_negative_P_add_Q = negative_P_add_Q.sqrt()
   const neg_sqrt_negative_P_add_Q = sqrt_negative_P_add_Q.scale(-1)

   const seed_1 = sqrt_negative_P_add_Q.add(negative_Q)
   const seed_2 = neg_sqrt_negative_P_add_Q.add(negative_Q)

   const all_points = {
      [seed_1.toString()]: {point: seed_1, iteration: 0},
      [seed_2.toString()]: {point: seed_2, iteration: 0},
   }
   const recurse_1 = orbital_recurse(
      negative_P, negative_Q, seed_1, all_points, 1, limit)
   const recurse_2 = orbital_recurse(
      negative_P, negative_Q, seed_2, all_points, 1, limit)

   return {
      focal_point,
      P: P.toString(),
      Q: Q.toString(),
      all_points,
      found_orbital: recurse_1 || recurse_2,
   }
}

export const derive_orbital = (focal_point, limit = 10) => {
   console.log('derive_orbital', focal_point)
   if (Number.isNaN(focal_point.x) || Number.isNaN(focal_point.y)) {
      return {error: 'bad numbers', focal_point}
   }

   const P = new Complex(focal_point.x, focal_point.y)
   const Q_minus = FractoFastCalc.calculate_cardioid_Q(
      focal_point.x, focal_point.y, -1)
   const Q = new Complex(Q_minus.x, Q_minus.y)
   const negative_P = P.scale(-1)
   const negative_P_add_Q = Q.add(negative_P)

   let seed = negative_P_add_Q.sqrt()
   const all_points = {}
   for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const seed_str = seed.toString()
      if (all_points[seed_str]) {
         return {
            focal_point,
            P: P.toString(),
            Q: Q.toString(),
            all_points,
            iteration,
            found_orbital: iteration - all_points[seed_str].iteration,
         }
      }
      all_points[seed_str] = {point: seed, iteration}
      const seed_minus_P = seed.add(negative_P)
      seed = seed_minus_P.sqrt().scale(-1)
      if (seed.magnitude() > 2) {
         break
      }
   }
   return {
      focal_point,
      P: P.toString(),
      Q: Q.toString(),
      all_points,
      found_orbital: false,
   }
}
