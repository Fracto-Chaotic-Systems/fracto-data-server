import {spawn_sync} from "../../../utils.js";
import {fileURLToPath} from "url";
import path from "path";
import fs from "fs";
import config from '../../../config/mysql.json' with {type: "json"};

export const SEPARATOR = path.sep;

export const handle_backup = (req, res) => {
   const table = `${req.query.table}`
   const __filename = fileURLToPath(import.meta.url);
   const __dirname = path.dirname(__filename);
   const root_folder_length = __dirname.indexOf('servers')
   const root_folder = __dirname.slice(0, root_folder_length)
   const service_name = 'fracto-data-server'
   const response = {}
   try {
      const true_folder_name = root_folder.replaceAll('\\', SEPARATOR)
      const log_folder_name = `${true_folder_name}backup`
      if (!fs.existsSync(log_folder_name)) {
         fs.mkdirSync(log_folder_name)
      }
      const logfile_name = `${log_folder_name}${SEPARATOR}${service_name}-backup.txt`
      const service_folder = `${true_folder_name}${SEPARATOR}servers${SEPARATOR}${service_name}`
      const result_file = `${log_folder_name}${SEPARATOR}${table}.sql`
      spawn_sync(`mysqldump`, [
         `--host=${config.host}`,
         '--port=3306',
         `--user=${config.user}`,
         `--password=${config.password}`,
         `"${config.database}"`,
         `"${table}"`,
         `>${result_file}`
      ], service_folder);
      const file_data = fs.readFileSync(logfile_name)
      response[table] = file_data.toString('utf8')
      res.json({result_file})
   } catch (err) {
      console.error("Error getting backup status:", err.message);
      res.json(err)
   }
}
