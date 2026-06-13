import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[executive-kpi] skipped query:", error.message);
    return [];
  }
}

function number(value = 0) {
  return Number(value || 0);
}

function percent(value = 0) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function coverageScore({ count = 0, target = 1, weight = 10 }) {
  return Math.min(weight, (number(count) / Math.max(1, target)) * weight);
}

export async function getExecutiveKpis({ user = {} }) {
  const firmId = getFirmId(user);

  const candidates = await safeQuery(`
    SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
    FROM candidates
  `);

  const fec = await safeQuery(`
    SELECT COUNT(*)::int AS count, MAX(COALESCE(source_updated_at, updated_at, created_at)) AS last_seen
    FROM fundraising_live
  `);

  const workspaces = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
          FROM workspaces
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const tasks = firmId
    ? await safeQuery(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(status,'')) NOT IN ('done','complete','completed','resolved')
            )::int AS open,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(priority,'')) IN ('critical','high')
                AND LOWER(COALESCE(status,'')) NOT IN ('done','complete','completed','resolved')
            )::int AS urgent
          FROM tasks
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const signals = firmId
    ? await safeQuery(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(risk,severity,'')) IN ('critical','high')
                OR COALESCE(signal_score,0) >= 75
            )::int AS critical
          FROM political_signals
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const alerts = firmId
    ? await safeQuery(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(level,'')) IN ('critical','high','danger')
            )::int AS critical
          FROM notification_events
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const clients = firmId
    ? await safeQuery(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(health_status,'')) IN ('at risk','watch','critical','overdue')
            )::int AS at_risk,
            COALESCE(SUM(monthly_retainer),0)::numeric AS monthly_retainer
          FROM consultant_clients
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const crm = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
          FROM campaign_crm_contacts
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const reports = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(COALESCE(updated_at, created_at)) AS last_seen
          FROM intelligence_reports
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const taskTotal = number(tasks[0]?.total);
  const taskOpen = number(tasks[0]?.open);
  const urgentTasks = number(tasks[0]?.urgent);
  const signalTotal = number(signals[0]?.total);
  const criticalSignals = number(signals[0]?.critical);
  const alertTotal = number(alerts[0]?.total);
  const criticalAlerts = number(alerts[0]?.critical);
  const clientTotal = number(clients[0]?.total);
  const atRiskClients = number(clients[0]?.at_risk);

  const urgentTaskRate = taskTotal ? urgentTasks / taskTotal : 0;
  const criticalSignalRate = signalTotal ? criticalSignals / signalTotal : 0;
  const criticalAlertRate = alertTotal ? criticalAlerts / alertTotal : 0;
  const clientRiskRate = clientTotal ? atRiskClients / clientTotal : 0;

  const nationalRisk = percent(
    urgentTaskRate * 30 +
      criticalSignalRate * 25 +
      criticalAlertRate * 25 +
      clientRiskRate * 20
  );

  const liveReadiness = percent(
    coverageScore({ count: candidates[0]?.count, target: 1000, weight: 15 }) +
      coverageScore({ count: fec[0]?.count, target: 500, weight: 15 }) +
      coverageScore({ count: workspaces[0]?.count, target: 1, weight: 15 }) +
      coverageScore({ count: taskTotal, target: 20, weight: 15 }) +
      coverageScore({ count: crm[0]?.count, target: 15, weight: 15 }) +
      coverageScore({ count: clientTotal, target: 10, weight: 10 }) +
      coverageScore({ count: reports[0]?.count, target: 5, weight: 10 }) +
      coverageScore({ count: alertTotal, target: 20, weight: 5 })
  );

  return {
    summary: {
      active_workspaces: number(workspaces[0]?.count),
      national_risk: nationalRisk,
      live_readiness: liveReadiness,

      open_tasks: taskOpen,
      urgent_tasks: urgentTasks,
      total_tasks: taskTotal,

      critical_alerts: criticalAlerts,
      total_alerts: alertTotal,

      critical_signals: criticalSignals,
      total_signals: signalTotal,

      clients_at_risk: atRiskClients,
      total_clients: clientTotal,
      monthly_retainer: number(clients[0]?.monthly_retainer),

      candidate_records: number(candidates[0]?.count),
      fec_records: number(fec[0]?.count),
      crm_contacts: number(crm[0]?.count),
      reports: number(reports[0]?.count),

      status:
        nationalRisk >= 70
          ? "Critical"
          : nationalRisk >= 40
          ? "Watch"
          : "Stable",
    },
    updated_at: new Date().toISOString(),
  };
}
