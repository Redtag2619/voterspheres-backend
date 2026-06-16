import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[executive-workspace] skipped query:", error.message);
    return [];
  }
}

function number(value = 0) {
  return Number(value || 0);
}

function riskTone(value = "") {
  const v = String(value || "").toLowerCase();
  if (["critical", "high", "blocked", "overdue", "at risk"].some((x) => v.includes(x))) return "critical";
  if (["medium", "elevated", "watch", "open", "pending"].some((x) => v.includes(x))) return "watch";
  return "stable";
}

function isOpenStatus(status = "") {
  return !["done", "complete", "completed", "resolved", "closed"].includes(
    String(status || "").toLowerCase()
  );
}

export async function getExecutiveWorkspaces({ user = {} }) {
  const firmId = getFirmId(user);

  const workspaces = firmId
    ? await safeQuery(
        `
          SELECT id, name, campaign_name, title, state, office, cycle, status, created_at, updated_at
          FROM workspaces
          WHERE firm_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 100
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT id, name, campaign_name, title, state, office, cycle, status, created_at, updated_at
        FROM workspaces
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 100
      `);

  return {
    workspaces: workspaces.map((row) => ({
      id: row.id,
      name: row.name || row.campaign_name || row.title || `Workspace ${row.id}`,
      state: row.state || "National",
      office: row.office || "Campaign",
      cycle: row.cycle || "2026",
      status: row.status || "active",
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

export async function getExecutiveWorkspaceDashboard({ user = {}, workspaceId = null }) {
  const firmId = getFirmId(user);

  const workspaces = firmId
    ? await safeQuery(
        `
          SELECT id, name, campaign_name, title, state, office, cycle, status, created_at, updated_at
          FROM workspaces
          WHERE firm_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 100
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT id, name, campaign_name, title, state, office, cycle, status, created_at, updated_at
        FROM workspaces
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 100
      `);

  const selectedWorkspace =
    workspaces.find((w) => String(w.id) === String(workspaceId)) ||
    workspaces[0] ||
    null;

  const selectedId = selectedWorkspace?.id || null;
  const state = selectedWorkspace?.state || "";

  const tasks = firmId
    ? await safeQuery(
        `
          SELECT id, title, description, status, priority, state, source, workspace_id, created_at, updated_at
          FROM tasks
          WHERE firm_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 80
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT id, title, description, status, priority, state, source, workspace_id, created_at, updated_at
        FROM tasks
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 80
      `);

  const signals = await safeQuery(`
    SELECT id, title, summary, state, signal_type, risk, severity, signal_score, workspace_id, created_at
    FROM political_signals
    ORDER BY signal_score DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 80
  `);

  const contacts = firmId
    ? await safeQuery(
        `
          SELECT id, full_name, organization, role_type, state, workspace_id, created_at, updated_at
          FROM campaign_crm_contacts
          WHERE firm_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 80
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT id, full_name, organization, role_type, state, workspace_id, created_at, updated_at
        FROM campaign_crm_contacts
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 80
      `);

  const activities = firmId
    ? await safeQuery(
        `
          SELECT id, title, type, status, priority, due_date, workspace_id, created_at
          FROM campaign_crm_activities
          WHERE firm_id = $1
          ORDER BY created_at DESC
          LIMIT 80
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT id, title, type, status, priority, due_date, workspace_id, created_at
        FROM campaign_crm_activities
        ORDER BY created_at DESC
        LIMIT 80
      `);

  const reports = await safeQuery(`
    SELECT id, title, report_type, state, status, created_at
    FROM intelligence_reports
    ORDER BY created_at DESC
    LIMIT 80
  `);

  const vendors = await safeQuery(`
    SELECT id, name, vendor_name, category, state, status, risk, coverage_tier, created_at, updated_at
    FROM vendors
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 80
  `);

  const clients = firmId
    ? await safeQuery(
        `
          SELECT id, client_name, organization, state, status, health_status, monthly_retainer, created_at, updated_at
          FROM consultant_clients
          WHERE firm_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 80
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT id, client_name, organization, state, status, health_status, monthly_retainer, created_at, updated_at
        FROM consultant_clients
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 80
      `);

  const invoices = firmId
    ? await safeQuery(
        `
          SELECT i.id, i.title, i.amount, i.status, i.due_date, i.created_at, c.client_name, c.state
          FROM consultant_invoices i
          LEFT JOIN consultant_clients c ON c.id = i.client_id
          WHERE i.firm_id = $1
          ORDER BY i.created_at DESC
          LIMIT 80
        `,
        [firmId]
      )
    : await safeQuery(`
        SELECT i.id, i.title, i.amount, i.status, i.due_date, i.created_at, c.client_name, c.state
        FROM consultant_invoices i
        LEFT JOIN consultant_clients c ON c.id = i.client_id
        ORDER BY i.created_at DESC
        LIMIT 80
      `);

  const openTasks = tasks.filter((t) => isOpenStatus(t.status));
  const criticalSignals = signals.filter((s) =>
    riskTone(s.risk || s.severity || s.signal_score) === "critical"
  );
  const openActivities = activities.filter((a) => isOpenStatus(a.status));
  const vendorGaps = vendors.filter((v) =>
    ["high", "thin", "at risk", "critical"].includes(
      String(v.risk || v.coverage_tier || "").toLowerCase()
    )
  );
  const atRiskClients = clients.filter((c) =>
    ["at risk", "watch", "critical"].includes(String(c.health_status || "").toLowerCase())
  );

  const openReceivables = invoices
    .filter((i) => ["open", "sent", "overdue"].includes(String(i.status || "").toLowerCase()))
    .reduce((sum, i) => sum + number(i.amount), 0);

  const pressureScore = Math.min(
    100,
    Math.round(
      criticalSignals.length * 12 +
        openTasks.length * 2 +
        openActivities.length * 1 +
        vendorGaps.length * 4 +
        atRiskClients.length * 5 +
        (openReceivables > 0 ? 8 : 0)
    )
  );

  const workspaceActivityCount =
    tasks.length +
    contacts.length +
    activities.length +
    reports.length +
    vendors.length +
    clients.length +
    invoices.length;

  const workspaceReadinessScore = Math.min(
    100,
    Math.round(
      (workspaces.length > 0 ? 15 : 0) +
        (selectedWorkspace ? 10 : 0) +
        (tasks.length >= 10 ? 15 : tasks.length * 1.5) +
        (contacts.length >= 10 ? 15 : contacts.length * 1.5) +
        (reports.length >= 1 ? 15 : 0) +
        (clients.length >= 5 ? 15 : clients.length * 3) +
        (vendors.length >= 2 ? 10 : vendors.length * 5) +
        (workspaceActivityCount >= 30 ? 15 : workspaceActivityCount * 0.5)
    )
  );

  const executiveActions = [
    ...criticalSignals.slice(0, 3).map((s) => ({
      id: `signal-${s.id}`,
      title: s.title || "Critical signal",
      source: "Political Signal",
      priority: "Critical",
      path: "/political-intelligence",
      detail: s.summary || "Review signal pressure and response options.",
    })),
    ...openTasks.slice(0, 4).map((t) => ({
      id: `task-${t.id}`,
      title: t.title || "Open task",
      source: "Mission Task",
      priority: t.priority || "Open",
      path: "/command-center",
      detail: t.description || "Task requires ownership or completion.",
    })),
    ...vendorGaps.slice(0, 2).map((v) => ({
      id: `vendor-${v.id}`,
      title: `Vendor coverage watch: ${v.name || v.vendor_name}`,
      source: "Vendor Network",
      priority: v.risk || v.coverage_tier || "Watch",
      path: "/vendors",
      detail: `${v.category || "Vendor"} • ${v.state || "National"}`,
    })),
    ...atRiskClients.slice(0, 2).map((c) => ({
      id: `client-${c.id}`,
      title: `Client health watch: ${c.client_name}`,
      source: "Client / Revenue",
      priority: c.health_status || "Watch",
      path: "/revenue-intelligence",
      detail: c.organization || "Review client health and deliverables.",
    })),
  ].slice(0, 10);

  return {
    selected_workspace: selectedWorkspace
      ? {
          id: selectedWorkspace.id,
          name:
            selectedWorkspace.name ||
            selectedWorkspace.campaign_name ||
            selectedWorkspace.title ||
            `Workspace ${selectedWorkspace.id}`,
          state: selectedWorkspace.state || "National",
          office: selectedWorkspace.office || "Campaign",
          cycle: selectedWorkspace.cycle || "2026",
          status: selectedWorkspace.status || "active",
        }
      : null,
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name || w.campaign_name || w.title || `Workspace ${w.id}`,
      state: w.state || "National",
      office: w.office || "Campaign",
      cycle: w.cycle || "2026",
      status: w.status || "active",
    })),
    summary: {
      pressure_score: pressureScore,
      workspace_readiness_score: workspaceReadinessScore,
      workspace_activity_count: workspaceActivityCount,
      pressure_status:
        pressureScore >= 70 ? "Critical" : pressureScore >= 40 ? "Watch" : "Stable",
      open_tasks: openTasks.length,
      critical_signals: criticalSignals.length,
      crm_contacts: contacts.length,
      open_activities: openActivities.length,
      reports: reports.length,
      vendors: vendors.length,
      vendor_gaps: vendorGaps.length,
      clients: clients.length,
      at_risk_clients: atRiskClients.length,
      open_receivables: Math.round(openReceivables),
    },
    executive_actions: executiveActions,
    signals,
    tasks,
    contacts,
    activities,
    reports,
    vendors,
    clients,
    invoices,
    updated_at: new Date().toISOString(),
  };
}