import "dotenv/config";
import { pool } from "../db/pool.js";
import { runPollingIntelligenceJob } from "../jobs/pollingIntelligence.job.js";
import { migrateLegacyPollingSignals } from "../services/pollingIngestion.service.js";

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

try {
  const migrateLegacy = process.argv.includes("--migrate-legacy");

  if (migrateLegacy) {
    const migration = await migrateLegacyPollingSignals();
    console.log("Legacy polling migration:", JSON.stringify(migration, null, 2));
  }

  const pollTypes = argument("poll-types", "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await runPollingIntelligenceJob({
    pollTypes: pollTypes.length ? pollTypes : undefined,
    pollType: argument("poll-type", ""),
    subject: argument("subject", ""),
    pollster: argument("pollster", ""),
    fromDate: argument("from-date", ""),
    limit: Number(argument("limit", process.env.VOTEHUB_SYNC_LIMIT || 500)),
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error("[UnifiedPolling] sync failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
