import { pool } from "../db/pool.js";

export async function ensureVendorPerformanceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_performance (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER,
      vendor_name TEXT,
      state TEXT,
      facility_type TEXT,
      facility_name TEXT,

      total_jobs INTEGER DEFAULT 0,
      completed_jobs INTEGER DEFAULT 0,
      delayed_jobs INTEGER DEFAULT 0,
      issue_count INTEGER DEFAULT 0,

      on_time_score NUMERIC DEFAULT 100,
      reliability_score NUMERIC DEFAULT 100,
      risk_score NUMERIC DEFAULT 0,
      overall_score NUMERIC DEFAULT 100,

      last_job_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vendor_performance_vendor
    ON vendor_performance(vendor_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vendor_performance_state
    ON vendor_performance(state)
  `);
}

export async function generateVendorPerformanceScores() {
  await ensureVendorPerformanceTables();

  const result = await pool.query(`
    SELECT
      v.id AS vendor_id,
      COALESCE(v.vendor_name, v.name) AS vendor_name,
      v.state,

      COUNT(m.id)::int AS total_jobs,

      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(m.status, '')) = 'delivered'
      )::int AS completed_jobs,

      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(m.status, '')) LIKE '%delay%'
      )::int AS delayed_jobs,

      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(m.risk_level, '')) IN ('high','critical')
      )::int AS issue_count,

      MAX(m.updated_at) AS last_job_at

    FROM vendors v

    LEFT JOIN mailops_events m
      ON LOWER(COALESCE(m.production_vendor,'')) =
         LOWER(COALESCE(v.vendor_name, v.name,''))

    GROUP BY v.id, vendor_name, v.state
  `);

  const rows = result.rows || [];

  for (const row of rows) {
    const total = Number(row.total_jobs || 0);
    const delayed = Number(row.delayed_jobs || 0);
    const issues = Number(row.issue_count || 0);

    const onTime =
      total === 0 ? 100 : Math.max(0, 100 - delayed * 12);

    const reliability =
      total === 0 ? 100 : Math.max(0, 100 - issues * 15);

    const risk =
      Math.min(100, delayed * 10 + issues * 15);

    const overall =
      Math.max(
        0,
        Math.round((onTime * 0.5) + (reliability * 0.5) - (risk * 0.25))
      );

    await pool.query(`
      INSERT INTO vendor_performance (
        vendor_id,
        vendor_name,
        state,
        total_jobs,
        completed_jobs,
        delayed_jobs,
        issue_count,
        on_time_score,
        reliability_score,
        risk_score,
        overall_score,
        last_job_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()
      )
      ON CONFLICT (vendor_id)
      DO UPDATE SET
        total_jobs = EXCLUDED.total_jobs,
        completed_jobs = EXCLUDED.completed_jobs,
        delayed_jobs = EXCLUDED.delayed_jobs,
        issue_count = EXCLUDED.issue_count,
        on_time_score = EXCLUDED.on_time_score,
        reliability_score = EXCLUDED.reliability_score,
        risk_score = EXCLUDED.risk_score,
        overall_score = EXCLUDED.overall_score,
        last_job_at = EXCLUDED.last_job_at,
        updated_at = NOW()
    `, [
      row.vendor_id,
      row.vendor_name,
      row.state,
      total,
      row.completed_jobs,
      delayed,
      issues,
      onTime,
      reliability,
      risk,
      overall,
      row.last_job_at
    ]);
  }

  return {
    ok: true,
    vendors_scored: rows.length
  };
}

await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS
  idx_vendor_performance_unique_vendor
  ON vendor_performance(vendor_id)
`);
