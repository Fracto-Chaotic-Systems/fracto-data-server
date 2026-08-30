import {db_connect, db_disconnect, select, insert} from "../mysql.js";

export const handle_minibrots = (req, res) => {
   const is_node = req.query.is_node || '0'
   const is_inline = req.query.is_inline || '0'
   const query = {
      table: 'free_bailiwicks',
      limit: 5000,
      offset: 0,
      order: 'magnitude desc',
      where: `is_node = ${is_node} && is_inline = ${is_inline}`
   }
   try {
      const connection = db_connect()
      select(connection, query, (result) => {
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (error) {
      console.error(error);
      res.status(500).json({error});
   }
}

export const handle_minibrot = (req, res) => {
   const {
      name,
      CQ_code,
      pattern,
      best_level,
      magnitude,
      core_point,
      octave_point,
      display_settings,
      is_node,
      is_inline
   } = req.body;
   try {
      const connection = db_connect()
      insert(connection,
         'free_bailiwicks',
         {
            name,
            CQ_code,
            pattern,
            best_level,
            magnitude,
            core_point,
            octave_point,
            display_settings,
            is_node,
            is_inline
         },
         result => {
            // console.log('insert tile', short_code)
            res.status(200).json({result});
            db_disconnect(connection);
         }
      )
   } catch (error) {
      console.error(error);
      res.status(500).json({error});
   }
}
