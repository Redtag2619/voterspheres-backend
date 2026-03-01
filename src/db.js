import pkg from "pg";

const { Pool } = pkg;

/*
|--------------------------------------------------------------------------
| Validate DATABASE_URL
|--------------------------------------------------------------------------
*/
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set in environment variables.");
  process.exit(1);
}

/*
|--------------------------------------------------------------------------
| Create PostgreSQL Pool
|--------------------------------------------------------------------------
*/
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Required for Render Postgres
  ssl: {
    rejectUnauthorized: false,
  },

  // Optional stability tuning
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/*
|--------------------------------------------------------------------------
| Test Connection On Startup
|--------------------------------------------------------------------------
*/
pool.connect()
  .then(client => {
    console.log("✅ PostgreSQL connected successfully");
    client.release();
  })
  .catch(err => {
    console.error("❌ PostgreSQL connection error:", err);
    process.exit(1);
  });
