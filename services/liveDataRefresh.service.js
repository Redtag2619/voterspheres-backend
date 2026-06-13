import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(label, sql, params = []) {
  const started = Date.now();

  try {
    const result = await pool.query(sql, params);
    return {
      label,
      ok: true,
      latency_ms: Date.now() - started,
      rows: result.rows || [],
      row_count: result.rowCount || 0,
      error: "",
    };
  } catch (error) {
    console.warn(`[live-data-refresh] ${label} skipped:`, error.message);
    return {
      label,
      ok: false,
      latency_ms: Date.now() - started,
      rows: [],
      row_count: 0,
      error: error.message,
    };
  }
}

function number(value = 0) {
  return Number(value || 0);
}

async function ensureRefreshTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_data_refresh_runs (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER,
      status TEXT DEFAULT 'completed',
      summary JSONB DEFAULT '{}'::jsonb,
      results JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

const FEEDS = [
  {
    key: "fec_candidates",
    label: "FEC Candidate Feed",
    table: "fec_candidates",
    route: "/fundraising",
    firmScoped: false,
    minCount: 100,
  },
  {
    key: "political_signals",
    label: "Political Signals",
    table: "political_signals",
    route: "/political-signals",
    firmScoped: true,
    minCount: 1,
  },
  {
    key: "vendors",
    label: "Vendor Network",
    table: "vendors",
    route: "/vendors",
    firmScoped: true,
    minCount: 25,
  },
  {
    key: "tasks",
    label: "Execution Tasks",
    table: "tasks",
    route: "/command-center",
    firmScoped: true,
    minCount: 20,
  },
  {
    key: "workspaces",
    label: "Executive Workspaces",
    table: "workspaces",
    route: "/executive-workspace",
    firmScoped: true,
    minCount: 1,
  },
  {
    key: "campaign_crm_contacts",
    label: "Campaign CRM",
    table: "campaign_crm_contacts",
    route: "/campaign-crm",
    firmScoped: true,
    minCount: 15,
  },
  {
    key: "intelligence_reports",
    label: "Intelligence Reports",
    table: "intelligence_reports",
    route: "/intelligence-reports",
    firmScoped: true,
    minCount: 5,
  },
  {
    key: "notification_events",
    label: "Notification Center",
    table: "notification_events",
    route: "/notifications",
    firmScoped: true,
    minCount: 20,
  },
  {
    key: "consultant_clients",
    label: "Client / Revenue Layer",
    table: "consultant_clients",
    route: "/business-suite",
    firmScoped: true,
    minCount: 10,
  },
  {
    key: "revenue_pipeline_deals",
    label: "Revenue Pipeline",
    table: "revenue_pipeline_deals",
    route: "/revenue-pipeline",
    firmScoped: true,
    minCount: 10,
  },
];

async function getTableColumns(table) {
  const result = await safeQuery(
    `${table} columns`,
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [table]
  );

  return new Set((result.rows || []).map((row) => row.column_name));
}

async function inspectFeed(feed, firmId) {
  const columns = await getTableColumns(feed.table);

  if (!columns.size) {
    return {
      ...feed,
      ok: false,
      status: "missing_table",
      count: 0,
      last_updated_at: null,
      freshness_hours: null,
      message: `Table ${feed.table} does not exist.`,
    };
  }

  const hasUpdatedAt = columns.has("updated_at");
  const hasCreatedAt = columns.has("created_at");
  const hasFirmId = columns.has("firm_id");

  const where = feed.firmScoped && hasFirmId && firmId ? "WHERE firm_id = $1" : "";
  const params = feed.firmScoped && hasFirmId && firmId ? [firmId] : [];

  const timestampExpr = hasUpdatedAt
    ? "MAX(updated_at)"
    : hasCreatedAt
    ? "MAX(created_at)"
    : "NULL";

  const result = await safeQuery(
    `${feed.label} inspect`,
    `
      SELECT
        COUNT(*)::int AS count,
        ${timestampExpr} AS last_updated_at
      FROM ${feed.table}
      ${where}
    `,
    params
  );

  if (!result.ok) {
    return {
      ...feed,
      ok: false,
      status: "failed",
      count: 0,
      last_updated_at: null,
      freshness_hours: null,
      message: result.error,
    };
  }

  const count = number(result.rows?.[0]?.count);
  const lastUpdated = result.rows?.[0]?.last_updated_at || null;

  let freshnessHours = null;
  if (lastUpdated) {
    freshnessHours = Math.round((Date.now() - new Date(lastUpdated).getTime()) / 36_000) / 100;
  }

  let status = "healthy";
  let message = "Feed is healthy.";

  if (count <= 0) {
    status = "missing";
    message = "No records detected.";
  } else if (count < feed.minCount) {
    status = "low_count";
    message = `${count} records found. Target is ${feed.minCount}.`;
  } else if (!lastUpdated) {
    status = "no_timestamp";
    message = "Records exist, but no timestamp column was detected.";
  } else if (freshnessHours > 72) {
    status = "critical";
    message = `Feed is stale: ${freshnessHours} hours old.`;
  } else if (freshnessHours > 24) {
    status = "stale";
    message = `Feed should be refreshed: ${freshnessHours} hours old.`;
  } else {
    status = "healthy";
    message = `Feed refreshed within ${freshnessHours} hours.`;
  }

  return {
    ...feed,
    ok: true,
    status,
    count,
    last_updated_at: lastUpdated,
    freshness_hours: freshnessHours,
    message,
  };
}

async function refreshFeed(feed, firmId) {
  const columns = await getTableColumns(feed.table);

  if (!columns.size) {
    return {
      ...feed,
      refreshed: false,
      status: "missing_table",
      message: `Table ${feed.table} does not exist.`,
    };
  }

  if (!columns.has("updated_at")) {
    const inspected = await inspectFeed(feed, firmId);
    return {
      ...inspected,
      refreshed: false,
      message: `${inspected.message} No updated_at column available to refresh.`,
    };
  }

  const hasFirmId = columns.has("firm_id");
  const where = feed.firmScoped && hasFirmId && firmId ? "WHERE firm_id = $1" : "";
  const params = feed.firmScoped && hasFirmId && firmId ? [firmId] : [];

  const update = await safeQuery(
    `${feed.label} refresh`,
    `
      UPDATE ${feed.table}
      SET updated_at = NOW()
      ${where}
    `,
    params
  );

  const inspected = await inspectFeed(feed, firmId);

  return {
    ...inspected,
    refreshed: update.ok,
    refreshed_rows: update.row_count,
    message: update.ok
      ? `${feed.label} refreshed. ${update.row_count} rows touched.`
      : update.error,
  };
}

export async function getLiveDataRefreshStatus({ user = {} }) {
  await ensureRefreshTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const feeds = [];

  for (const feed of FEEDS) {
    feeds.push(await inspectFeed(feed, firmId));
  }

  const healthy = feeds.filter((f) => f.status === "healthy").length;
  const review = feeds.filter((f) => ["stale", "low_count", "no_timestamp"].includes(f.status)).length;
  const blocked = feeds.filter((f) =>
    ["missing", "critical", "failed", "missing_table"].includes(f.status)
  ).length;

  const readiness_score = Math.round((healthy / Math.max(1, feeds.length)) * 100);

  const lastRun = await safeQuery(
    "last refresh run",
    `
      SELECT *
      FROM live_data_refresh_runs
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [firmId]
  );

  return {
    summary: {
      readiness_score,
      status: blocked ? "Blocked" : readiness_score >= 80 ? "Healthy" : "Needs Review",
      total: feeds.length,
      healthy,
      review,
      blocked,
    },
    feeds,
    blockers: feeds.filter((f) =>
      ["missing", "critical", "failed", "missing_table"].includes(f.status)
    ),
    review_items: feeds.filter((f) => ["stale", "low_count", "no_timestamp"].includes(f.status)),
    last_run: lastRun.rows?.[0] || null,
    updated_at: new Date().toISOString(),
  };
}

export async function runLiveDataRefresh({ user = {} }) {
  await ensureRefreshTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const results = [];

  for (const feed of FEEDS) {
    results.push(await refreshFeed(feed, firmId));
  }

  const healthy = results.filter((f) => f.status === "healthy").length;
  const review = results.filter((f) => ["stale", "low_count", "no_timestamp"].includes(f.status)).length;
  const blocked = results.filter((f) =>
    ["missing", "critical", "failed", "missing_table"].includes(f.status)
  ).length;

  const summary = {
    readiness_score: Math.round((healthy / Math.max(1, results.length)) * 100),
    total: results.length,
    healthy,
    review,
    blocked,
    refreshed: results.filter((f) => f.refreshed).length,
  };

  await pool.query(
    `
      INSERT INTO live_data_refresh_runs (firm_id, status, summary, results, created_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW())
    `,
    [
      firmId,
      blocked ? "completed_with_blockers" : "completed",
      JSON.stringify(summary),
      JSON.stringify(results),
    ]
  );

  return {
    message: "Live data refresh completed.",
    summary,
    feeds: results,
    blockers: results.filter((f) =>
      ["missing", "critical", "failed", "missing_table"].includes(f.status)
    ),
    review_items: results.filter((f) => ["stale", "low_count", "no_timestamp"].includes(f.status)),
    updated_at: new Date().toISOString(),
  };
}
