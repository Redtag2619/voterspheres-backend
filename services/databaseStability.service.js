import { pool } from "../db/pool.js";

async function timedQuery(label, sql, params = []) {
  const started = Date.now();

  try {
    const result = await pool.query(sql, params);
    return {
      label,
      ok: true,
      latency_ms: Date.now() - started,
      rows: result.rows || [],
      error: "",
    };
  } catch (error) {
    return {
      label,
      ok: false,
      latency_ms: Date.now() - started,
      rows: [],
      error: error.message,
      code: error.code || "",
    };
  }
}

function statusFromLatency(ok, latency) {
  if (!ok) return "failed";
  if (latency <= 250) return "healthy";
  if (latency <= 1000) return "slow";
  return "critical";
}

function number(value = 0) {
  return Number(value || 0);
}

function tableCheck(name, result, minCount = 1) {
  const count = number(result.rows?.[0]?.count);
  const status = !result.ok
    ? "failed"
    : count >= minCount
    ? "healthy"
    : count > 0
    ? "review"
    : "empty";

  return {
    table: name,
    count,
    status,
    latency_ms: result.latency_ms,
    error: result.error,
  };
}

export async function getDatabaseStability() {
  const ping = await timedQuery("Database Ping", "SELECT NOW() AS now");
  const version = await timedQuery("Postgres Version", "SELECT version() AS version");

  const candidates = await timedQuery("candidates", "SELECT COUNT(*)::int AS count FROM candidates");
  const fecCandidates = await timedQuery("fec_candidates", "SELECT COUNT(*)::int AS count FROM fec_candidates");
  const workspaces = await timedQuery("workspaces", "SELECT COUNT(*)::int AS count FROM workspaces");
  const tasks = await timedQuery("tasks", "SELECT COUNT(*)::int AS count FROM tasks");
  const signals = await timedQuery("political_signals", "SELECT COUNT(*)::int AS count FROM political_signals");
  const vendors = await timedQuery("vendors", "SELECT COUNT(*)::int AS count FROM vendors");
  const reports = await timedQuery("intelligence_reports", "SELECT COUNT(*)::int AS count FROM intelligence_reports");
  const alerts = await timedQuery("notification_events", "SELECT COUNT(*)::int AS count FROM notification_events");
  const clients = await timedQuery("consultant_clients", "SELECT COUNT(*)::int AS count FROM consultant_clients");
  const crm = await timedQuery("campaign_crm_contacts", "SELECT COUNT(*)::int AS count FROM campaign_crm_contacts");

  const tableChecks = [
    tableCheck("candidates", candidates, 100),
    tableCheck("fec_candidates", fecCandidates, 100),
    tableCheck("workspaces", workspaces, 1),
    tableCheck("tasks", tasks, 1),
    tableCheck("political_signals", signals, 1),
    tableCheck("vendors", vendors, 1),
    tableCheck("intelligence_reports", reports, 1),
    tableCheck("notification_events", alerts, 1),
    tableCheck("consultant_clients", clients, 1),
    tableCheck("campaign_crm_contacts", crm, 1),
  ];

  const failedTables = tableChecks.filter((item) => item.status === "failed");
  const emptyTables = tableChecks.filter((item) => item.status === "empty");
  const reviewTables = tableChecks.filter((item) => item.status === "review");
  const healthyTables = tableChecks.filter((item) => item.status === "healthy");

  const allLatency = [
    ping.latency_ms,
    version.latency_ms,
    ...tableChecks.map((item) => item.latency_ms),
  ].filter((value) => Number.isFinite(value));

  const averageLatency = allLatency.length
    ? Math.round(allLatency.reduce((sum, value) => sum + value, 0) / allLatency.length)
    : 0;

  const maxLatency = allLatency.length ? Math.max(...allLatency) : 0;

  const envChecks = [
    {
      key: "database_url",
      label: "DATABASE_URL",
      status: process.env.DATABASE_URL ? "healthy" : "failed",
      detail: process.env.DATABASE_URL ? "Configured" : "Missing",
    },
    {
      key: "node_env",
      label: "NODE_ENV",
      status: process.env.NODE_ENV === "production" ? "healthy" : "review",
      detail: process.env.NODE_ENV || "development",
    },
    {
      key: "scheduled_reports",
      label: "Scheduled Report Runner",
      status: String(process.env.ENABLE_SCHEDULED_REPORTS || "").toLowerCase() === "false" ? "review" : "healthy",
      detail:
        String(process.env.ENABLE_SCHEDULED_REPORTS || "").toLowerCase() === "false"
          ? "Disabled locally"
          : "Enabled",
    },
    {
      key: "pool_config",
      label: "Postgres Pool",
      status: "healthy",
      detail: `Total: ${pool.totalCount || 0}, Idle: ${pool.idleCount || 0}, Waiting: ${pool.waitingCount || 0}`,
    },
  ];

  const connectionStatus = statusFromLatency(ping.ok, ping.latency_ms);

  const blockers = [
    ...(!ping.ok
      ? [
          {
            title: "Database connection failed",
            detail: ping.error || "Postgres did not respond.",
            priority: "High",
            action: "Check DATABASE_URL, Render database status, firewall, DNS, and local internet connection.",
          },
        ]
      : []),
    ...failedTables.map((item) => ({
      title: `${item.table} query failed`,
      detail: item.error || "Table query failed.",
      priority: "High",
      action: "Confirm migration/table exists and database user has permissions.",
    })),
    ...emptyTables.map((item) => ({
      title: `${item.table} has no records`,
      detail: "Launch-critical table is empty.",
      priority: "Medium",
      action: "Seed or ingest records before public launch.",
    })),
  ];

  const readinessScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (ping.ok ? 30 : 0) +
          (averageLatency <= 250 ? 20 : averageLatency <= 1000 ? 10 : 0) +
          (healthyTables.length / Math.max(1, tableChecks.length)) * 35 +
          (process.env.DATABASE_URL ? 10 : 0) +
          (failedTables.length === 0 ? 5 : 0)
      )
    )
  );

  return {
    summary: {
      readiness_score: readinessScore,
      status:
        !ping.ok || failedTables.length
          ? "Blocked"
          : readinessScore >= 85
          ? "Stable"
          : readinessScore >= 65
          ? "Needs Review"
          : "Unstable",
      connection_status: connectionStatus,
      average_latency_ms: averageLatency,
      max_latency_ms: maxLatency,
      failed_tables: failedTables.length,
      empty_tables: emptyTables.length,
      review_tables: reviewTables.length,
      healthy_tables: healthyTables.length,
      pool_total: pool.totalCount || 0,
      pool_idle: pool.idleCount || 0,
      pool_waiting: pool.waitingCount || 0,
    },
    ping: {
      ok: ping.ok,
      latency_ms: ping.latency_ms,
      error: ping.error,
      server_time: ping.rows?.[0]?.now || null,
      version: version.rows?.[0]?.version || "",
    },
    tables: tableChecks,
    env: envChecks,
    blockers,
    updated_at: new Date().toISOString(),
  };
}
