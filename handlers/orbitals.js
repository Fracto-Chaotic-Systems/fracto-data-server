import Complex from "../../../sdk/math/Complex.js";
import FractoFastCalc from "../../../sdk/FractoFastCalc.js";
import {copy_json} from "../../../utils.js";

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
      seed = seed_minus_P.sqrt()
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

const inverse_recurse = (negative_P, seed, point_path, scalar, iteration, max_depth) => {
   if (iteration > max_depth) {
      const point_list = point_path
         .map(point => `${point.scalar > 0 ? 'plus' : 'minus'}: ${point.point_str}`)
      // console.log(point_list)
      return {point_list, point_path, iteration}
   }
   const scaled_seed = seed.scale(1)
   const scaled_seed_add_negative_P = scaled_seed.add(negative_P)
   const new_seed = scaled_seed_add_negative_P.sqrt()
   const found_point = point_path.find(
      p => p.point.re === new_seed.re &&
         p.point.im === new_seed.im)
   if (found_point) {
      const point_list = point_path
         .map(point => `${point.scalar > 0 ? 'plus' : 'minus'}: ${point.point_str}`)
      console.log(point_list)
      return {point_list, point_path, iteration}
   }

   const seed_copy_1 = new Complex(new_seed.re, new_seed.im)
   const seed_copy_2 = new Complex(-new_seed.re, -new_seed.im)

   const point_path_1 = copy_json(point_path)
   point_path_1.push({
      point_str: seed_copy_1.toString(),
      point: seed_copy_1,
      scalar, iteration,
   })
   const point_path_2 = copy_json(point_path)
   point_path_2.push({
      point_str: seed_copy_2.toString(),
      point: seed_copy_2,
      scalar, iteration,
   })
   return {
      minus: inverse_recurse(
         negative_P, seed_copy_2, point_path_2, -1, iteration + 1, max_depth),
      plus: inverse_recurse(
         negative_P, seed_copy_1, point_path_1, 1, iteration + 1, max_depth),
   }
}

export const inverse_derivation = (focal_point, max_depth = 10) => {

   const P = new Complex(focal_point.x, focal_point.y)
   const Q_minus = FractoFastCalc.calculate_cardioid_Q(
      focal_point.x, focal_point.y, -1)
   const Q = new Complex(Q_minus.x, Q_minus.y)

   const negative_P = P.scale(-1)
   const Q_plus_negative_P = Q.add(negative_P)
   const seed = Q_plus_negative_P.sqrt()

   const seed_copy_1 = new Complex(seed.re, seed.im)
   const seed_copy_2 = new Complex(-seed.re, -seed.im)

   const point_path_1 = []
   const point_path_2 = []

   const all_paths = {
      plus: inverse_recurse(
         negative_P, seed_copy_1, point_path_1, 1, 0, max_depth),
      minus: inverse_recurse(
         negative_P, seed_copy_2, point_path_2, -1, 0, max_depth),
   }
   return {
      focal_point,
      P: P.toString(),
      Q: Q.toString(),
      all_paths,
      found_orbital: false,
   }
}

// const test_data = {x: -0.48066, y: 0.53038}
// const test_data_escape = {x: -0.45751, y: 0.55865}
//
// const result = inverse_derivation(test_data, 15)
// console.log(result)