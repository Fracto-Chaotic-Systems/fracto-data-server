import Complex from "../../../sdk/math/Complex.js";
import {COEFF_5_REGULAR} from "./beast_mode_data.js";

const DIVISIONS = 250
const INITIAL_RADIUS = 0.1
const RETRY_COUNT = 100
const RETRY_FACTOR = 0.15

const approximate_radius = (radius, start_z, coefflist, path_factor) => {
   const increment = radius / DIVISIONS
   let best_magnitude = 1000
   let best_re = 0
   let best_im = 0
   const half_radius = radius / 2
   for (let re_offset = -DIVISIONS / 2; re_offset < DIVISIONS / 2; re_offset += 1) {
      for (let im_offset = -DIVISIONS / 2; im_offset < DIVISIONS / 2; im_offset += 1) {
         const offset = new Complex(
            increment * re_offset,
            increment * im_offset);
         const z = start_z.add(offset)
         let current_z = new Complex(1, 0)
         let current_function = new Complex(path_factor, 0)
         for (let power = 1; power < coefflist.length; power++) {
            current_z = current_z.mul(z)
            const addend_func = current_z.scale(coefflist[power])
            current_function = current_function.add(addend_func)
         }
         const magnitude = current_function.magnitude()
         if (magnitude < best_magnitude) {
            best_magnitude = magnitude
            best_re = z.re
            best_im = z.im
         }
      }
      if (best_magnitude < 0.00000000000001) {
         break;
      }
   }
   // console.log(best_magnitude)
   return new Complex(best_re, best_im)
}

export const approximate = (start_z, coefflist, path_factor = 1) => {
   let z = new Complex(start_z.re, start_z.im)
   let radius = INITIAL_RADIUS
   for (let i = 0; i < RETRY_COUNT; i++) {
      z = approximate_radius(radius, z, coefflist, path_factor)
      radius *= RETRY_FACTOR
   }
   console.log('best', path_factor, z.toString())
   return z
}

// const Z_3 = new Complex(0.3795, 0.3349)
// const z_10 = approximate(Z_3, COEFF_5_REGULAR, 0.0)
// const z_11 = approximate(z_10, COEFF_5_REGULAR, 0.1)
// const z_12 = approximate(z_11, COEFF_5_REGULAR, 0.2)
// const z_13 = approximate(z_12, COEFF_5_REGULAR, 0.3)
// const z_14 = approximate(z_13, COEFF_5_REGULAR, 0.4)
// const z_15 = approximate(z_14, COEFF_5_REGULAR, 0.5)
// const z_16 = approximate(z_15, COEFF_5_REGULAR, 0.6)
// const z_17 = approximate(z_16, COEFF_5_REGULAR, 0.7)
// const z_18 = approximate(z_17, COEFF_5_REGULAR, 0.8)
// const z_19 = approximate(z_18, COEFF_5_REGULAR, 0.9)
// const z_20 = approximate(z_19, COEFF_5_REGULAR, 1.0)