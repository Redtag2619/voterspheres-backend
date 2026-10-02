import 'dotenv/config';
import pool from '../config/database.js';
const sql=`CREATE TABLE IF NOT EXISTS production_job_runs (
 id BIGSERIAL PRIMARY KEY,
 job_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','complete','degraded','failed')),
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 completed_at TIMESTAMPTZ,
 summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS production_job_runs_recent ON production_job_runs(job_name,started_at DESC);`;
try {
 if(process.argv.includes('--apply')){await pool.query(sql);console.log('Production job telemetry installed.');}
 else console.log(sql+'\nPreview only. Use --apply to install these two objects.');
} finally {await pool.end();}
