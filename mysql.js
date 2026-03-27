import mysql from 'mysql2';
import config from '../../config/mysql.json' with {type: "json"};

export const db_connect = () => {
   const connection = mysql.createConnection(config);
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

export const select = (connection, query, cb) => {
   const limit = query.limit || 100;
   const sqlQuery = `SELECT *
                     FROM ${query.table} 
                     LIMIT ${limit}`;
   console.log('select', sqlQuery);
   connection.query(sqlQuery, (error, results) => {
      if (error) {
         console.error('Error executing query:', error.message);
         cb ({error})
      } else {
         console.log('Query Results:', results.length);
         cb (results)
      }
   });
}
