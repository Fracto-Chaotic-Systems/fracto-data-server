import mysql from 'mysql2';

export const db_connect = () => {
   const connection = mysql.createConnection({
      host: 'localhost',         // Your MySQL host (default is localhost)
      user: 'root',     // Your MySQL username (e.g., 'root')
      password: '', // Your MySQL password
      database: 'fracto' // The name of the database to use
   });
   connection.connect((err) => {
      if (err) {
         console.error('Error connecting to MySQL database:', err.message);
         return;
      }
      console.log('Connected to MySQL database!');
   });
   return connection
}

export const db_disconnect = (connection) => {
   connection.end((endErr) => {
      if (endErr) {
         console.error('Error closing connection:', endErr.message);
         return;
      }
      console.log('Connection closed.');
   });
}

export const select = (connection, table, cb) => {
   const sqlQuery = `SELECT *
                     FROM ${table}`;
   connection.query(sqlQuery, (queryErr, results) => {
      if (queryErr) {
         console.error('Error executing query:', queryErr.message);
         return;
      }
      console.log('Query Results:', results);
      cb (results)
   });
}
