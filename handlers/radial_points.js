import {SEPARATOR} from "../index.js";
import {csv_to_json} from "./utils.js";

export const handle_put_radial_point = (req, res, db) => {
   const r_num = req.query.r_num
   const r_den = req.query.r_den
   const r = r_num / r_den
   const theta_num = req.query.theta_num
   const theta_den = req.query.theta_den
   const theta = theta_num / theta_den
   const point_re = req.query.point_re
   const point_im = req.query.point_im
   const cardinality = req.query.cardinality
   const iterations = req.query.iterations
   const magnitude = req.query.magnitude
   const resolution = req.query.resolution
   const seed_re = req.query.seed_re
   const seed_im = req.query.seed_im
   const focal_re = req.query.focal_re
   const focal_im = req.query.focal_im
}

export const handle_radian_data = async (req, res) => {
   const theta_num = req.query.theta_num
   const theta_den = req.query.theta_den
   const precision = req.query.precision
   const filePath = `.${SEPARATOR}vectors${SEPARATOR}radian-${theta_den}-${theta_num}-${precision}.csv`
   csv_to_json(filePath, results => {
      res.json({file_contents: results})
   })
}