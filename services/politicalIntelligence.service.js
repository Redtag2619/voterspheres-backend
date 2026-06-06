import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[political-intelligence] skipped query:", error.message);
    return [];
  }
}

function clean(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function node(id, label, type, meta = {}) {
  return {
    id: String(id),
    label: clean(label || id),
    type,
    state: meta.state || "National",
    risk: meta.risk || "Stable",
    score: Number(meta.score || 0),
    meta,
  };
}

function edge(source, target, label, type = "related", weight = 1) {
  return {
    id: `${source}-${target}-${type}`.replace(/\s+/g, "-"),
    source: String(source),
    target: String(target),
    label,
    type,
    weight,
  };
}

function riskFromScore(score = 0) {
  if (score >= 70) return "High";
  if (score >= 35) return "Elevated";
  return "Stable";
}

export async function getPoliticalIntelligenceGraph({ user = {}, query = "", state = "", type = "" }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const workspaces = await safeQuery(
    `
      SELECT id, name, campaign_name, title, state, office, cycle, status
      FROM workspaces
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 60
    `,
    [firmId]
  );

  const signals = await safeQuery(
    `
      SELECT id, title, summary, state, signal_type, risk, severity, signal_score, workspace_id, created_at
      FROM political_signals
      WHERE firm_id = $1
      ORDER BY signal_score DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 100
    `,
    [firmId]
  );

  const clients = await safeQuery(
    `
      SELECT id, client_name, organization, state, status, health_status, monthly_retainer
      FROM consultant_clients
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 80
    `,
    [firmId]
  );

  const projects = await safeQuery(
    `
      SELECT id, client_id, project_name, project_type, status, owner, projected_revenue, actual_cost
      FROM consultant_projects
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 80
    `,
    [firmId]
  );

  const vendors = await safeQuery(
    `
      SELECT id, name, vendor_name, category, state, status, risk, coverage_tier
      FROM vendors
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 80
    `,
    [firmId]
  );

  const reports = await safeQuery(
    `
      SELECT id, title, report_type, state, status, created_at
      FROM intelligence_reports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 60
    `,
    [firmId]
  );

  const crmContacts = await safeQuery(
    `
      SELECT id, full_name, organization, role_type, state, workspace_id
      FROM campaign_crm_contacts
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 80
    `,
    [firmId]
  );

  const tasks = await safeQuery(
    `
      SELECT id, title, status, priority, state, workspace_id, source
      FROM tasks
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 80
    `,
    [firmId]
  );

  const nodes = [];
  const edges = [];

  nodes.push(node("firm", "Firm Command Graph", "firm", { state: "National", risk: "Stable" }));

  for (const w of workspaces) {
    const id = `workspace-${w.id}`;
    nodes.push(node(id, w.name || w.campaign_name || w.title || `Workspace ${w.id}`, "workspace", {
      state: w.state || "National",
      risk: w.status || "Active",
      office: w.office,
      cycle: w.cycle,
    }));
    edges.push(edge("firm", id, "manages", "firm_workspace", 4));
  }

  for (const signal of signals) {
    const id = `signal-${signal.id}`;
    const score = Number(signal.signal_score || 0);
    nodes.push(node(id, signal.title || "Political Signal", "signal", {
      state: signal.state || "National",
      risk: signal.risk || signal.severity || riskFromScore(score),
      score,
      signal_type: signal.signal_type,
      summary: signal.summary,
    }));

    if (signal.workspace_id) edges.push(edge(`workspace-${signal.workspace_id}`, id, "has signal", "workspace_signal", 5));
    else edges.push(edge("firm", id, "monitors", "firm_signal", 2));
  }

  for (const client of clients) {
    const id = `client-${client.id}`;
    nodes.push(node(id, client.client_name, "client", {
      state: client.state || "National",
      risk: client.health_status || "Stable",
      organization: client.organization,
      status: client.status,
      monthly_retainer: client.monthly_retainer,
    }));
    edges.push(edge("firm", id, "serves", "firm_client", 5));
  }

  for (const project of projects) {
    const id = `project-${project.id}`;
    const revenue = Number(project.projected_revenue || 0);
    const cost = Number(project.actual_cost || 0);
    const margin = revenue ? Math.round(((revenue - cost) / revenue) * 100) : 0;

    nodes.push(node(id, project.project_name, "project", {
      state: "National",
      risk: margin < 15 ? "At Risk" : margin < 35 ? "Watch" : "Stable",
      score: margin,
      project_type: project.project_type,
      owner: project.owner,
      status: project.status,
    }));

    if (project.client_id) edges.push(edge(`client-${project.client_id}`, id, "owns project", "client_project", 4));
    else edges.push(edge("firm", id, "runs project", "firm_project", 2));
  }

  for (const vendor of vendors) {
    const id = `vendor-${vendor.id}`;
    nodes.push(node(id, vendor.name || vendor.vendor_name || `Vendor ${vendor.id}`, "vendor", {
      state: vendor.state || "National",
      risk: vendor.risk || vendor.coverage_tier || "Stable",
      category: vendor.category,
      status: vendor.status,
    }));
    edges.push(edge("firm", id, "uses vendor", "firm_vendor", 3));
  }

  for (const report of reports) {
    const id = `report-${report.id}`;
    nodes.push(node(id, report.title, "report", {
      state: report.state || "National",
      risk: report.status || "Generated",
      report_type: report.report_type,
      created_at: report.created_at,
    }));
    edges.push(edge("firm", id, "generated report", "firm_report", 2));
  }

  for (const contact of crmContacts) {
    const id = `contact-${contact.id}`;
    nodes.push(node(id, contact.full_name, "contact", {
      state: contact.state || "National",
      risk: "Stable",
      role_type: contact.role_type,
      organization: contact.organization,
    }));

    if (contact.workspace_id) edges.push(edge(`workspace-${contact.workspace_id}`, id, "has contact", "workspace_contact", 3));
    else edges.push(edge("firm", id, "knows contact", "firm_contact", 1));
  }

  for (const task of tasks) {
    const id = `task-${task.id}`;
    nodes.push(node(id, task.title, "task", {
      state: task.state || "National",
      risk: task.priority || task.status || "Open",
      status: task.status,
      priority: task.priority,
      source: task.source,
    }));

    if (task.workspace_id) edges.push(edge(`workspace-${task.workspace_id}`, id, "has task", "workspace_task", 3));
    else edges.push(edge("firm", id, "tracks task", "firm_task", 1));
  }

  const q = String(query || "").toLowerCase();
  let filteredNodes = nodes.filter((n) => {
    if (state && n.state !== state) return false;
    if (type && n.type !== type) return false;
    if (!q) return true;

    return [
      n.label,
      n.type,
      n.state,
      n.risk,
      n.meta?.organization,
      n.meta?.category,
      n.meta?.role_type,
      n.meta?.project_type,
      n.meta?.summary,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const connectedIds = new Set();
  for (const e of filteredEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }

  if (q || state || type) {
    filteredNodes = filteredNodes.filter((n) => n.id === "firm" || connectedIds.has(n.id) || n.type === type);
  }

  const counts = filteredNodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {});

  const highRisk = filteredNodes.filter((n) =>
    ["critical", "high", "at risk", "overdue"].includes(String(n.risk || "").toLowerCase())
  ).length;

  return {
    summary: {
      nodes: filteredNodes.length,
      edges: filteredEdges.length,
      high_risk: highRisk,
      workspaces: counts.workspace || 0,
      signals: counts.signal || 0,
      clients: counts.client || 0,
      projects: counts.project || 0,
      vendors: counts.vendor || 0,
      reports: counts.report || 0,
      contacts: counts.contact || 0,
      tasks: counts.task || 0,
    },
    nodes: filteredNodes.slice(0, 260),
    edges: filteredEdges.slice(0, 420),
    type_counts: counts,
    updated_at: new Date().toISOString(),
  };
}
