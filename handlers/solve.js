import Complex from "../../../sdk/math/Complex.js";


const solve = (z_re, z_im, cardinality, path_factor = 1.0) => {
   let result = new Complex(z_re, z_im)
   let derivative = new Complex(1, 0)
   const Z = new Complex(z_re, z_im)
   const two_Z = Z.scale(2)
   for (let i = 0; i < cardinality - 1; i++) {
      result = result.mul(result).add(Z)
   }
}

export const handle_solve = (req, res) => {
   const z_re = parseFloat(req.query.z_re)
   const z_im = parseFloat(req.query.z_im)
   const cardinality = parseInt(req.query.cardinality)
   const path_factor = parseFloat(req.query.path_factor)

   const {result_re, result_im} = solve(z_re, z_im, cardinality, path_factor)

   res.status(200).json({result_re, result_im});
}
