import {
   db_connect,
   db_disconnect,
   insert, select
} from "../mysql.js";

export const handle_asset = (req, res) => {
   const asset_id = `"${req.query.asset_id}"`
   const width = parseInt(req.query.width)
   const height = parseInt(req.query.height)
   const focal_point_x = parseFloat(req.query.focal_point_x)
   const focal_point_y = parseFloat(req.query.focal_point_y)
   const scope = parseFloat(req.query.scope)
   const filename = `"${req.query.filename}"`
   const public_url = `"${req.query.public_url}"`
   const asset_type = `"${req.query.asset_type}"`
   try {
      const connection = db_connect()
      insert(connection, 'assets', {
         asset_id: asset_id,
         width: width,
         height: height,
         focal_point_x: focal_point_x,
         focal_point_y: focal_point_y,
         scope: scope,
         filename: filename,
         public_url: public_url,
         asset_type: asset_type,
      }, result => {
         console.log('insert asset', result)
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (error) {
      console.error(error);
      res.status(500).json({error});
   }
}

export const handle_assets = (req, res) => {
   const query = {
      table: 'assets',
      limit: 1000,
      offset: 0,
      order: 'id desc',
      where: `width = 4800`
   }
   console.log('handle_assets', query)
   try {
      const connection = db_connect()
      select(connection, query, (result) => {
         console.log('assets yay 200');
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (error) {
      console.error(error);
      res.status(500).json({error});
   }
}

