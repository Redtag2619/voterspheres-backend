import fs from "fs";
import path from "path";
import { pool } from "./pool.js";

const migrationsDir = path.join(process.cwd(), "migrations");

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      );
    `);

    if (!fs.existsSync(migrationsDir)) {
      console.log("No migrations folder found.");
      process.exit(0);
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const alreadyRun = await pool.query(
        "SELECT id FROM schema_migrations WHERE filename = $1",
        [file]
      );

      if (alreadyRun.rows.length) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

      console.log(`Running ${file}`);
      await pool.query("BEGIN");
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file]
      );
      await pool.query("COMMIT");

      console.log(`Completed ${file}`);
    }

    console.log("All migrations complete.");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();