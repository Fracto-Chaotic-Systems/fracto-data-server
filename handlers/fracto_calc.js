import {SEPARATOR} from "../index.js";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const handle_fracto_calc = (req, res) => {
   const r_num = req.query.r_num
   const r_den = req.query.r_den
   const theta_num = req.query.theta_num
   const theta_den = req.query.theta_den
   const resolution = req.query.resolution

   const php_dir = path.join(__dirname, `..${SEPARATOR}php`)
   const output_dir = path.join(__dirname, `${php_dir}${SEPARATOR}response`);
   const output_filename = `${crypto.randomUUID()}.txt`
   const output_file = `${output_dir}${SEPARATOR}${output_filename}`

   const params = [r_num, r_den, theta_num, theta_den, resolution]
   const script_file = `${php_dir}${SEPARATOR}fracto_calc.php`
   const cmd = `php ${script_file} ${params.join(' ')} > ${output_file}`
   res.json({output_filename})
   execSync(cmd)
}