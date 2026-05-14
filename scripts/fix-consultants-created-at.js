import "dotenv/config";
import pool from "../config/database.js";

async function run() {
  console.log("Fixing consultants created_at/updated_at columns...");

  await pool.query(`
    ALTER TABLE consultants
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE consultants
    SET
      created_at = COALESCE(created_at, NOW()),
      updated_at = COALESCE(updated_at, NOW())
  `);

  console.log("consultants timestamps fixed.");
}

run()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });