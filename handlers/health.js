import mysql from 'mysql2/promise'

import config from '../../../config/mysql.json' with {type: 'json'}

const CHECK_TIMEOUT_MS = 2000

export const handle_health = async (req, res) => {
   const host = process.env.FRACTO_MYSQL_HOST || config.host
   const port = process.env.FRACTO_MYSQL_PORT ? Number(process.env.FRACTO_MYSQL_PORT) : Number(config.port || 3306)
   let connection
   try {
      connection = await mysql.createConnection({
         ...config,
         host,
         port,
         connectTimeout: CHECK_TIMEOUT_MS,
      })
      await connection.query('SELECT 1')
      res.json({status: 'healthy', database: 'available'})
   } catch (error) {
      res.status(503).json({
         status: 'unhealthy',
         database: 'unavailable',
         error: error.code || 'CONNECTION_FAILED',
      })
   } finally {
      if (connection) await connection.end().catch(() => {})
   }
}
