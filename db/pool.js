import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const isRender =
  process.env.RENDER === "true" ||
  process.env.NODE_ENV === "production" ||
  (process.env.DATABASE_URL || "").includes("render.com");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRender
    ? { rejectUnauthorized: false }
    : false
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});
