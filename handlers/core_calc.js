import Decimal from "decimal.js";
import BigComplex from "../../../sdk/math/BigComplex.js";
import FractoBigNumber from "../../../sdk/FractoBigNumber.js";

const detect_orbital = (P, initial_Q, initial_iteration) => {
   let Q = new BigComplex(initial_Q.re, initial_Q.im)
   let pattern = 0;
   let max_magnitude = 0
   let all_points = []
   let offset = initial_iteration
   let iteration = initial_iteration
   let calc_points = {}
   let vertex_re = 0
   let vertex_im = 0
   for (; iteration > 0; iteration++) {
      Q = Q.mandelbrot(P)
      all_points.push({x: Q.re, y: Q.im})
      const Q_str = Q.toString()
      if (calc_points[Q_str]) {
         const first_iteration = calc_points[Q_str]
         pattern = iteration - first_iteration
         for (let index = 0; index < pattern; index++) {
            const iteration_point = all_points[iteration - offset - index]
            if (!iteration_point) {
               continue;
            }
            const vertex = new BigComplex(iteration_point.x, iteration_point.y)
            const segment = vertex.add(negative_focal_Q)
            const magnitude_value = segment.magnitude()
            const magnitude = parseFloat(magnitude_value.toString())
            if (magnitude > max_magnitude) {
               max_magnitude = magnitude
               vertex_re = vertex.re
               vertex_im = vertex.im
            }
         }
         if (max_magnitude) {
            break;
         }
      }
      calc_points[Q_str] = iteration
      if (iteration % 10000 === 0) {
         calc_points = {}
         offset = iteration
         all_points = []
      }
   }
   return {
      pattern,
      magnitude: max_magnitude,
      iteration,
      vertex_re,
      vertex_im,
   }
}

export const core_calc = (r_num, r_den, theta_num, theta_den, resolution, base_iterations) => {
   Decimal.set({precision: resolution, rounding: 2})
   const r_num_big = new Decimal(r_num);
   const r_den_big = new Decimal(r_den);
   const r_big = r_num_big.div(r_den_big)
   const theta_num_big = new Decimal(theta_num);
   const theta_den_big = new Decimal(theta_den);
   const theta_big = theta_num_big.div(theta_den_big)
   const P = BigComplex.P_from_r_theta(r_big, theta_big)
   const focal_Q = FractoBigNumber.calculate_focal_Q(r_big, theta_big)
   let Q = new BigComplex(0, 0)
   for (; iteration < base_iterations; iteration++) {
      Q = Q.mandelbrot(P)
   }
   const results = detect_orbital(P, Q, iteration)
   return {
      r_big: r_big.toString(),
      theta_big: theta_big.toString(),
      magnitude: results.magnitude.toString(),
      iteration: results.iteration,
      cardinality: results.pattern,
      P_re: P.re.toString(),
      P_im: P.im.toString(),
      Q_re: focal_Q.re.toString(),
      Q_im: focal_Q.im.toString(),
      vertex_re: results.vertex_re.toString(),
      vertex_im: results.vertex_im.toString(),
   }
}

export const handle_core_calc = (req, res) => {
   const r_num = req.query.r_num
   const r_den = req.query.r_den
   const theta_num = req.query.theta_num
   const theta_den = req.query.theta_den
   const resolution = req.query.resolution
   const base_iterations = req.query.base_iterations
   const result = core_calc(r_num, r_den, theta_num, theta_den, resolution, base_iterations)
   res.json(result)
}