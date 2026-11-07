import { readFile } from "node:fs/promises";

const connection_options = async (database) => {
  const config = JSON.parse(
    await readFile(
      new URL("../../../config/mysql.json", import.meta.url),
      "utf8",
    ),
  );
  return {
    ...config,
    host: process.env.FRACTO_MYSQL_HOST || config.host,
    port: Number(process.env.FRACTO_MYSQL_PORT || config.port || 3306),
    database: database || process.env.FRACTO_MYSQL_DATABASE || config.database,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
    connectTimeout: 15000,
  };
};

/** Explicit standalone connection for verification/admin ownership; caller closes it. */
export const open_orbital_database = async () => {
  const { default: mysql } = await import("mysql2/promise");
  return mysql.createConnection(await connection_options());
};

/** Short leased connections avoid a new TCP handshake on each job-status poll. */
export const create_orbital_database_pool = async (database) => {
  const { default: mysql } = await import("mysql2/promise");
  return mysql.createPool({
    ...(await connection_options(database)),
    connectionLimit: 4,
    maxIdle: 4,
    idleTimeout: 30000,
    waitForConnections: true,
    queueLimit: 16,
  });
};
