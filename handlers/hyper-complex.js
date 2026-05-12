import path from "path";
import {fileURLToPath} from 'url';
import FractoHyperComplexCalc from "../../../sdk/FractoHyperComplexCalc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fill_hyper_complex_buffer = (re, im, hn, hc, scope, width) => {
   const result_buffer = Array
      .from({length: width}, () => Array
         .from({length: width}, () => [0, 0])
      );
   const half_scope = scope / 2
   const leftmost = - half_scope
   const topmost = half_scope
   const increment = scope / width
   for (let x_canvas = 0; x_canvas < width; x_canvas++) {
      const hn_value = leftmost + increment * x_canvas
      for (let y_canvas = 0; y_canvas < width; y_canvas++) {
         const hc_value = topmost - increment * y_canvas
         const fracto_values = FractoHyperComplexCalc.calc(
            re, im, hn_value, hc_value)
         result_buffer[x_canvas][y_canvas] = [
            fracto_values.pattern,
            fracto_values.iteration,
         ]
      }
   }
   return result_buffer;
}

export const handle_hyper_complex_buffer = (req, res) => {
   const {re, im, hn, hc, scope, width} = req.query
   const canvas_buffer = fill_hyper_complex_buffer(
      parseFloat(re),
      parseFloat(im),
      parseFloat(hn),
      parseFloat(hc),
      parseFloat(scope),
      parseInt(width))
   res.json({canvas_buffer, query: req.query})
}