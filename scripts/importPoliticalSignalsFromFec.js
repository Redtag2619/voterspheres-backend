import "dotenv/config";
import { pool } from "../db/pool.js";
import { importPoliticalSignalsFromFec } from "../services/politicalSignalIngestion.service.js";

async function main() {
  const limit = Number(process.argv[2] || process.env.FEC_SIGNAL_IMPORT_LIMIT || 500);

  console.log("🚀 Importing FEC political signals...");

  const result = await importPoliticalSignalsFromFec({ limit });

  console.log("✅ FEC political signal import complete", result);
}

main()
  .catch((error) => {
    console.error("❌ FEC political signal import failed:", error);
    process.exit(1);
  })
  .finally(() => pool.end());
