import mysql from 'mysql2';
import config from '../../config/mysql.json' with {type: "json"};

export const db_connect = () => {
   const connection = mysql.createConnection({
      ...config,
      host: process.env.FRACTO_MYSQL_HOST || config.host,
      port: process.env.FRACTO_MYSQL_PORT
         ? Number(process.env.FRACTO_MYSQL_PORT)
         : config.port,
   });
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
                     FROM ${query.table} ${where} ${order} LIMIT ${limit}
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

export const insert = async (connection, table, key_values, cb) => {
   const field_names = Object.keys(key_values);
   const fields = []
   const values = []
   const placeholders = []
   field_names.forEach(field_name => {
      const value = key_values[field_name];
      fields.push(field_name);
      values.push(value);
      placeholders.push('?')
   })
   const sqlQuery = `INSERT into ${table} (${fields.join(',')})
                     VALUES (${placeholders.join(',')})`
   console.log('insert', sqlQuery);
   try {
      connection.query(sqlQuery, values, (error, results) => {
         if (error) {
            console.error('Error executing query:', error.message);
            cb({error})
         } else {
            cb(results)
         }
      })
   } catch (error) {
      console.error('Error executing query:', error.message);
      cb({error})
   }
}

export const update = async (connection, table, id, key_values, cb) => {
   const all_keys = Object.keys(key_values);
   const values = all_keys.map(key => key_values[key])
   const all_pairs = all_keys.map(key => `${key}=?`).join(',')
   const sqlQuery = `UPDATE ${table}
                     SET ${all_pairs}
                     where id = ?`
   console.log('update', sqlQuery);
   try {
      connection.query(sqlQuery, [...values, id], (error, results) => {
         if (error) {
            console.error('Error executing query:', error.message);
            cb({error})
         } else {
            cb(results)
         }
      })
   } catch (error) {
      console.error('Error executing query:', error.message);
      cb({error})
   }
}
