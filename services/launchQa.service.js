import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return { ok: true, rows: result.rows || [], error: "" };
  } catch (error) {
    console.warn("[launch-qa] skipped query:", error.message);
    return { ok: false, rows: [], error: error.message };
  }
}

function number(value = 0) {
  return Number(value || 0);
}

function status({ pass, review = false }) {
  if (pass) return "pass";
  if (review) return "review";
  return "fail";
}

function testItem({ key, area, label, status, detail, route = "", action = "" }) {
  return { key, area, label, status, detail, route, action };
}

export async function getLaunchQa({ user = {} }) {
  const firmId = getFirmId(user);

  const db = await safeQuery("SELECT NOW() AS now");

  const candidates = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM candidates
  `);

  const fecCandidates = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM fec_candidates
  `);

  const workspaces = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count
          FROM workspaces
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM workspaces
      `);

  const tasks = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count
          FROM tasks
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM tasks
      `);

  const crm = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count
          FROM campaign_crm_contacts
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM campaign_crm_contacts
      `);

  const clients = firmId
    ? await safeQuery(
        `
          SELECT COUNT(*)::int AS count
          FROM consultant_clients
          WHERE firm_id = $1
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM consultant_clients
      `);

  // Global launch checks. These tables currently contain launch-wide records
  // and should not be filtered by firm_id.
  const signals = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM political_signals
  `);

  const vendors = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM vendors
  `);

  const reports = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM intelligence_reports
  `);

  const alerts = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM notification_events
  `);

  const firmUsers = await safeQuery(`
    SELECT COUNT(*)::int AS count
    FROM users
  `);

  const checks = [
    testItem({
      key: "backend_boot",
      area: "Backend",
      label: "Backend API Running",
      status: status({ pass: true }),
      detail: "Launch QA endpoint is responding.",
      route: "/launch-qa",
      action: "No action required.",
    }),
    testItem({
      key: "database_connection",
      area: "Backend",
      label: "Database Connection",
      status: status({ pass: db.ok && Boolean(db.rows[0]?.now) }),
      detail: db.ok ? "Database responded successfully." : db.error,
      action: "Confirm DATABASE_URL and database network access.",
    }),
    testItem({
      key: "auth_context",
      area: "Auth",
      label: "Authenticated Context",
      status: status({ pass: Boolean(firmId), review: true }),
      detail: firmId ? `Firm context detected: ${firmId}` : "No firm context detected.",
      action: "Verify login token includes firm_id / firmId.",
    }),
    testItem({
      key: "firm_users",
      area: "Auth",
      label: "Firm Users",
      status: status({
        pass: number(firmUsers.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(firmUsers.rows?.[0]?.count)} user records found.`,
      route: "/admin/firm-users",
      action: "Confirm admin user and role access.",
    }),
    testItem({
      key: "stripe_env",
      area: "Billing",
      label: "Stripe Environment",
      status: status({
        pass: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
        review: Boolean(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET),
      }),
      detail: `Secret key: ${
        process.env.STRIPE_SECRET_KEY ? "configured" : "missing"
      }; webhook: ${
        process.env.STRIPE_WEBHOOK_SECRET ? "configured" : "missing"
      }.`,
      route: "/billing",
      action: "Confirm Stripe checkout, portal, and webhook in production.",
    }),
    testItem({
      key: "candidates",
      area: "Live Data",
      label: "Candidate Records",
      status: status({
        pass: number(candidates.rows?.[0]?.count) >= 100,
        review: number(candidates.rows?.[0]?.count) > 0,
      }),
      detail: `${number(candidates.rows?.[0]?.count)} candidate records found.`,
      route: "/candidates",
      action: "Run candidate/FEC sync if count is low.",
    }),
    testItem({
      key: "fec_candidates",
      area: "Live Data",
      label: "FEC Candidate Records",
      status: status({
        pass: number(fecCandidates.rows?.[0]?.count) >= 5,
        review: number(fecCandidates.rows?.[0]?.count) > 0,
      }),
      detail: `${number(fecCandidates.rows?.[0]?.count)} FEC records found.`,
      route: "/fundraising",
      action: "Confirm FEC ingestion is current.",
    }),
    testItem({
      key: "executive_workspace",
      area: "Core Workflow",
      label: "Executive Workspace",
      status: status({
        pass: number(workspaces.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(workspaces.rows?.[0]?.count)} workspaces found.`,
      route: "/executive-workspace",
      action: "Create at least one workspace before launch.",
    }),
    testItem({
      key: "tasks",
      area: "Core Workflow",
      label: "Execution Tasks",
      status: status({
        pass: number(tasks.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(tasks.rows?.[0]?.count)} tasks found.`,
      route: "/command-center",
      action: "Smoke test create/update/complete task flow.",
    }),
    testItem({
      key: "signals",
      area: "Intelligence",
      label: "Political Signals",
      status: status({
        pass: number(signals.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(signals.rows?.[0]?.count)} signals found.`,
      route: "/political-signals",
      action: "Confirm signal feed appears in Workspace and National Command.",
    }),
    testItem({
      key: "vendors",
      area: "Operations",
      label: "Vendor Network",
      status: status({
        pass: number(vendors.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(vendors.rows?.[0]?.count)} vendors found.`,
      route: "/vendors",
      action: "Confirm vendor filtering and state coverage.",
    }),
    testItem({
      key: "crm",
      area: "Revenue Workflow",
      label: "Campaign CRM",
      status: status({
        pass: number(crm.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(crm.rows?.[0]?.count)} CRM contacts found.`,
      route: "/campaign-crm",
      action: "Smoke test Opportunity Engine to CRM creation.",
    }),
    testItem({
      key: "clients",
      area: "Revenue Workflow",
      label: "Business Suite Clients",
      status: status({
        pass: number(clients.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(clients.rows?.[0]?.count)} client records found.`,
      route: "/business-suite",
      action: "Confirm client, invoice, and revenue workflows.",
    }),
    testItem({
      key: "reports",
      area: "Deliverables",
      label: "Reports",
      status: status({
        pass: number(reports.rows?.[0]?.count) > 0,
        review: true,
      }),
      detail: `${number(reports.rows?.[0]?.count)} reports found.`,
      route: "/intelligence-reports",
      action: "Generate one report and test export center.",
    }),
    testItem({
      key: "alerts",
      area: "Alerts",
      label: "Notifications",
      status: status({
        pass: true,
        review: number(alerts.rows?.[0]?.count) === 0,
      }),
      detail: `${number(alerts.rows?.[0]?.count)} notification events found.`,
      route: "/notifications",
      action: "Confirm Notification Center loads and filters.",
    }),
  ];

  const pass = checks.filter((item) => item.status === "pass").length;
  const review = checks.filter((item) => item.status === "review").length;
  const fail = checks.filter((item) => item.status === "fail").length;
  const score = Math.round((pass / Math.max(1, checks.length)) * 100);

  return {
    summary: {
      score,
      status: fail > 0 ? "Failing" : score >= 85 ? "Launch Ready" : "Needs Review",
      total: checks.length,
      pass,
      review,
      fail,
    },
    checks,
    failures: checks.filter((item) => item.status === "fail"),
    review_items: checks.filter((item) => item.status === "review"),
    updated_at: new Date().toISOString(),
  };
}