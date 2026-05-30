import { pool } from "../db/pool.js";

async function tableExists(tableName) {
  const { rows } = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(rows[0]?.exists);
}

function riskFromPressure(score) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function seedScore(stateCode = "", countyFips = "", index = 0) {
  const seed =
    String(stateCode).charCodeAt(0) * 7 +
    String(stateCode).charCodeAt(1) * 11 +
    Number(countyFips || 0) * 3 +
    index * 13;

  return clamp(seed % 100, 18, 96);
}

async function getMailOpsStateMap() {
  if (!(await tableExists("mailops_events"))) return new Map();

  const { rows } = await pool.query(`
    SELECT
      UPPER(COALESCE(state, state_code, '')) AS state_code,
      COUNT(*)::int AS total
    FROM mailops_events
    WHERE COALESCE(state, state_code, '') <> ''
    GROUP BY UPPER(COALESCE(state, state_code, ''))
  `);

  return new Map(rows.map((row) => [row.state_code, Number(row.total || 0)]));
}

async function getVendorStateMap() {
  if (!(await tableExists("vendors"))) return new Map();

  const { rows } = await pool.query(`
    SELECT
      UPPER(COALESCE(state, state_code, '')) AS state_code,
      COUNT(*)::int AS total
    FROM vendors
    WHERE COALESCE(state, state_code, '') <> ''
    GROUP BY UPPER(COALESCE(state, state_code, ''))
  `);

  return new Map(rows.map((row) => [row.state_code, Number(row.total || 0)]));
}

async function getTaskStateMap() {
  if (!(await tableExists("tasks"))) return new Map();

  const { rows } = await pool.query(`
    SELECT
      UPPER(COALESCE(state, state_code, metadata->>'state', '')) AS state_code,
      COUNT(*)::int AS total
    FROM tasks
    WHERE COALESCE(state, state_code, metadata->>'state', '') <> ''
    GROUP BY UPPER(COALESCE(state, state_code, metadata->>'state', ''))
  `);

  return new Map(rows.map((row) => [row.state_code, Number(row.total || 0)]));
}

async function getAlertStateMap() {
  if (!(await tableExists("executive_alerts"))) return new Map();

  const { rows } = await pool.query(`
    SELECT
      UPPER(COALESCE(state, state_code, '')) AS state_code,
      COUNT(*)::int AS total
    FROM executive_alerts
    WHERE COALESCE(state, state_code, '') <> ''
    GROUP BY UPPER(COALESCE(state, state_code, ''))
  `);

  return new Map(rows.map((row) => [row.state_code, Number(row.total || 0)]));
}

async function getFundraisingStateMap() {
  if (!(await tableExists("fec_candidates"))) return new Map();

  const { rows } = await pool.query(`
    SELECT
      UPPER(COALESCE(state, state_code, candidate_state, '')) AS state_code,
      COUNT(*)::int AS total
    FROM fec_candidates
    WHERE COALESCE(state, state_code, candidate_state, '') <> ''
    GROUP BY UPPER(COALESCE(state, state_code, candidate_state, ''))
  `);

  return new Map(rows.map((row) => [row.state_code, Number(row.total || 0)]));
}

export async function loadOperationsSignalMaps() {
  const [mailOps, vendors, tasks, alerts, fundraising] = await Promise.all([
    getMailOpsStateMap(),
    getVendorStateMap(),
    getTaskStateMap(),
    getAlertStateMap(),
    getFundraisingStateMap(),
  ]);

  return {
    mailOps,
    vendors,
    tasks,
    alerts,
    fundraising,
  };
}

export function scoreLocality({ locality, index = 0, signalMaps }) {
  const stateCode = locality.state_code;
  const base = seedScore(stateCode, locality.county_fips, index);

  const mailopsScore = clamp((signalMaps.mailOps.get(stateCode) || 0) * 8);
  const vendorCount = signalMaps.vendors.get(stateCode) || 0;
  const vendorScore = clamp(100 - vendorCount * 7, 8, 96);
  const taskPressure = clamp((signalMaps.tasks.get(stateCode) || 0) * 10);
  const alertPressure = clamp((signalMaps.alerts.get(stateCode) || 0) * 12);
  const fundraisingPressure = clamp((signalMaps.fundraising.get(stateCode) || 0) * 2);

  const totalPressure = clamp(
    Math.round(
      base * 0.35 +
        mailopsScore * 0.18 +
        vendorScore * 0.18 +
        taskPressure * 0.12 +
        alertPressure * 0.12 +
        fundraisingPressure * 0.05
    )
  );

  return {
    pressure: totalPressure,
    risk: riskFromPressure(totalPressure),
    mailops_score: mailopsScore,
    vendor_score: Math.round(100 - vendorScore),
    vendor_gap_score: vendorScore,
    task_pressure: taskPressure,
    alert_pressure: alertPressure,
    fundraising_pressure: fundraisingPressure,
    scoring_breakdown: {
      baseline: base,
      mailops_score: mailopsScore,
      vendor_gap_score: vendorScore,
      task_pressure: taskPressure,
      alert_pressure: alertPressure,
      fundraising_pressure: fundraisingPressure,
      total_pressure: totalPressure,
    },
  };
}

export function summarizeStateFromLocalities(stateCode, localities = []) {
  const pressure = localities.length
    ? Math.round(
        localities.reduce((sum, item) => sum + Number(item.pressure || 0), 0) /
          localities.length
      )
    : 0;

  return {
    state: stateCode,
    pressure,
    risk: riskFromPressure(pressure),
    critical_counties: localities.filter((item) => item.risk === "Critical").length,
    vendor_gap_count: localities.filter((item) => Number(item.vendor_gap_score || 0) >= 55).length,
    total_mail_jobs: localities.reduce((sum, item) => sum + Math.round(Number(item.mailops_score || 0) / 8), 0),
    total_alerts: localities.reduce((sum, item) => sum + Math.round(Number(item.alert_pressure || 0) / 12), 0),
  };
}
