import {db_connect, db_disconnect, select} from "../mysql.js";

const TABLES = new Set([
   'assets',
   'free_bailiwicks',
   'lore_category',
   'lore_files',
   'tiles',
])

export const handle_query = (req, res) => {
   const table = `${req.query.table || ''}`
   if (!TABLES.has(table)) {
      res.status(400).json({error: `Unsupported query table: ${table}`})
      return
   }
   const connection = db_connect()
   select(connection, {
      table,
      limit: 1000,
      offset: 0,
      order: 'id DESC',
   }, result => {
      db_disconnect(connection)
      if (result?.error) {
         res.status(500).json({error: result.error.message})
         return
      }
      res.status(200).json({result})
   })
}
