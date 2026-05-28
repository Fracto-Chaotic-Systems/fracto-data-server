import {db_connect, db_disconnect, insert, select} from "../mysql.js";

export const handle_tile = (req, res) => {
   // console.log(JSON.stringify(req.body))
   const {
      short_code,
      parent,
      level,
      folder,
      bounds_bottom,
      bounds_top,
      bounds_left,
      bounds_right,
   } = req.body;
   try {
      const connection = db_connect()
      insert(connection,
         'tiles',
         {
            short_code: `"${short_code}"`,
            parent: `"${parent}"`,
            level: `"${level}"`,
            folder: `"${folder}"`,
            bounds_bottom,
            bounds_top,
            bounds_left,
            bounds_right,
         },
         result => {
            // console.log('insert tile', short_code)
            res.status(200).json({result});
            db_disconnect(connection);
         }
      )
   } catch (error) {
      console.log(error);
      res.status(500).json({error});
   }
}

export const handle_tile_get = (req, res) => {
   // console.log(JSON.stringify(req.body))
   const {short_code} = req.query;
   const query = {
      table: 'tiles',
   }
   if (short_code) {
      query.where = `short_code='${short_code}'`
   }
   // console.log('handle_tiles', query)
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
