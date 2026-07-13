import { pool } from "../db/pool.js";

function resolveFirmId(user = {}) {
  return (
    user.firmId ||
    user.firm_id ||
    user.firm?.id ||
    null
  );
}

async function safeQuery({
  key,
  sql,
  params = [],
  fallback = [],
}) {
  try {
    const result = await pool.query(sql, params);

    return {
      ok: true,
      key,
      rows: result.rows || fallback,
      error: null,
    };
  } catch (error) {
    console.warn(
      `[executive-kpi] ${key} query skipped:`,
      error.message
    );

    return {
      ok: false,
      key,
      rows: fallback,
      error: error.message,
    };
  }
}

function number(value = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentage(value = 0) {
  return Math.max(
    0,
    Math.min(100, Math.round(number(value)))
  );
}

function coverageScore({
  count = 0,
  target = 1,
  weight = 10,
}) {
  return Math.min(
    weight,
    (number(count) / Math.max(1, number(target))) * weight
  );
}

function freshnessLabel(dateValue) {
  if (!dateValue) return "unknown";

  const timestamp = new Date(dateValue).getTime();

  if (!Number.isFinite(timestamp)) return "unknown";

  const ageMs = Date.now() - timestamp;
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (ageMs <= hour) return "live";
  if (ageMs <= day) return "fresh";
  if (ageMs <= 7 * day) return "aging";

  return "stale";
}

function buildSourceStatus(result, lastSeen = null) {
  return {
    key: result.key,
    ok: result.ok,
    status: result.ok ? "available" : "degraded",
    last_seen: lastSeen || null,
    freshness: freshnessLabel(lastSeen),
    error: result.error || null,
  };
}

export async function getExecutiveKpis({
  user = {},
} = {}) {
  const firmId = resolveFirmId(user);

  const [
    candidatesResult,
    fecResult,
    workspacesResult,
    tasksResult,
    signalsResult,
    alertsResult,
    clientsResult,
    crmResult,
    reportsResult,
  ] = await Promise.all([
    safeQuery({
      key: "candidates",
      sql: `
        SELECT
          COUNT(*)::int AS count,
          MAX(updated_at) AS last_seen
        FROM candidates
      `,
    }),

    safeQuery({
      key: "fec",
      sql: `
        SELECT
          COUNT(*)::int AS count,
          MAX(
            COALESCE(
              source_updated_at,
              updated_at,
              created_at
            )
          ) AS last_seen
        FROM fundraising_live
      `,
    }),

    firmId
      ? safeQuery({
          key: "workspaces",
          sql: `
            SELECT
              COUNT(*)::int AS count,
              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(status, 'active')
                ) = 'active'
              )::int AS active,
              MAX(updated_at) AS last_seen
            FROM workspaces
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "workspaces",
          rows: [],
          error: "Missing firm context",
        }),

    firmId
      ? safeQuery({
          key: "tasks",
          sql: `
            SELECT
              COUNT(*)::int AS total,

              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(status, '')
                ) NOT IN (
                  'done',
                  'complete',
                  'completed',
                  'resolved'
                )
              )::int AS open,

              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(status, '')
                ) IN (
                  'blocked',
                  'paused',
                  'hold'
                )
              )::int AS blocked,

              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(priority, '')
                ) IN (
                  'critical',
                  'high'
                )
                AND LOWER(
                  COALESCE(status, '')
                ) NOT IN (
                  'done',
                  'complete',
                  'completed',
                  'resolved'
                )
              )::int AS urgent,

              MAX(
                COALESCE(updated_at, created_at)
              ) AS last_seen
            FROM tasks
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "tasks",
          rows: [],
          error: "Missing firm context",
        }),

    firmId
      ? safeQuery({
          key: "political_signals",
          sql: `
            SELECT
              COUNT(*)::int AS total,

              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(
                    risk,
                    severity,
                    ''
                  )
                ) IN (
                  'critical',
                  'high'
                )
                OR COALESCE(signal_score, 0) >= 75
              )::int AS critical,

              MAX(
                COALESCE(updated_at, created_at)
              ) AS last_seen
            FROM political_signals
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "political_signals",
          rows: [],
          error: "Missing firm context",
        }),

    firmId
      ? safeQuery({
          key: "alerts",
          sql: `
            SELECT
              COUNT(*)::int AS total,

              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(level, '')
                ) IN (
                  'critical',
                  'high',
                  'danger'
                )
              )::int AS critical,

              MAX(
                COALESCE(updated_at, created_at)
              ) AS last_seen
            FROM notification_events
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "alerts",
          rows: [],
          error: "Missing firm context",
        }),

    firmId
      ? safeQuery({
          key: "clients",
          sql: `
            SELECT
              COUNT(*)::int AS total,

              COUNT(*) FILTER (
                WHERE LOWER(
                  COALESCE(health_status, '')
                ) IN (
                  'at risk',
                  'watch',
                  'critical',
                  'overdue'
                )
              )::int AS at_risk,

              COALESCE(
                SUM(monthly_retainer),
                0
              )::numeric AS monthly_retainer,

              MAX(
                COALESCE(updated_at, created_at)
              ) AS last_seen
            FROM consultant_clients
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "clients",
          rows: [],
          error: "Missing firm context",
        }),

    firmId
      ? safeQuery({
          key: "crm",
          sql: `
            SELECT
              COUNT(*)::int AS count,
              MAX(updated_at) AS last_seen
            FROM campaign_crm_contacts
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "crm",
          rows: [],
          error: "Missing firm context",
        }),

    firmId
      ? safeQuery({
          key: "reports",
          sql: `
            SELECT
              COUNT(*)::int AS count,
              MAX(
                COALESCE(updated_at, created_at)
              ) AS last_seen
            FROM intelligence_reports
            WHERE firm_id = $1
          `,
          params: [firmId],
        })
      : Promise.resolve({
          ok: false,
          key: "reports",
          rows: [],
          error: "Missing firm context",
        }),
  ]);

  const candidates = candidatesResult.rows[0] || {};
  const fec = fecResult.rows[0] || {};
  const workspaces = workspacesResult.rows[0] || {};
  const tasks = tasksResult.rows[0] || {};
  const signals = signalsResult.rows[0] || {};
  const alerts = alertsResult.rows[0] || {};
  const clients = clientsResult.rows[0] || {};
  const crm = crmResult.rows[0] || {};
  const reports = reportsResult.rows[0] || {};

  const taskTotal = number(tasks.total);
  const taskOpen = number(tasks.open);
  const taskBlocked = number(tasks.blocked);
  const urgentTasks = number(tasks.urgent);

  const signalTotal = number(signals.total);
  const criticalSignals = number(signals.critical);

  const alertTotal = number(alerts.total);
  const criticalAlerts = number(alerts.critical);

  const clientTotal = number(clients.total);
  const atRiskClients = number(clients.at_risk);

  const urgentTaskRate = taskTotal
    ? urgentTasks / taskTotal
    : 0;

  const blockedTaskRate = taskTotal
    ? taskBlocked / taskTotal
    : 0;

  const criticalSignalRate = signalTotal
    ? criticalSignals / signalTotal
    : 0;

  const criticalAlertRate = alertTotal
    ? criticalAlerts / alertTotal
    : 0;

  const clientRiskRate = clientTotal
    ? atRiskClients / clientTotal
    : 0;

  const nationalRisk = percentage(
    urgentTaskRate * 25 +
      blockedTaskRate * 15 +
      criticalSignalRate * 25 +
      criticalAlertRate * 20 +
      clientRiskRate * 15
  );

  const liveReadiness = percentage(
    coverageScore({
      count: candidates.count,
      target: 1000,
      weight: 15,
    }) +
      coverageScore({
        count: fec.count,
        target: 500,
        weight: 15,
      }) +
      coverageScore({
        count: workspaces.count,
        target: 1,
        weight: 15,
      }) +
      coverageScore({
        count: taskTotal,
        target: 20,
        weight: 15,
      }) +
      coverageScore({
        count: crm.count,
        target: 15,
        weight: 15,
      }) +
      coverageScore({
        count: clientTotal,
        target: 10,
        weight: 10,
      }) +
      coverageScore({
        count: reports.count,
        target: 5,
        weight: 10,
      }) +
      coverageScore({
        count: alertTotal,
        target: 20,
        weight: 5,
      })
  );

  const status =
    nationalRisk >= 70
      ? "Critical"
      : nationalRisk >= 40
        ? "Watch"
        : "Stable";

  const sourceStatus = [
    buildSourceStatus(
      candidatesResult,
      candidates.last_seen
    ),
    buildSourceStatus(
      fecResult,
      fec.last_seen
    ),
    buildSourceStatus(
      workspacesResult,
      workspaces.last_seen
    ),
    buildSourceStatus(
      tasksResult,
      tasks.last_seen
    ),
    buildSourceStatus(
      signalsResult,
      signals.last_seen
    ),
    buildSourceStatus(
      alertsResult,
      alerts.last_seen
    ),
    buildSourceStatus(
      clientsResult,
      clients.last_seen
    ),
    buildSourceStatus(
      crmResult,
      crm.last_seen
    ),
    buildSourceStatus(
      reportsResult,
      reports.last_seen
    ),
  ];

  const availableSources = sourceStatus.filter(
    (source) => source.ok
  ).length;

  const degradedSources = sourceStatus.filter(
    (source) => !source.ok
  ).length;

  const confidence = percentage(
    sourceStatus.length
      ? (availableSources / sourceStatus.length) * 100
      : 0
  );

  return {
    summary: {
      active_workspaces: number(
        workspaces.active ?? workspaces.count
      ),
      total_workspaces: number(workspaces.count),

      national_risk: nationalRisk,
      live_readiness: liveReadiness,
      intelligence_confidence: confidence,

      open_tasks: taskOpen,
      blocked_tasks: taskBlocked,
      urgent_tasks: urgentTasks,
      total_tasks: taskTotal,

      critical_alerts: criticalAlerts,
      total_alerts: alertTotal,

      critical_signals: criticalSignals,
      total_signals: signalTotal,

      clients_at_risk: atRiskClients,
      total_clients: clientTotal,
      monthly_retainer: number(
        clients.monthly_retainer
      ),

      candidate_records: number(candidates.count),
      fec_records: number(fec.count),
      crm_contacts: number(crm.count),
      reports: number(reports.count),

      available_sources: availableSources,
      degraded_sources: degradedSources,

      status,
    },

    source_status: sourceStatus,
    updated_at: new Date().toISOString(),
  };
}
