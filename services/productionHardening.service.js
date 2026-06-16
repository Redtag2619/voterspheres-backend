import { pool } from "../db/pool.js";

function number(value = 0) {
  return Number(value || 0);
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[production-hardening] skipped query:", error.message);
    return [];
  }
}

function statusFromCount(count, minimum = 1) {
  return number(count) >= minimum ? "Ready" : "Review";
}

function buildCheck({
  key,
  label,
  category,
  status = "Review",
  detail,
  action,
  route = null,
}) {
  return {
    key,
    label,
    category,
    status,
    detail,
    action,
    route,
  };
}

export async function getProductionHardening() {
  const dbStarted = Date.now();

  let databaseReady = false;
  let databaseDetail = "Database connection has not been checked.";

  try {
    await pool.query("SELECT NOW()");
    databaseReady = true;
    databaseDetail = "Database connection is responding.";
  } catch (error) {
    databaseDetail = error.message;
  }

  const candidates = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM candidates
  `);

  const fecCandidates = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM fec_candidates
  `);

  const users = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM users
  `);

  const workspaces = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM workspaces
  `);

  const tasks = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM tasks
  `);

  const politicalSignals = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM political_signals
  `);

  const vendors = await safeQuery(`
    SELECT COUNT(*)::int AS count,
           MAX(COALESCE(updated_at, last_imported_at, created_at)) AS last_seen
    FROM vendors
  `);

  const crmContacts = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM campaign_crm_contacts
  `);

  const clients = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM consultant_clients
  `);

  const reports = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM intelligence_reports
  `);

  const notifications = await safeQuery(`
    SELECT COUNT(*)::int AS count,
           MAX(COALESCE(created_at, updated_at)) AS last_seen
    FROM notification_events
  `);

  const corsOrigin = process.env.CORS_ORIGIN || "";
  const jwtSecret = process.env.JWT_SECRET || "";
  const databaseUrl = process.env.DATABASE_URL || "";
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const fecApiKey = process.env.FEC_API_KEY || "";

  const checks = [
    buildCheck({
      key: "database-connection",
      label: "Database Connection",
      category: "Infrastructure",
      status: databaseReady ? "Ready" : "Blocked",
      detail: databaseDetail,
      action: "Confirm Render PostgreSQL is connected and migrations are applied.",
    }),
    buildCheck({
      key: "database-url",
      label: "DATABASE_URL",
      category: "Environment",
      status: databaseUrl ? "Ready" : "Blocked",
      detail: databaseUrl ? "DATABASE_URL is configured." : "DATABASE_URL is missing.",
      action: "Add DATABASE_URL to Render environment variables.",
    }),
    buildCheck({
      key: "jwt-secret",
      label: "JWT Secret",
      category: "Security",
      status: jwtSecret ? "Ready" : "Blocked",
      detail: jwtSecret ? "JWT_SECRET is configured." : "JWT_SECRET is missing.",
      action: "Add a strong JWT_SECRET before launch.",
    }),
    buildCheck({
      key: "cors-origin",
      label: "CORS Origin",
      category: "Security",
      status: corsOrigin ? "Ready" : "Blocked",
      detail: corsOrigin
        ? `CORS_ORIGIN configured: ${corsOrigin}`
        : "CORS_ORIGIN is not explicitly configured.",
      action:
        "Confirm only voterspheres.org and www.voterspheres.org are allowed in production.",
    }),
    buildCheck({
      key: "stripe-secret-key",
      label: "Stripe Secret Key",
      category: "Billing",
      status: stripeSecretKey ? "Ready" : "Blocked",
      detail: stripeSecretKey
        ? "Stripe secret key is configured."
        : "Stripe secret key is missing.",
      action: "Add STRIPE_SECRET_KEY to backend environment.",
      route: "/billing",
    }),
    buildCheck({
      key: "stripe-webhook-secret",
      label: "Stripe Webhook Secret",
      category: "Billing",
      status: stripeWebhookSecret ? "Ready" : "Review",
      detail: stripeWebhookSecret
        ? "Stripe webhook secret is configured."
        : "Stripe webhook secret is missing.",
      action: "Add STRIPE_WEBHOOK_SECRET and confirm /api/billing/webhook is mounted.",
      route: "/billing",
    }),
    buildCheck({
      key: "fec-api-key",
      label: "FEC API Key",
      category: "Live Data",
      status: fecApiKey ? "Ready" : "Review",
      detail: fecApiKey ? "FEC API key is configured." : "FEC API key is missing.",
      action: "Add FEC_API_KEY for live fundraising and candidate ingestion.",
      route: "/live-intelligence-layer",
    }),
    buildCheck({
      key: "candidate-records",
      label: "Candidate Records",
      category: "Live Data",
      status: statusFromCount(candidates[0]?.count, 100),
      detail: `${number(candidates[0]?.count)} candidate records found.`,
      action: "Confirm candidate ingestion has enough launch-ready records.",
      route: "/candidates",
    }),
    buildCheck({
      key: "fec-candidate-feed",
      label: "FEC Candidate Feed",
      category: "Live Data",
      status: statusFromCount(fecCandidates[0]?.count, 5),
      detail: `${number(fecCandidates[0]?.count)} FEC candidate records found.`,
      action: "Run FEC sync and verify 2026 cycle data.",
      route: "/fundraising",
    }),
    buildCheck({
      key: "firm-users",
      label: "Firm Users",
      category: "Access",
      status: statusFromCount(users[0]?.count, 1),
      detail: `${number(users[0]?.count)} user records found.`,
      action: "Confirm admin users, roles, and invites are configured.",
      route: "/admin/firm-users",
    }),
    buildCheck({
      key: "executive-workspaces",
      label: "Executive Workspaces",
      category: "Core Workflow",
      status: statusFromCount(workspaces[0]?.count, 1),
      detail: `${number(workspaces[0]?.count)} workspace records found.`,
      action: "Create at least one launch workspace.",
      route: "/executive-workspace",
    }),
    buildCheck({
      key: "execution-tasks",
      label: "Execution Tasks",
      category: "Core Workflow",
      status: statusFromCount(tasks[0]?.count, 5),
      detail: `${number(tasks[0]?.count)} task records found.`,
      action: "Confirm task creation, updates, and completion workflows.",
      route: "/command-center",
    }),
    buildCheck({
      key: "political-signals",
      label: "Political Signals",
      category: "Live Intelligence",
      status: statusFromCount(politicalSignals[0]?.count, 25),
      detail: `${number(politicalSignals[0]?.count)} political signals found.`,
      action: "Confirm live signal ingestion or seed launch signals.",
      route: "/political-signals",
    }),
    buildCheck({
      key: "vendor-network",
      label: "Vendor Network",
      category: "Operations",
      status: statusFromCount(vendors[0]?.count, 1),
      detail: `${number(vendors[0]?.count)} vendor records found.`,
      action: "Confirm vendor coverage by state and category.",
      route: "/vendors",
    }),
    buildCheck({
      key: "campaign-crm",
      label: "Campaign CRM",
      category: "Revenue Workflow",
      status: statusFromCount(crmContacts[0]?.count, 1),
      detail: `${number(crmContacts[0]?.count)} CRM contacts found.`,
      action: "Confirm CRM contact creation from Opportunity Engine.",
      route: "/campaign-crm",
    }),
    buildCheck({
      key: "client-business-records",
      label: "Client / Business Records",
      category: "Revenue Workflow",
      status: statusFromCount(clients[0]?.count, 1),
      detail: `${number(clients[0]?.count)} client records found.`,
      action: "Confirm Consultant Business Suite has launch records.",
      route: "/business-suite",
    }),
    buildCheck({
      key: "intelligence-reports",
      label: "Intelligence Reports",
      category: "Deliverables",
      status: statusFromCount(reports[0]?.count, 1),
      detail: `${number(reports[0]?.count)} intelligence reports found.`,
      action: "Generate at least one launch-ready report.",
      route: "/intelligence-reports",
    }),
    buildCheck({
      key: "notification-events",
      label: "Notification Events",
      category: "Alerts",
      status: statusFromCount(notifications[0]?.count, 1),
      detail: `${number(notifications[0]?.count)} notification events found.`,
      action: "Confirm alert triggers and notification inbox.",
      route: "/notifications",
    }),
  ];

  const ready = checks.filter((check) => check.status === "Ready").length;
  const blocked = checks.filter((check) => check.status === "Blocked").length;
  const review = checks.filter((check) => check.status === "Review").length;

  const readinessScore = Math.round((ready / Math.max(1, checks.length)) * 100);

  return {
    summary: {
      readiness_score: readinessScore,
      score: readinessScore,
      status:
        blocked > 0
          ? "Blocked"
          : readinessScore >= 85
          ? "Launch Ready"
          : "Needs Review",
      ready,
      review,
      blocked,
      blockers: blocked,
      checks: checks.length,
      database_latency_ms: Date.now() - dbStarted,
    },
    checks,
    categories: checks.reduce((acc, check) => {
      if (!acc[check.category]) acc[check.category] = [];
      acc[check.category].push(check);
      return acc;
    }, {}),
    updated_at: new Date().toISOString(),
  };
}