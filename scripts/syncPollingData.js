
import "dotenv/config";
import { pool } from "../db/pool.js";
import { runPollingIntelligenceJob } from "../jobs/pollingIntelligence.job.js";

try {
  const result = await runPollingIntelligenceJob({
    includeHistorical:
      process.argv.includes("--historical"),
    generateEstimates:
      !process.argv.includes("--no-estimates"),
  });

  console.log(
    JSON.stringify(result, null, 2)
  );

  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error("[PollingIntelligence] sync failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}