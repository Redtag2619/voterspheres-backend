import pkg from "pg";
const { Pool } = pkg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/voterspheres";

const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("connect", () => {
<<<<<<< HEAD
  console.log("🟢 Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("🔴 PostgreSQL error:", err);
=======
  console.log("Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("PostgreSQL error:", err);
>>>>>>> 728345a (Fix auth middleware and add database config)
});

export default pool;
