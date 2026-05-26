import {db_connect, db_disconnect, select} from "../mysql.js";

export const handle_tile_coverage = (req, res) => {
   const level = parseInt(req.query.level)
   const query = {
      columns: 'short_code',
      table: 'tiles',
      limit: 20000000,
      offset: 0,
      where: `level = ${level}`
   }
   try {
      const connection = db_connect()
      select(connection, query, (result) => {
         console.log('tiles yay 200');
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (e) {
      console.log(e.message)
   }
}