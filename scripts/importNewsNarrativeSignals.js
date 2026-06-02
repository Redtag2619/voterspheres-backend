import "dotenv/config";
import { pool } from "../db/pool.js";
import { importNewsNarrativeSignals } from "../services/newsNarrativeIngestion.service.js";

async function main() {
  console.log("🚀 Importing news narrative signals...");

  const result = await importNewsNarrativeSignals({
    limitPerFeed: Number(process.argv[2] || process.env.NEWS_SIGNAL_LIMIT || 25),
  });

  console.log("✅ News narrative import complete", result);
}

main()
  .catch((error) => {
    console.error("❌ News narrative import failed:", error);
    process.exit(1);
  })
  .finally(() => pool.end());
