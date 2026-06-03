import "dotenv/config";
import { pool } from "../db/pool.js";

async function main() {
  console.log("🧹 Cleaning old news narrative signals...");

  const result = await pool.query(`
    DELETE FROM political_signals
    WHERE signal_type = 'news'
       OR title ILIKE 'Narrative signal:%'
       OR summary ILIKE '%<a href=%'
       OR summary ILIKE '%<font%'
  `);

  console.log(`✅ Deleted ${result.rowCount} old/messy news records.`);
}

main()
  .catch((error) => {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  })
  .finally(() => pool.end());
