import "dotenv/config";
import { pool } from "../db/pool.js";

try {
  const summary = await pool.query(`
      SELECT temporal_scope, cycle, poll_type, COUNT(*)::integer AS records
      FROM polling_results
      GROUP BY temporal_scope, cycle, poll_type
      ORDER BY temporal_scope, cycle NULLS LAST, records DESC
    `);
  const inconsistencies = await pool.query(`
      SELECT COUNT(*)::integer AS records
      FROM polling_results
      WHERE (temporal_scope = 'election_cycle' AND cycle IS NULL)
         OR (temporal_scope IN ('continuous_tracking', 'unresolved') AND cycle IS NOT NULL)
         OR temporal_scope NOT IN ('election_cycle', 'continuous_tracking', 'unresolved')
    `);
  const unresolved = await pool.query(`
      SELECT poll_type, COUNT(*)::integer AS records
      FROM polling_results
      WHERE temporal_scope = 'unresolved'
      GROUP BY poll_type
      ORDER BY records DESC, poll_type
    `);

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    policy: "Election polling is cycle-bound; approval and favorability polling is date-bound continuous tracking; unresolved polling remains quarantined.",
    safe_to_enable_temporal_scope_reads: Number(inconsistencies.rows[0]?.records || 0) === 0,
    inconsistencies: Number(inconsistencies.rows[0]?.records || 0),
    by_scope_cycle_and_type: summary.rows,
    unresolved_by_type: unresolved.rows,
  }, null, 2));
} finally {
  await pool.end();
}
