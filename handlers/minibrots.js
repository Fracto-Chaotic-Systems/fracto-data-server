import {db_connect, db_disconnect, select} from "../mysql.js";

export const handle_minibrots = (req, res) => {
   const query = {
      table: 'free_bailiwicks',
      limit: 5000,
      offset: 0,
      order: 'magnitude desc',
      where: `is_node != 1`
   }
   console.log('handle_minibrots', query)
   try {
      const connection = db_connect()
      select(connection, query, (result) => {
         console.log('minibrots yay 200');
         res.status(200).json({result});
         db_disconnect(connection);
      })
   } catch (error) {
      console.log(error);
      res.status(500).json({error});
   }
}
