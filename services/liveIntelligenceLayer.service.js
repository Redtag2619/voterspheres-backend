import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[live-intelligence-layer] skipped query:", error.message);
    return [];
  }
}

function number(value = 0) {
  return Number(value || 0);
}

function freshnessStatus(lastSeen) {
  if (!lastSeen) return "missing";

  const diffHours = (Date.now() - new Date(lastSeen).getTime()) / 36e5;

  if (diffHours <= 6) return "live";
  if (diffHours <= 24) return "fresh";
  if (diffHours <= 72) return "stale";

  return "critical";
}

function buildFeedStatus({
  key,
  label,
  description,
  count = 0,
  lastSeen = null,
  route = "",
  owner = "System",
}) {
  const status = freshnessStatus(lastSeen);

  return {
    key,
    label,
    description,
    count: number(count),
    last_seen: lastSeen,
    status,
    route,
    owner,
    launch_ready: ["live", "fresh"].includes(status) && number(count) > 0,
  };
}

export async function getLiveIntelligenceLayer({ user = {} }) {
  const firmId = getFirmId(user);

  const candidates = await safeQuery(`
    SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
    FROM candidates
  `);

  const fecCandidates = await safeQuery(`
    SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
    FROM fec_candidates
  `);

  const signals = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(created_at) AS last_seen
          FROM political_signals
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const vendors = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
          FROM vendors
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const tasks = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
          FROM tasks
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

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

  const crmContacts = firmId
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
          SELECT COUNT(*)::int AS count, MAX(created_at) AS last_seen
          FROM intelligence_reports
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const notifications = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(created_at) AS last_seen
          FROM notification_events
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const clients = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen
          FROM consultant_clients
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : [];

  const feeds = [
    buildFeedStatus({
      key: "candidates",
      label: "Candidate Intelligence",
      description: "Candidate records, profiles, offices, states, party, election cycle, and enrichment status.",
      count: candidates[0]?.count,
      lastSeen: candidates[0]?.last_seen,
      route: "/candidates",
      owner: "Data",
    }),
    buildFeedStatus({
      key: "fec_candidates",
      label: "FEC Candidate Feed",
      description: "FEC candidate ingestion layer used for candidate and fundraising intelligence.",
      count: fecCandidates[0]?.count,
      lastSeen: fecCandidates[0]?.last_seen,
      route: "/fundraising",
      owner: "Data",
    }),
    buildFeedStatus({
      key: "political_signals",
      label: "Political Signals",
      description: "Live signal layer powering Mission Control, War Room, National Command, and Executive Workspace.",
      count: signals[0]?.count,
      lastSeen: signals[0]?.last_seen,
      route: "/political-signals",
      owner: "Intelligence",
    }),
    buildFeedStatus({
      key: "vendors",
      label: "Vendor Network",
      description: "Consultant, vendor, direct mail, digital, and operational coverage records.",
      count: vendors[0]?.count,
      lastSeen: vendors[0]?.last_seen,
      route: "/vendors",
      owner: "Operations",
    }),
    buildFeedStatus({
      key: "tasks",
      label: "Execution Tasks",
      description: "Execution board tasks, escalations, workspace assignments, and ownership status.",
      count: tasks[0]?.count,
      lastSeen: tasks[0]?.last_seen,
      route: "/command-center",
      owner: "Operations",
    }),
    buildFeedStatus({
      key: "workspaces",
      label: "Executive Workspaces",
      description: "Workspace system connecting campaigns, clients, signals, CRM, tasks, reports, and revenue.",
      count: workspaces[0]?.count,
      lastSeen: workspaces[0]?.last_seen,
      route: "/executive-workspace",
      owner: "Platform",
    }),
    buildFeedStatus({
      key: "campaign_crm_contacts",
      label: "Campaign CRM",
      description: "Campaign relationship contacts, organizations, activities, and follow-up surface.",
      count: crmContacts[0]?.count,
      lastSeen: crmContacts[0]?.last_seen,
      route: "/campaign-crm",
      owner: "CRM",
    }),
    buildFeedStatus({
      key: "intelligence_reports",
      label: "Intelligence Reports",
      description: "Generated intelligence reports and export-ready strategic deliverables.",
      count: reports[0]?.count,
      lastSeen: reports[0]?.last_seen,
      route: "/intelligence-reports",
      owner: "Reports",
    }),
    buildFeedStatus({
      key: "notification_events",
      label: "Notification Center",
      description: "Unified alert and notification stream across platform modules.",
      count: notifications[0]?.count,
      lastSeen: notifications[0]?.last_seen,
      route: "/notifications",
      owner: "Alerts",
    }),
    buildFeedStatus({
      key: "consultant_clients",
      label: "Client / Revenue Layer",
      description: "Client health, revenue records, retainers, invoices, and business suite records.",
      count: clients[0]?.count,
      lastSeen: clients[0]?.last_seen,
      route: "/business-suite",
      owner: "Revenue",
    }),
  ];

  const live = feeds.filter((feed) => feed.status === "live").length;
  const fresh = feeds.filter((feed) => feed.status === "fresh").length;
  const stale = feeds.filter((feed) => feed.status === "stale").length;
  const critical = feeds.filter((feed) => feed.status === "critical").length;
  const missing = feeds.filter((feed) => feed.status === "missing").length;
  const launchReady = feeds.filter((feed) => feed.launch_ready).length;

  const readinessScore = Math.round((launchReady / Math.max(1, feeds.length)) * 100);

  return {
    summary: {
      total_feeds: feeds.length,
      live,
      fresh,
      stale,
      critical,
      missing,
      launch_ready: launchReady,
      readiness_score: readinessScore,
      readiness_status:
        readinessScore >= 85
          ? "Launch Ready"
          : readinessScore >= 65
          ? "Needs Review"
          : "Not Ready",
    },
    feeds,
    recommendations: feeds
      .filter((feed) => !feed.launch_ready)
      .map((feed) => ({
        key: feed.key,
        title: `${feed.label} needs attention`,
        detail:
          feed.status === "missing"
            ? "No records or timestamp detected. Confirm table data, ingestion, or workspace seed records."
            : "Feed is stale. Refresh ingestion or confirm live update path.",
        route: feed.route,
        status: feed.status,
      })),
    updated_at: new Date().toISOString(),
  };
}
