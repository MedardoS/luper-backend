const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool(
  isProduction && process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
);

pool.on("connect", () => {
  console.log("🐘 PostgreSQL conectado");
});

pool.on("error", (error) => {
  console.error("❌ Error inesperado en PostgreSQL:", error);
});

module.exports = pool;