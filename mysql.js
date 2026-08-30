import mysql from 'mysql2';
import chalk from 'chalk';
import config from '../../config/mysql.json' with {type: "json"};

const STRUCTURED_LOG_PREFIX = '@@FRACTO_LOG@@'
const SQL_KEYWORDS = ['select', 'from', 'where', 'order by', 'limit', 'offset', 'insert into', 'values', 'update', 'set', 'delete from', 'and', 'or']

const format_sql = sql => {
   let formatted = sql.replace(/\s+/g, ' ').trim()
   SQL_KEYWORDS.forEach(keyword => {
      const keyword_pattern = new RegExp(`\\b${keyword.replace(' ', '\\s+')}\\b`, 'gi')
      formatted = formatted.replace(keyword_pattern, keyword.toUpperCase())
   })
   return formatted.replace(/\s+(FROM|WHERE|ORDER BY|LIMIT|OFFSET|VALUES|SET|AND|OR)\s+/g, '\n  $1 ')
}

const sql_segments = statement => {
   const segments = []
   const keyword_pattern = /\b(SELECT|FROM|WHERE|ORDER BY|LIMIT|OFFSET|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|AND|OR)\b|(?<!\w)-?\d+(?:\.\d+)?(?!\w)/g
   let cursor = 0
   let match
   while ((match = keyword_pattern.exec(statement))) {
      if (match.index > cursor) segments.push({text: statement.slice(cursor, match.index), color: null})
      segments.push({
         text: match[0],
         color: /^\d/.test(match[0]) ? '#d4a72c' : 'lightskyblue',
      })
      cursor = keyword_pattern.lastIndex
   }
   if (cursor < statement.length) segments.push({text: statement.slice(cursor), color: null})
   return segments
}

const log_sql = sql => {
   const statement = format_sql(sql)
   console.log(`${STRUCTURED_LOG_PREFIX}${JSON.stringify({
      kind: 'sql',
      statement,
      segments: sql_segments(statement),
   })}`)
}

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
   log_sql(sqlQuery);
   connection.query(sqlQuery, (error, results) => {
      if (error) {
         console.error('Error executing query:', error.message);
         cb({error})
      } else {
         console.log('select returned', chalk.hex('#d4a72c')(results.length), 'records');
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
   log_sql(sqlQuery);
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
   log_sql(sqlQuery);
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
