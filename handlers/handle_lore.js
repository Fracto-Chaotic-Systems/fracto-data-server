import {db_connect, db_disconnect, select} from "../mysql.js";

export const handle_lore_categories = (req, res) => {
   const query = {
      table: 'lore_category',
      order: 'id desc',
   }
   console.log('handle_lore_categories', query)
   try {
      const connection = db_connect()
      select(connection, query, (result) => {
         console.log('lore_category yay 200');
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (error) {
      console.log(error);
      res.status(500).json({error});
   }
}
