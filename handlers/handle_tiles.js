import {db_connect, db_disconnect, select} from "../mysql.js";

export const handle_tiles = (req, res) => {
   const query = {
      table: 'tiles',
      limit: 1000,
      offset: 0,
      order: 'id desc'
   }
   const folder = req.query.folder || null
   if (folder) {
      query.where = `folder='${folder}'`
   }
   console.log('handle_tiles', query)
   try {
      const connection = db_connect()
      select(connection, query, (result) => {
         console.log('tiles yay 200');
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (error) {
      console.log(error);
      res.status(500).json({error});
   }
}
