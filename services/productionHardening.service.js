import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
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

function number(value = 0) {
  return Number(value || 0);
}

function statusFrom(condition, warningCondition = false) {
  if (condition) return "ready";
  if (warningCondition) return "review";
  return "blocked";
}

function checkItem({ key, label, category, status, detail, action, route = "" }) {
  return { key, label, category, status, detail, action, route };
}

export async function getProductionHardening({ user = {} }) {
  const firmId = getFirmId(user);

  const dbCheck = await safeQuery("SELECT NOW() AS now");
  const candidates = await safeQuery("SELECT COUNT(*)::int AS count FROM candidates");
  const fecCandidates = await safeQuery("SELECT COUNT(*)::int AS count FROM fec_candidates");

  const firmUsers = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM firm_users WHERE firm_id = $1", [firmId])
    : [];

  const workspaces = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM workspaces WHERE firm_id = $1", [firmId])
    : [];

  const tasks = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM tasks WHERE firm_id = $1", [firmId])
    : [];

  const signals = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM political_signals WHERE firm_id = $1", [firmId])
    : [];

  const vendors = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM vendors WHERE firm_id = $1", [firmId])
    : [];

  const reports = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM intelligence_reports WHERE firm_id = $1", [firmId])
    : [];

  const alerts = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM notification_events WHERE firm_id = $1", [firmId])
    : [];

  const clients = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM consultant_clients WHERE firm_id = $1", [firmId])
    : [];

  const crm = firmId
    ? await safeQuery("SELECT COUNT(*)::int AS count FROM campaign_crm_contacts WHERE firm_id = $1", [firmId])
    : [];

  const env = {
    node_env: process.env.NODE_ENV || "development",
    cors_origin: process.env.CORS_ORIGIN || "",
    jwt_secret: Boolean(process.env.JWT_SECRET),
    database_url: Boolean(process.env.DATABASE_URL),
    stripe_secret_key: Boolean(process.env.STRIPE_SECRET_KEY),
    stripe_webhook_secret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    fec_api_key: Boolean(process.env.FEC_API_KEY),
  };

  const checks = [
    checkItem({
      key: "database",
      label: "Database Connection",
      category: "Infrastructure",
      status: statusFrom(Boolean(dbCheck[0]?.now)),
      detail: dbCheck[0]?.now ? "Database connection is responding." : "Database connection failed.",
      action: "Confirm Render PostgreSQL is connected and migrations are applied.",
    }),
    checkItem({
      key: "env_database",
      label: "DATABASE_URL",
      category: "Environment",
      status: statusFrom(env.database_url),
      detail: env.database_url ? "DATABASE_URL is configured." : "DATABASE_URL is missing.",
      action: "Add DATABASE_URL to Render environment variables.",
    }),
    checkItem({
      key: "env_jwt",
      label: "JWT Secret",
      category: "Security",
      status: statusFrom(env.jwt_secret),
      detail: env.jwt_secret ? "JWT_SECRET is configured." : "JWT_SECRET is missing.",
      action: "Add a strong JWT_SECRET before launch.",
    }),
    checkItem({
      key: "cors",
      label: "CORS Origin",
      category: "Security",
      status: statusFrom(Boolean(env.cors_origin), env.node_env !== "production"),
      detail: env.cors_origin ? `CORS_ORIGIN configured: ${env.cors_origin}` : "CORS_ORIGIN is not explicitly configured.",
      action: "Confirm only voterspheres.org and www.voterspheres.org are allowed in production.",
    }),
    checkItem({
      key: "stripe_secret",
      label: "Stripe Secret Key",
      category: "Billing",
      status: statusFrom(env.stripe_secret_key),
      detail: env.stripe_secret_key ? "Stripe secret key is configured." : "Stripe secret key is missing.",
      action: "Add STRIPE_SECRET_KEY to backend environment.",
      route: "/billing",
    }),
    checkItem({
      key: "stripe_webhook",
      label: "Stripe Webhook Secret",
      category: "Billing",
      status: statusFrom(env.stripe_webhook_secret),
      detail: env.stripe_webhook_secret ? "Stripe webhook secret is configured." : "Stripe webhook secret is missing.",
      action: "Add STRIPE_WEBHOOK_SECRET and confirm /api/billing/webhook is mounted.",
      route: "/billing",
    }),
    checkItem({
      key: "fec_api",
      label: "FEC API Key",
      category: "Live Data",
      status: statusFrom(env.fec_api_key),
      detail: env.fec_api_key ? "FEC API key is configured." : "FEC API key is missing.",
      action: "Add FEC_API_KEY for live fundraising and candidate ingestion.",
      route: "/live-intelligence-layer",
    }),
    checkItem({
      key: "candidates",
      label: "Candidate Records",
      category: "Live Data",
      status: statusFrom(number(candidates[0]?.count) >= 100, number(candidates[0]?.count) > 0),
      detail: `${number(candidates[0]?.count)} candidate records found.`,
      action: "Confirm candidate ingestion has enough launch-ready records.",
      route: "/candidates",
    }),
    checkItem({
      key: "fec_candidates",
      label: "FEC Candidate Feed",
      category: "Live Data",
      status: statusFrom(number(fecCandidates[0]?.count) >= 100, number(fecCandidates[0]?.count) > 0),
      detail: `${number(fecCandidates[0]?.count)} FEC candidate records found.`,
      action: "Run FEC sync and verify 2026 cycle data.",
      route: "/fundraising",
    }),
    checkItem({
      key: "firm_users",
      label: "Firm Users",
      category: "Access",
      status: statusFrom(number(firmUsers[0]?.count) > 0, !firmId),
      detail: firmId ? `${number(firmUsers[0]?.count)} firm users found.` : "No firm context detected.",
      action: "Confirm admin users, roles, and invites are configured.",
      route: "/admin/firm-users",
    }),
    checkItem({
      key: "workspaces",
      label: "Executive Workspaces",
      category: "Core Workflow",
      status: statusFrom(number(workspaces[0]?.count) > 0),
      detail: `${number(workspaces[0]?.count)} workspace records found.`,
      action: "Create at least one launch workspace.",
      route: "/executive-workspace",
    }),
    checkItem({
      key: "tasks",
      label: "Execution Tasks",
      category: "Core Workflow",
      status: statusFrom(number(tasks[0]?.count) > 0, true),
      detail: `${number(tasks[0]?.count)} task records found.`,
      action: "Confirm task creation, updates, and completion workflows.",
      route: "/command-center",
    }),
    checkItem({
      key: "signals",
      label: "Political Signals",
      category: "Live Intelligence",
      status: statusFrom(number(signals[0]?.count) > 0, true),
      detail: `${number(signals[0]?.count)} political signals found.`,
      action: "Confirm live signal ingestion or seed launch signals.",
      route: "/political-signals",
    }),
    checkItem({
      key: "vendors",
      label: "Vendor Network",
      category: "Operations",
      status: statusFrom(number(vendors[0]?.count) > 0, true),
      detail: `${number(vendors[0]?.count)} vendor records found.`,
      action: "Confirm vendor coverage by state and category.",
      route: "/vendors",
    }),
    checkItem({
      key: "crm",
      label: "Campaign CRM",
      category: "Revenue Workflow",
      status: statusFrom(number(crm[0]?.count) > 0, true),
      detail: `${number(crm[0]?.count)} CRM contacts found.`,
      action: "Confirm CRM contact creation from Opportunity Engine.",
      route: "/campaign-crm",
    }),
    checkItem({
      key: "clients",
      label: "Client / Business Records",
      category: "Revenue Workflow",
      status: statusFrom(number(clients[0]?.count) > 0, true),
      detail: `${number(clients[0]?.count)} client records found.`,
      action: "Confirm Consultant Business Suite has launch records.",
      route: "/business-suite",
    }),
    checkItem({
      key: "reports",
      label: "Intelligence Reports",
      category: "Deliverables",
      status: statusFrom(number(reports[0]?.count) > 0, true),
      detail: `${number(reports[0]?.count)} intelligence reports found.`,
      action: "Generate at least one launch-ready report.",
      route: "/intelligence-reports",
    }),
    checkItem({
      key: "alerts",
      label: "Notification Events",
      category: "Alerts",
      status: statusFrom(number(alerts[0]?.count) > 0, true),
      detail: `${number(alerts[0]?.count)} notification events found.`,
      action: "Confirm alert triggers and notification inbox.",
      route: "/notifications",
    }),
  ];

  const ready = checks.filter((item) => item.status === "ready").length;
  const review = checks.filter((item) => item.status === "review").length;
  const blocked = checks.filter((item) => item.status === "blocked").length;
  const readinessScore = Math.round((ready / Math.max(1, checks.length)) * 100);

  return {
    summary: {
      readiness_score: readinessScore,
      readiness_status:
        blocked > 0 ? "Blocked" : readinessScore >= 85 ? "Launch Ready" : "Needs Review",
      total_checks: checks.length,
      ready,
      review,
      blocked,
      environment: env.node_env,
    },
    checks,
    blockers: checks.filter((item) => item.status === "blocked"),
    review_items: checks.filter((item) => item.status === "review"),
    updated_at: new Date().toISOString(),
  };
}
