import { pool } from "../db/pool.js";

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function riskRank(value = "") {
  const v = String(value || "").toLowerCase();
  if (["critical", "high", "elevated", "delayed"].includes(v)) return 3;
  if (["medium", "watch"].includes(v)) return 2;
  if (["low", "stable", "on track", "resolved"].includes(v)) return 1;
  return 0;
}

function riskLabel(score = 0) {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Elevated";
  return "Stable";
}

async function ensureSourceTables() {
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_performance (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER,
      vendor_name TEXT,
      state TEXT,
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
    CREATE TABLE IF NOT EXISTS executive_feed_events (
      id SERIAL PRIMARY KEY,
      type TEXT,
      title TEXT,
      state TEXT,
      office TEXT,
      severity TEXT,
      risk TEXT,
      source TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

  const executiveFeedColumns = [
    ["type", "TEXT"],
    ["title", "TEXT"],
    ["state", "TEXT"],
    ["office", "TEXT"],
    ["severity", "TEXT"],
    ["risk", "TEXT"],
    ["source", "TEXT"],
    ["metadata", "JSONB DEFAULT '{}'::jsonb"],
    ["created_at", "TIMESTAMP DEFAULT NOW()"],
  ];

  for (const [name, type] of executiveFeedColumns) {
    await pool.query(
      `ALTER TABLE executive_feed_events ADD COLUMN IF NOT EXISTS ${name} ${type}`
    );
  }

export async function getOperationsMap(options = {}) {
  await ensureSourceTables();

  const stateFilter = String(options.state || "").trim().toUpperCase();

  const params = [];
  const stateWhere = [];

  if (stateFilter) {
    params.push(stateFilter);
    stateWhere.push(`UPPER(COALESCE(state, '')) = $${params.length}`);
  }

  const whereSql = stateWhere.length ? `WHERE ${stateWhere.join(" AND ")}` : "";

  const mail = await pool.query(
    `
      SELECT
        COALESCE(NULLIF(state, ''), 'National') AS state,
        COUNT(*)::int AS jobs,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(status, '')) LIKE '%delay%'
             OR LOWER(COALESCE(status, '')) = 'elevated'
             OR LOWER(COALESCE(delivery_risk, '')) IN ('high','critical','elevated')
        )::int AS risk_jobs,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(status, '')) IN ('delivered','resolved','on track')
        )::int AS stable_jobs,
        MAX(updated_at) AS last_activity
      FROM mailops_events
      ${whereSql}
      GROUP BY COALESCE(NULLIF(state, ''), 'National')
    `,
    params
  );

  const vendors = await pool.query(
    `
      SELECT
        COALESCE(NULLIF(state, ''), 'National') AS state,
        COUNT(*)::int AS vendors_scored,
        COALESCE(AVG(overall_score), 100)::numeric AS avg_vendor_score,
        COALESCE(AVG(risk_score), 0)::numeric AS avg_vendor_risk,
        SUM(COALESCE(total_jobs, 0))::int AS vendor_jobs,
        SUM(COALESCE(delayed_jobs, 0))::int AS vendor_delays
      FROM vendor_performance
      ${whereSql}
      GROUP BY COALESCE(NULLIF(state, ''), 'National')
    `,
    params
  );

  const signals = await pool.query(
    `
      SELECT
        COALESCE(NULLIF(state, ''), 'National') AS state,
        COUNT(*)::int AS signals,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(severity, risk, '')) IN ('critical','high','elevated')
        )::int AS high_signals,
        MAX(created_at) AS last_signal_at
      FROM executive_feed_events
      ${whereSql}
      GROUP BY COALESCE(NULLIF(state, ''), 'National')
    `,
    params
  );

  const stateMap = new Map();

  for (const row of mail.rows || []) {
    stateMap.set(row.state, {
      state: row.state,
      mail_jobs: num(row.jobs),
      mail_risk_jobs: num(row.risk_jobs),
      mail_stable_jobs: num(row.stable_jobs),
      last_mail_activity: row.last_activity,
      vendors_scored: 0,
      avg_vendor_score: 100,
      avg_vendor_risk: 0,
      vendor_jobs: 0,
      vendor_delays: 0,
      signals: 0,
      high_signals: 0,
      last_signal_at: null,
    });
  }

  for (const row of vendors.rows || []) {
    const existing =
      stateMap.get(row.state) ||
      {
        state: row.state,
        mail_jobs: 0,
        mail_risk_jobs: 0,
        mail_stable_jobs: 0,
        last_mail_activity: null,
        signals: 0,
        high_signals: 0,
        last_signal_at: null,
      };

    stateMap.set(row.state, {
      ...existing,
      vendors_scored: num(row.vendors_scored),
      avg_vendor_score: num(row.avg_vendor_score, 100),
      avg_vendor_risk: num(row.avg_vendor_risk),
      vendor_jobs: num(row.vendor_jobs),
      vendor_delays: num(row.vendor_delays),
    });
  }

  for (const row of signals.rows || []) {
    const existing =
      stateMap.get(row.state) ||
      {
        state: row.state,
        mail_jobs: 0,
        mail_risk_jobs: 0,
        mail_stable_jobs: 0,
        last_mail_activity: null,
        vendors_scored: 0,
        avg_vendor_score: 100,
        avg_vendor_risk: 0,
        vendor_jobs: 0,
        vendor_delays: 0,
      };

    stateMap.set(row.state, {
      ...existing,
      signals: num(row.signals),
      high_signals: num(row.high_signals),
      last_signal_at: row.last_signal_at,
    });
  }

  const states = Array.from(stateMap.values()).map((row) => {
    const mailPressure =
      row.mail_jobs > 0 ? Math.min(35, (row.mail_risk_jobs / row.mail_jobs) * 35) : 0;

    const vendorPressure = Math.min(
      35,
      Math.max(0, 100 - num(row.avg_vendor_score, 100)) * 0.35 + num(row.avg_vendor_risk) * 0.2
    );

    const signalPressure =
      row.signals > 0 ? Math.min(30, (row.high_signals / row.signals) * 30) : 0;

    const operational_score = Math.round(mailPressure + vendorPressure + signalPressure);

    return {
      ...row,
      operational_score,
      risk_label: riskLabel(operational_score),
      pressure_breakdown: {
        mail_pressure: Math.round(mailPressure),
        vendor_pressure: Math.round(vendorPressure),
        signal_pressure: Math.round(signalPressure),
      },
    };
  });

  states.sort((a, b) => b.operational_score - a.operational_score);

  const alerts = await pool.query(
    `
      SELECT
        id,
        type,
        title,
        state,
        office,
        severity,
        risk,
        source,
        created_at
      FROM executive_feed_events
      ORDER BY created_at DESC
      LIMIT 25
    `
  );

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    summary: {
      states_tracked: states.length,
      critical_states: states.filter((s) => s.risk_label === "Critical").length,
      high_states: states.filter((s) => s.risk_label === "High").length,
      elevated_states: states.filter((s) => s.risk_label === "Elevated").length,
      total_mail_jobs: states.reduce((sum, s) => sum + num(s.mail_jobs), 0),
      total_vendor_jobs: states.reduce((sum, s) => sum + num(s.vendor_jobs), 0),
      total_signals: states.reduce((sum, s) => sum + num(s.signals), 0),
    },
    states,
    alerts: alerts.rows || [],
    layers: {
      battleground: true,
      mailops: true,
      vendors: true,
      executive_alerts: true,
      operational_heat: true,
    },
  };
}
