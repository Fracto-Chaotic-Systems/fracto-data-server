import {select} from "../mysql.js";
import {db_connection} from "../index.js";

export const handle_minibrots = (req, res) => {
   const query = {
      table: 'free_bailiwicks',
      limit: 100,
      offset: 0,
      order: 'id desc',
   }
   console.log('handle_minibrots', query)
   try {
      select(db_connection, query, (error, result) => {
         if (error) {
            console.log(error);
            res.status(500).json({error});
         } else {
            console.log('minibrots yay 200');
            res.status(200).json(result);
         }
      })
   } catch (error) {
      console.log(error);
      res.status(500).json({error});
   }
}
