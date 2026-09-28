import "dotenv/config";
import { pool } from "../db/pool.js";

try {
  const [results, quarantine, runs] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE cycle IS NULL)::integer AS missing_cycle,
        COUNT(*) FILTER (WHERE cycle IS NOT NULL)::integer AS classified
      FROM polling_results
    `),
    pool.query(`
      SELECT status, issue_code, COUNT(*)::integer AS groups
      FROM polling_ingestion_quarantine
      GROUP BY status, issue_code
      ORDER BY status, issue_code
    `),
    pool.query(`
      SELECT
        COALESCE(SUM(quarantined_poll_count), 0)::integer AS quarantined_polls,
        COALESCE(SUM(quarantined_answer_count), 0)::integer AS quarantined_answers
      FROM polling_ingestion_runs
    `),
  ]);

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    policy: "Existing unresolved records remain unchanged. New ambiguous polling groups are quarantined before insertion.",
    polling_results: results.rows[0],
    ingestion_quarantine: quarantine.rows,
    ingestion_runs: runs.rows[0],
  }, null, 2));
} finally {
  await pool.end();
}
