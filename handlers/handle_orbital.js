import {inverse_derivation} from "./orbitals.js";

export const handle_orbital = (req, res) => {
   console.log('handle_orbital', req.query)
   try {
      const re = parseFloat(req.query.re)
      const im = parseFloat(req.query.im)
      const max_depth = parseInt(req.query.max_depth)
      const result = inverse_derivation({x: re, y: im}, max_depth)
      // console.log('derive_orbital found orbital: ', result.found_orbital)
      res.status(200).json({result});
   } catch (e) {
      console.error(e.message)
   }
}