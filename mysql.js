import mysql from 'mysql2';
import config from '../../config/mysql.json' with {type: "json"};

export const db_connect = () => {
   const connection = mysql.createConnection(config);
   connection.connect((err) => {
      if (err) {
         console.error('Error connecting to MySQL database:', err.message);
         // return;
      }
      // console.log('Connected to MySQL database!');
   });
   return connection
}

export const db_disconnect = (connection) => {
   connection.end((endErr) => {
      if (endErr) {
         console.error('Error closing connection:', endErr.message);
         // return;
      }
      // console.log('Connection closed.');
   });
}

export const select = (connection, query, cb) => {
   const limit = query.limit || 100;
   const order = query.order ? `ORDER BY ${query.order}` : '';
   const offset = query.offset || '0';
   const where = query.where ? `where ${query.where}` : '';
   const sqlQuery = `SELECT ${query.columns || '*'}
                     FROM ${query.table} ${where}
                     ${order} LIMIT ${limit}
                     OFFSET ${offset};`;
   console.log('select', sqlQuery);
   connection.query(sqlQuery, (error, results) => {
      if (error) {
         console.error('Error executing query:', error.message);
         cb({error})
      } else {
         // console.log('Query Results:', results.length);
         cb(results)
      }
   });
}

export const insert = (connection, table, key_values, cb) => {
   const field_names = Object.keys(key_values);
   const fields = []
   const values = []
   field_names.forEach (field_name => {
      const value = key_values[field_name];
      fields.push(field_name);
      values.push(value);
   })
   const sqlQuery = `INSERT into ${table}
                    (${fields.join(',')})
                VALUES (${values.join(',')})`
   // console.log('insert', sqlQuery);
   connection.query(sqlQuery, (error, results) => {
      if (error) {
         console.error('Error executing query:', error.message);
         cb({error})
      } else {
         // console.log('Query Results:', results.length);
         cb(results)
      }
   });
}
