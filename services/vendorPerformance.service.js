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
