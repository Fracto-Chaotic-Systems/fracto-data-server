import {db_connect, db_disconnect, select} from "../mysql.js";

export const handle_minibrots = (req, res) => {
   const query = {
      table: 'free_bailiwicks',
      limit: 1000,
      offset: 0,
      order: 'magnitude desc',
   }
   console.log('handle_minibrots', query)
   try {
      const connection = db_connect()
      select(connection, query, (error, result) => {
         if (error) {
            console.log(error);
            console.log('minibrots error 500');
            res.status(500).json({error});
         } else {
            console.log('minibrots yay 200');
            res.status(200).json({result});
         }
         db_disconnect(connection);
      })
   } catch (error) {
      console.log(error);
      res.status(500).json({error});
   }
}
