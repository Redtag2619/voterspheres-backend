import { pool } from "../db/pool.js";

function text(value = "") {
  return String(value || "").trim();
}

function scoreVendor({ totalJobs, completedJobs, delayedJobs, issueCount }) {
  const total = Number(totalJobs || 0);
  const completed = Number(completedJobs || 0);
  const delayed = Number(delayedJobs || 0);
  const issues = Number(issueCount || 0);

  const completionRate = total > 0 ? completed / total : 1;
  const delayRate = total > 0 ? delayed / total : 0;
  const issueRate = total > 0 ? issues / total : 0;

  const onTimeScore = Math.max(0, Math.round(100 - delayRate * 100));
  const reliabilityScore = Math.max(0, Math.round(completionRate * 100));
  const riskScore = Math.min(100, Math.round(delayRate * 60 + issueRate * 80));

  const overallScore = Math.max(
    0,
    Math.round(onTimeScore * 0.45 + reliabilityScore * 0.4 - riskScore * 0.15)
  );

  return { onTimeScore, reliabilityScore, riskScore, overallScore };
}

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
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_performance_unique_vendor
    ON vendor_performance(vendor_id)
    WHERE vendor_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vendor_performance_state
    ON vendor_performance(state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vendor_performance_score
    ON vendor_performance(overall_score DESC)
  `);
}

async function ensureSourceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      vendor_name TEXT,
      name TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      state TEXT,
      city TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      services TEXT,
      capabilities TEXT,
      coverage_area TEXT,
      campaign_name TEXT,
      candidate_name TEXT,
      firm_name TEXT,
      office TEXT,
      contract_value NUMERIC DEFAULT 0,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailops_events (
      id SERIAL PRIMARY KEY,
      campaign TEXT,
      state TEXT,
      office TEXT,
      location TEXT,
      vendor_name TEXT,
      print_vendor TEXT,
      status TEXT DEFAULT 'Pending',
      severity TEXT DEFAULT 'Medium',
      delivery_risk TEXT,
      induction_type TEXT,
      induction_facility TEXT,
      induction_facility_address TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function generateVendorPerformanceScores() {
  await ensureSourceTables();
  await ensureVendorPerformanceTables();

  const result = await pool.query(`
    WITH vendor_base AS (
      SELECT
        v.id AS vendor_id,
        COALESCE(v.vendor_name, v.name, 'Unnamed Vendor') AS resolved_vendor_name,
        v.state AS resolved_state
      FROM vendors v
    ),
    mailops_base AS (
      SELECT
        m.id,
        COALESCE(m.print_vendor, m.vendor_name, '') AS resolved_mail_vendor,
        m.status AS mail_status,
        m.severity AS mail_severity,
        m.delivery_risk AS mail_delivery_risk,
        m.created_at,
        m.updated_at
      FROM mailops_events m
    )
    SELECT
      vb.vendor_id,
      vb.resolved_vendor_name,
      vb.resolved_state,

      COUNT(mb.id)::int AS total_jobs,

      COUNT(mb.id) FILTER (
        WHERE LOWER(COALESCE(mb.mail_status, '')) IN ('delivered', 'resolved', 'on track')
      )::int AS completed_jobs,

      COUNT(mb.id) FILTER (
        WHERE LOWER(COALESCE(mb.mail_status, '')) LIKE '%delay%'
           OR LOWER(COALESCE(mb.mail_status, '')) = 'elevated'
      )::int AS delayed_jobs,

      COUNT(mb.id) FILTER (
        WHERE LOWER(COALESCE(mb.mail_severity, '')) IN ('high', 'critical')
           OR LOWER(COALESCE(mb.mail_delivery_risk, '')) IN ('high', 'critical', 'elevated')
      )::int AS issue_count,

      MAX(COALESCE(mb.updated_at, mb.created_at)) AS last_job_at

    FROM vendor_base vb
    LEFT JOIN mailops_base mb
      ON LOWER(COALESCE(mb.resolved_mail_vendor, '')) =
         LOWER(COALESCE(vb.resolved_vendor_name, ''))

    GROUP BY
      vb.vendor_id,
      vb.resolved_vendor_name,
      vb.resolved_state
  `);

  for (const row of result.rows || []) {
    const scores = scoreVendor({
      totalJobs: row.total_jobs,
      completedJobs: row.completed_jobs,
      delayedJobs: row.delayed_jobs,
      issueCount: row.issue_count,
    });

    await pool.query(
      `
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (vendor_id)
        WHERE vendor_id IS NOT NULL
        DO UPDATE SET
          vendor_name = EXCLUDED.vendor_name,
          state = EXCLUDED.state,
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
      `,
      [
        row.vendor_id,
        row.resolved_vendor_name,
        row.resolved_state,
        Number(row.total_jobs || 0),
        Number(row.completed_jobs || 0),
        Number(row.delayed_jobs || 0),
        Number(row.issue_count || 0),
        scores.onTimeScore,
        scores.reliabilityScore,
        scores.riskScore,
        scores.overallScore,
        row.last_job_at,
      ]
    );
  }

  return {
    ok: true,
    vendors_scored: result.rows?.length || 0,
  };
}

export async function getVendorPerformanceDashboard(options = {}) {
  await generateVendorPerformanceScores();

  const limit = Math.max(1, Math.min(Number(options.limit || 100), 250));
  const state = text(options.state);

  const values = [];
  const where = [];

  if (state) {
    values.push(state.toUpperCase());
    where.push(`UPPER(COALESCE(state, '')) = $${values.length}`);
  }

  values.push(limit);

  const result = await pool.query(
    `
      SELECT *
      FROM vendor_performance
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY overall_score DESC, total_jobs DESC, vendor_name ASC
      LIMIT $${values.length}
    `,
    values
  );

  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_vendors,
      COUNT(*) FILTER (WHERE overall_score >= 85)::int AS strong_vendors,
      COUNT(*) FILTER (WHERE overall_score BETWEEN 70 AND 84)::int AS watch_vendors,
      COUNT(*) FILTER (WHERE overall_score < 70)::int AS risk_vendors,
      COALESCE(AVG(overall_score), 0)::numeric AS average_score
    FROM vendor_performance
  `);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    summary: summary.rows[0] || {},
    results: result.rows || [],
  };
}
