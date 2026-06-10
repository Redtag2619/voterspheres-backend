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

export async function getExecutiveKpis({ user = {} }) {
  const firmId = getFirmId(user);

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
            AND archived_at IS NULL
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

  const candidates = await safeQuery(`
    SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
    FROM candidates
  `);

  const fec = await safeQuery(`
    SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
    FROM fec_candidates
  `);

  const reports = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count
          FROM intelligence_reports
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const taskOpen = number(tasks[0]?.open);
  const urgentTasks = number(tasks[0]?.urgent);
  const criticalSignals = number(signals[0]?.critical);
  const criticalAlerts = number(alerts[0]?.critical);
  const atRiskClients = number(clients[0]?.at_risk);

  const nationalRisk = percent(
    urgentTasks * 10 +
      criticalSignals * 8 +
      criticalAlerts * 10 +
      atRiskClients * 6
  );

  const liveReadiness = percent(
    (number(candidates[0]?.count) > 0 ? 25 : 0) +
      (number(fec[0]?.count) > 0 ? 25 : 0) +
      (number(workspaces[0]?.count) > 0 ? 20 : 0) +
      (number(reports[0]?.count) > 0 ? 15 : 0) +
      (number(signals[0]?.total) > 0 ? 15 : 0)
  );

  return {
    summary: {
      active_workspaces: number(workspaces[0]?.count),
      national_risk: nationalRisk,
      open_tasks: taskOpen,
      urgent_tasks: urgentTasks,
      critical_alerts: criticalAlerts,
      critical_signals: criticalSignals,
      clients_at_risk: atRiskClients,
      monthly_retainer: number(clients[0]?.monthly_retainer),
      candidate_records: number(candidates[0]?.count),
      fec_records: number(fec[0]?.count),
      live_readiness: liveReadiness,
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
