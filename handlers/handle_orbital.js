import BigComplex from "../../../sdk/math/BigComplex.js";
import FractoFastCalc from "../../../sdk/FractoFastCalc.js";

const RESOLUTION_DIGITS = 150

const inverse_derivation = (point) => {
   const P = new BigComplex(point.x, point.y, RESOLUTION_DIGITS)
   const q_minus = FractoFastCalc.calculate_big_cardioid_Q(
      point.x, point.y, -1)
   const Q_minus = new BigComplex(q_minus.x, q_minus.y, RESOLUTION_DIGITS)

   const negative_P = P.scale(-1)
   const under_radical = Q_minus.add(negative_P)
   const root_Q_minus_P = under_radical.sqrt()

   const point_list = []
   point_list.push(Q_minus)
   let seed = root_Q_minus_P.scale(-1)
   for (let i = 0; i < 1000; i++) {
      const seed_minus_P = seed.add(negative_P)
      const sqrt_seed_minus_P = seed_minus_P.sqrt()
      seed = sqrt_seed_minus_P.scale(-1)
      point_list.push(seed)
      if (seed.re.toString() === Q_minus.re.toString()
         && seed.im.toString() === Q_minus.im.toString()) {
         break;
      }
   }
   const negative_Q_minus = Q_minus.scale(-1)
   return point_list.map((point) => {
      const point_re = point.re
      const point_im = point.im
      const difference = point.add(negative_Q_minus)
      const offset = difference.magnitude()
      return {
         offset: offset.toString(),
         point: {
            re: point_re.toString(),
            im: point_im.toString()
         },
      }
   })
}

export const handle_orbital = (req, res) => {
   console.log('handle_orbital', req.query)
   try {
      const re = parseFloat(req.query.re)
      const im = parseFloat(req.query.im)
      const result = inverse_derivation({x: re, y: im})
      res.status(200).json({result});
   } catch (e) {
      console.error(e.message)
   }
}

const test_point = {
   x: -0.6897174395111918,
   y: 0.27573049611632167,
}
const result = inverse_derivation(test_point)
console.log(result)