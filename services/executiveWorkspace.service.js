import { pool } from "../db/pool.js";

import { getExecutiveMaterialAlerts } from "./materialAlerts.service.js";

 

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

 

function normalize(value = "") {

  return String(value ?? "").trim().toLowerCase();

}

 

function sameId(left, right) {

  if (left === null || left === undefined || right === null || right === undefined) {

    return false;

  }

  return String(left) === String(right);

}

 

function riskTone(value = "") {

  const v = normalize(value);

  if (["critical", "high", "blocked", "overdue", "at risk"].some((x) => v.includes(x))) {

    return "critical";

  }

  if (["medium", "elevated", "watch", "open", "pending"].some((x) => v.includes(x))) {

    return "watch";

  }

  return "stable";

}

 

function isOpenStatus(status = "") {

  return !["done", "complete", "completed", "resolved", "closed", "archived"].includes(

    normalize(status)

  );

}

 

function isUrgentPriority(priority = "") {

  const value = normalize(priority);

  return ["critical", "urgent", "high", "immediate", "severe"].some((token) =>

    value.includes(token)

  );

}

 

function serializeWorkspace(row = {}) {

  if (!row?.id) return null;

  return {

    id: row.id,

    firm_id: row.firm_id ?? null,

    name: row.name || `Workspace ${row.id}`,

    slug: row.slug || null,

    candidate_name: row.candidate_name || null,

    state: row.state || "National",

    office: row.office || "Campaign",

    cycle: row.cycle || "2026",

    status: row.status || "active",

    description: row.description || null,

    metadata: row.metadata || {},

    created_at: row.created_at || null,

    updated_at: row.updated_at || null,

  };

}

 

function isDefaultWorkspace(workspace = {}) {

  return workspace?.metadata?.default === true;

}

 

function isNationalState(value = "") {

  const state = normalize(value);

  return !state || state === "national" || state === "us" || state === "usa";

}

 

function stateMatches(rowState = "", workspaceState = "") {

  const rowValue = normalize(rowState);

  const workspaceValue = normalize(workspaceState);

  if (isNationalState(workspaceValue)) {

    return !rowValue || isNationalState(rowValue);

  }

  return rowValue === workspaceValue;

}

 

function scopeAssignedRows(

  rows = [],

  selectedWorkspace = null,

  { includeDefaultUnassigned = false } = {}

) {

  if (!selectedWorkspace?.id) return rows;

  const selectedId = selectedWorkspace.id;

  const includeUnassigned = includeDefaultUnassigned && isDefaultWorkspace(selectedWorkspace);

 

  return rows.filter((row) => {

    if (sameId(row.workspace_id, selectedId)) return true;

    if (includeUnassigned && (row.workspace_id === null || row.workspace_id === undefined)) {

      return true;

    }

    return false;

  });

}

 

function scopeWorkspaceContextRows(rows = [], selectedWorkspace = null) {

  if (!selectedWorkspace?.id) return rows;

  const selectedId = selectedWorkspace.id;

  const selectedState = selectedWorkspace.state || "";

 

  return rows.filter((row) => {

    if (sameId(row.workspace_id, selectedId)) return true;

    const unassigned = row.workspace_id === null || row.workspace_id === undefined;

    if (!unassigned) return false;

    return stateMatches(row.state, selectedState);

  });

}

 

function scopeStateContextRows(rows = [], selectedWorkspace = null) {

  if (!selectedWorkspace?.id) return rows;

  return rows.filter((row) => stateMatches(row.state, selectedWorkspace.state));

}

 

function vendorGapStatus(vendor = {}) {

  const value = [

    vendor.status,

    vendor.notes,

    vendor.coverage_area,

    vendor.services,

    vendor.capabilities,

  ]

    .filter(Boolean)

    .join(" ")

    .toLowerCase();

 

  return [

    "critical",

    "at risk",

    "blocked",

    "coverage gap",

    "capacity gap",

    "thin coverage",

    "unavailable",

  ].some((token) => value.includes(token));

}

 

function workspaceScopeDescription(selectedWorkspace = null) {

  if (!selectedWorkspace?.id) return "firm";

  if (isDefaultWorkspace(selectedWorkspace)) return "workspace-plus-default-unassigned";

  return "workspace";

}

 

export async function getExecutiveWorkspaces({ user = {} }) {

  const firmId = getFirmId(user);

 

  const workspaces = firmId

    ? await safeQuery(

        `

          SELECT

            id,

            firm_id,

            name,

            slug,

            candidate_name,

            state,

            office,

            cycle,

            status,

            description,

            metadata,

            created_at,

            updated_at

          FROM workspaces

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 100

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          id,

          firm_id,

          name,

          slug,

          candidate_name,

          state,

          office,

          cycle,

          status,

          description,

          metadata,

          created_at,

          updated_at

        FROM workspaces

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 100

      `);

 

  return {

    workspaces: workspaces.map(serializeWorkspace).filter(Boolean),

  };

}

 

export async function getExecutiveWorkspaceDashboard({

  user = {},

  workspaceId = null,

}) {

  const firmId = getFirmId(user);

 

  const workspaces = firmId

    ? await safeQuery(

        `

          SELECT

            id,

            firm_id,

            name,

            slug,

            candidate_name,

            state,

            office,

            cycle,

            status,

            description,

            metadata,

            created_at,

            updated_at

          FROM workspaces

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 100

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          id,

          firm_id,

          name,

          slug,

          candidate_name,

          state,

          office,

          cycle,

          status,

          description,

          metadata,

          created_at,

          updated_at

        FROM workspaces

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 100

      `);

 

  const selectedWorkspace =

    workspaces.find((workspace) => sameId(workspace.id, workspaceId)) ||

    workspaces[0] ||

    null;

 

  const selectedId = selectedWorkspace?.id || null;

  const state = selectedWorkspace?.state || "";

 

  // Load the firm's authoritative source rows once. The response below returns

  // selected-workspace data, while portfolio_summary preserves firm-wide totals.

  const firmTasks = firmId

    ? await safeQuery(

        `

          SELECT id, title, description, status, priority, state, source,

                 workspace_id, created_at, updated_at

          FROM tasks

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 200

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT id, title, description, status, priority, state, source,

               workspace_id, created_at, updated_at

        FROM tasks

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 200

      `);

 

  const firmSignals = await safeQuery(`

    SELECT id, title, summary, state, signal_type, risk, severity,

           signal_score, workspace_id, created_at

    FROM political_signals

    ORDER BY signal_score DESC NULLS LAST, created_at DESC NULLS LAST

    LIMIT 200

  `);

 

  const firmContacts = firmId

    ? await safeQuery(

        `

          SELECT id, full_name, organization, role_type, state, workspace_id,

                 created_at, updated_at

          FROM campaign_crm_contacts

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 200

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT id, full_name, organization, role_type, state, workspace_id,

               created_at, updated_at

        FROM campaign_crm_contacts

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 200

      `);

 

  const firmActivities = firmId

    ? await safeQuery(

        `

          SELECT id, title, type, status, priority, due_date, workspace_id, created_at

          FROM campaign_crm_activities

          WHERE firm_id = $1

          ORDER BY created_at DESC

          LIMIT 200

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT id, title, type, status, priority, due_date, workspace_id, created_at

        FROM campaign_crm_activities

        ORDER BY created_at DESC

        LIMIT 200

      `);

 

  const firmReports = firmId

    ? await safeQuery(

        `

          SELECT id, title, report_type, state, status, workspace_id, created_at

          FROM intelligence_reports

          WHERE firm_id = $1

          ORDER BY created_at DESC

          LIMIT 200

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT id, title, report_type, state, status, workspace_id, created_at

        FROM intelligence_reports

        ORDER BY created_at DESC

        LIMIT 200

      `);

 

  // These production tables do not currently expose workspace_id, so they are

  // used only as geographic context for the selected workspace.

  const firmVendors = await safeQuery(`

    SELECT id, name, vendor_name, category, status, state, city, services,

           notes, capabilities, coverage_area, created_at, updated_at

    FROM vendors

    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

    LIMIT 200

  `);

 

  const firmClients = firmId

    ? await safeQuery(

        `

          SELECT id, client_name, organization, state, status, health_status,

                 monthly_retainer, created_at, updated_at

          FROM consultant_clients

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 200

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT id, client_name, organization, state, status, health_status,

               monthly_retainer, created_at, updated_at

        FROM consultant_clients

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 200

      `);

 

  const firmInvoices = firmId

    ? await safeQuery(

        `

          SELECT i.id, i.title, i.amount, i.status, i.due_date, i.created_at,

                 c.client_name, c.state

          FROM consultant_invoices i

          LEFT JOIN consultant_clients c ON c.id = i.client_id

          WHERE i.firm_id = $1

          ORDER BY i.created_at DESC

          LIMIT 200

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT i.id, i.title, i.amount, i.status, i.due_date, i.created_at,

               c.client_name, c.state

        FROM consultant_invoices i

        LEFT JOIN consultant_clients c ON c.id = i.client_id

        ORDER BY i.created_at DESC

        LIMIT 200

      `);

 

  const tasks = scopeAssignedRows(firmTasks, selectedWorkspace, {

    includeDefaultUnassigned: true,

  });

  const signals = scopeWorkspaceContextRows(firmSignals, selectedWorkspace);

  const contacts = scopeAssignedRows(firmContacts, selectedWorkspace, {

    includeDefaultUnassigned: true,

  });

  const activities = scopeAssignedRows(firmActivities, selectedWorkspace, {

    includeDefaultUnassigned: true,

  });

  const reports = scopeWorkspaceContextRows(firmReports, selectedWorkspace);

  const vendors = scopeStateContextRows(firmVendors, selectedWorkspace);

  const clients = scopeStateContextRows(firmClients, selectedWorkspace);

  const invoices = scopeStateContextRows(firmInvoices, selectedWorkspace);

 

  const materialAlerts = await getExecutiveMaterialAlerts({

    signals,

    cycle: selectedWorkspace?.cycle || process.env.FEC_DEFAULT_CYCLE || 2026,

    state,

    limit: 4,

  });

 

  const openTasks = tasks.filter((task) => isOpenStatus(task.status));

  const urgentTasks = openTasks.filter((task) => isUrgentPriority(task.priority));

  const criticalSignals = signals.filter(

    (signal) =>

      riskTone(signal.risk || signal.severity || signal.signal_score) === "critical"

  );

  const openActivities = activities.filter((activity) => isOpenStatus(activity.status));

  const vendorGaps = vendors.filter(vendorGapStatus);

  const atRiskClients = clients.filter((client) =>

    ["at risk", "watch", "critical"].includes(normalize(client.health_status))

  );

  const openReceivables = invoices

    .filter((invoice) => ["open", "sent", "overdue"].includes(normalize(invoice.status)))

    .reduce((sum, invoice) => sum + number(invoice.amount), 0);

 

  const pressureScore = Math.min(

    100,

    Math.round(

      criticalSignals.length * 12 +

        urgentTasks.length * 8 +

        Math.max(0, openTasks.length - urgentTasks.length) * 2 +

        openActivities.length * 2 +

        vendorGaps.length * 4 +

        atRiskClients.length * 5 +

        (openReceivables > 0 ? 8 : 0)

    )

  );

 

  const workspaceActivityCount =

    tasks.length + contacts.length + activities.length + reports.length + signals.length;

 

  const workspaceReadinessScore = Math.min(

    100,

    Math.round(

      (selectedWorkspace ? 25 : 0) +

        (tasks.length > 0 ? 20 : 0) +

        (contacts.length > 0 ? 15 : 0) +

        (activities.length > 0 ? 15 : 0) +

        (reports.length > 0 ? 10 : 0) +

        (signals.length > 0 ? 10 : 0) +

        (selectedWorkspace?.candidate_name ? 5 : 0)

    )

  );

 

  const executiveActions = [

    ...criticalSignals.slice(0, 3).map((signal) => ({

      id: `signal-${signal.id}`,

      title: signal.title || "Critical signal",

      source: "Political Signal",

      priority: "Critical",

      path: "/political-signals",

      detail: signal.summary || "Review signal pressure and response options.",

      workspace_id: signal.workspace_id || selectedId,

      state: signal.state || state || null,

      scope: "workspace-context",

    })),

    ...openTasks.slice(0, 6).map((task) => ({

      id: `task-${task.id}`,

      title: task.title || "Open task",

      source: task.source || "Mission Task",

      priority: task.priority || "Open",

      path: "/command-center",

      detail: task.description || "Task requires ownership or completion.",

      workspace_id: task.workspace_id || selectedId,

      state: task.state || state || null,

      scope: sameId(task.workspace_id, selectedId)

        ? "workspace-assigned"

        : "default-unassigned",

    })),

    ...vendorGaps.slice(0, 1).map((vendor) => ({

      id: `vendor-${vendor.id}`,

      title: `Vendor coverage watch: ${

        vendor.name || vendor.vendor_name || `Vendor ${vendor.id}`

      }`,

      source: "Vendor Network",

      priority: vendor.status || "Watch",

      path: "/vendors",

      detail: `${vendor.category || "Vendor"} - ${vendor.state || "National"}`,

      workspace_id: selectedId,

      state: vendor.state || state || null,

      scope: "workspace-geography",

    })),

    ...atRiskClients.slice(0, 1).map((client) => ({

      id: `client-${client.id}`,

      title: `Client health watch: ${client.client_name}`,

      source: "Client / Revenue",

      priority: client.health_status || "Watch",

      path: "/revenue-intelligence",

      detail: client.organization || "Review client health and deliverables.",

      workspace_id: selectedId,

      state: client.state || state || null,

      scope: "workspace-geography",

    })),

  ].slice(0, 10);

 

  const firmOpenTasks = firmTasks.filter((task) => isOpenStatus(task.status));

  const firmUrgentTasks = firmOpenTasks.filter((task) => isUrgentPriority(task.priority));

  const firmOpenActivities = firmActivities.filter((activity) => isOpenStatus(activity.status));

  const firmCriticalSignals = firmSignals.filter(

    (signal) =>

      riskTone(signal.risk || signal.severity || signal.signal_score) === "critical"

  );

 

  return {

    selected_workspace: serializeWorkspace(selectedWorkspace),

    workspaces: workspaces.map(serializeWorkspace).filter(Boolean),

    scope: {

      mode: workspaceScopeDescription(selectedWorkspace),

      workspace_id: selectedId,

      firm_id: firmId || selectedWorkspace?.firm_id || null,

      state: selectedWorkspace?.state || null,

      cycle: selectedWorkspace?.cycle || null,

      default_workspace: isDefaultWorkspace(selectedWorkspace),

      direct_assignment_fields: [

        "tasks.workspace_id",

        "political_signals.workspace_id",

        "campaign_crm_contacts.workspace_id",

        "campaign_crm_activities.workspace_id",

        "intelligence_reports.workspace_id",

      ],

      geographic_context_fields: [

        "vendors.state",

        "consultant_clients.state",

        "consultant_invoices.client_state",

      ],

    },

    summary: {

      pressure_score: pressureScore,

      workspace_readiness_score: workspaceReadinessScore,

      workspace_activity_count: workspaceActivityCount,

      pressure_status:

        pressureScore >= 70 ? "Critical" : pressureScore >= 40 ? "Watch" : "Stable",

      open_tasks: openTasks.length,

      urgent_tasks: urgentTasks.length,

      critical_signals: criticalSignals.length,

      material_alerts: materialAlerts.alerts?.length || 0,

      crm_contacts: contacts.length,

      open_activities: openActivities.length,

      reports: reports.length,

      vendors: vendors.length,

      vendor_gaps: vendorGaps.length,

      clients: clients.length,

      at_risk_clients: atRiskClients.length,

      open_receivables: Math.round(openReceivables),

    },

    portfolio_summary: {

      open_tasks: firmOpenTasks.length,

      urgent_tasks: firmUrgentTasks.length,

      critical_signals: firmCriticalSignals.length,

      crm_contacts: firmContacts.length,

      open_activities: firmOpenActivities.length,

      reports: firmReports.length,

      vendors: firmVendors.length,

      clients: firmClients.length,

      workspaces: workspaces.length,

    },

    executive_actions: executiveActions,

    material_alerts: materialAlerts.alerts || [],

    material_alerts_summary: {

      ...(materialAlerts.summary || {}),

      scope: "workspace-context",

      workspace_id: selectedId,

      state: selectedWorkspace?.state || null,

      cycle: selectedWorkspace?.cycle || null,

    },

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
