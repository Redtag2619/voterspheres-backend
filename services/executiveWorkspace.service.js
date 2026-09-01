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

 

function riskTone(value = "") {

  const v = String(value || "").toLowerCase();

 

  if (

    ["critical", "high", "blocked", "overdue", "at risk"].some((x) =>

      v.includes(x)

    )

  ) {

    return "critical";

  }

 

  if (

    ["medium", "elevated", "watch", "open", "pending"].some((x) =>

      v.includes(x)

    )

  ) {

    return "watch";

  }

 

  return "stable";

}

 

function isOpenStatus(status = "") {

  return ![

    "done",

    "complete",

    "completed",

    "resolved",

    "closed",

    "archived",

  ].includes(String(status || "").toLowerCase());

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

    workspaces.find((workspace) => String(workspace.id) === String(workspaceId)) ||

    workspaces[0] ||

    null;

 

  const selectedId = selectedWorkspace?.id || null;

  const state = selectedWorkspace?.state || "";

 

  const tasks = firmId

    ? await safeQuery(

        `

          SELECT

            id,

            title,

            description,

            status,

            priority,

            state,

            source,

            workspace_id,

            created_at,

            updated_at

          FROM tasks

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 80

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          id,

          title,

          description,

          status,

          priority,

          state,

          source,

          workspace_id,

          created_at,

          updated_at

        FROM tasks

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 80

      `);

 

  const signals = await safeQuery(`

    SELECT

      id,

      title,

      summary,

      state,

      signal_type,

      risk,

      severity,

      signal_score,

      workspace_id,

      created_at

    FROM political_signals

    ORDER BY signal_score DESC NULLS LAST, created_at DESC NULLS LAST

    LIMIT 80

  `);

 

  const materialAlerts = await getExecutiveMaterialAlerts({

    signals,

    cycle: selectedWorkspace?.cycle || process.env.FEC_DEFAULT_CYCLE || 2026,

    state,

    limit: 4,

  });

 

  const contacts = firmId

    ? await safeQuery(

        `

          SELECT

            id,

            full_name,

            organization,

            role_type,

            state,

            workspace_id,

            created_at,

            updated_at

          FROM campaign_crm_contacts

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 80

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          id,

          full_name,

          organization,

          role_type,

          state,

          workspace_id,

          created_at,

          updated_at

        FROM campaign_crm_contacts

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 80

      `);

 

  const activities = firmId

    ? await safeQuery(

        `

          SELECT

            id,

            title,

            type,

            status,

            priority,

            due_date,

            workspace_id,

            created_at

          FROM campaign_crm_activities

          WHERE firm_id = $1

          ORDER BY created_at DESC

          LIMIT 80

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          id,

          title,

          type,

          status,

          priority,

          due_date,

          workspace_id,

          created_at

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

    SELECT

      id,

      name,

      vendor_name,

      category,

      status,

      state,

      city,

      services,

      notes,

      capabilities,

      coverage_area,

      created_at,

      updated_at

    FROM vendors

    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

    LIMIT 80

  `);

 

  const clients = firmId

    ? await safeQuery(

        `

          SELECT

            id,

            client_name,

            organization,

            state,

            status,

            health_status,

            monthly_retainer,

            created_at,

            updated_at

          FROM consultant_clients

          WHERE firm_id = $1

          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

          LIMIT 80

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          id,

          client_name,

          organization,

          state,

          status,

          health_status,

          monthly_retainer,

          created_at,

          updated_at

        FROM consultant_clients

        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST

        LIMIT 80

      `);

 

  const invoices = firmId

    ? await safeQuery(

        `

          SELECT

            i.id,

            i.title,

            i.amount,

            i.status,

            i.due_date,

            i.created_at,

            c.client_name,

            c.state

          FROM consultant_invoices i

          LEFT JOIN consultant_clients c ON c.id = i.client_id

          WHERE i.firm_id = $1

          ORDER BY i.created_at DESC

          LIMIT 80

        `,

        [firmId]

      )

    : await safeQuery(`

        SELECT

          i.id,

          i.title,

          i.amount,

          i.status,

          i.due_date,

          i.created_at,

          c.client_name,

          c.state

        FROM consultant_invoices i

        LEFT JOIN consultant_clients c ON c.id = i.client_id

        ORDER BY i.created_at DESC

        LIMIT 80

      `);

 

  const openTasks = tasks.filter((task) => isOpenStatus(task.status));

 

  const criticalSignals = signals.filter(

    (signal) => riskTone(signal.risk || signal.severity || signal.signal_score) === "critical"

  );

 

  const openActivities = activities.filter((activity) =>

    isOpenStatus(activity.status)

  );

 

  const vendorGaps = vendors.filter(vendorGapStatus);

 

  const atRiskClients = clients.filter((client) =>

    ["at risk", "watch", "critical"].includes(

      String(client.health_status || "").toLowerCase()

    )

  );

 

  const openReceivables = invoices

    .filter((invoice) =>

      ["open", "sent", "overdue"].includes(

        String(invoice.status || "").toLowerCase()

      )

    )

    .reduce((sum, invoice) => sum + number(invoice.amount), 0);

 

  const pressureScore = Math.min(

    100,

    Math.round(

      criticalSignals.length * 12 +

        openTasks.length * 2 +

        openActivities.length +

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

    ...criticalSignals.slice(0, 3).map((signal) => ({

      id: `signal-${signal.id}`,

      title: signal.title || "Critical signal",

      source: "Political Signal",

      priority: "Critical",

      path: "/political-intelligence",

      detail: signal.summary || "Review signal pressure and response options.",

      workspace_id: signal.workspace_id || selectedId,

      state: signal.state || state || null,

    })),

    ...openTasks.slice(0, 4).map((task) => ({

      id: `task-${task.id}`,

      title: task.title || "Open task",

      source: task.source || "Mission Task",

      priority: task.priority || "Open",

      path: "/command-center",

      detail: task.description || "Task requires ownership or completion.",

      workspace_id: task.workspace_id || null,

      state: task.state || null,

    })),

    ...vendorGaps.slice(0, 2).map((vendor) => ({

      id: `vendor-${vendor.id}`,

      title: `Vendor coverage watch: ${vendor.name || vendor.vendor_name || `Vendor ${vendor.id}`}`,

      source: "Vendor Network",

      priority: vendor.status || "Watch",

      path: "/vendors",

      detail: `${vendor.category || "Vendor"} - ${vendor.state || "National"}`,

      workspace_id: selectedId,

      state: vendor.state || null,

    })),

    ...atRiskClients.slice(0, 2).map((client) => ({

      id: `client-${client.id}`,

      title: `Client health watch: ${client.client_name}`,

      source: "Client / Revenue",

      priority: client.health_status || "Watch",

      path: "/revenue-intelligence",

      detail: client.organization || "Review client health and deliverables.",

      workspace_id: selectedId,

      state: client.state || null,

    })),

  ].slice(0, 10);

 

  return {

    selected_workspace: serializeWorkspace(selectedWorkspace),

    workspaces: workspaces.map(serializeWorkspace).filter(Boolean),

    summary: {

      pressure_score: pressureScore,

      workspace_readiness_score: workspaceReadinessScore,

      workspace_activity_count: workspaceActivityCount,

      pressure_status:

        pressureScore >= 70

          ? "Critical"

          : pressureScore >= 40

            ? "Watch"

            : "Stable",

      open_tasks: openTasks.length,

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

    executive_actions: executiveActions,

    material_alerts: materialAlerts.alerts || [],

    material_alerts_summary: materialAlerts.summary || {},

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
