import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

function money(value = 0) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clean(value = "") {
  return String(value || "").trim();
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[consultant-business-suite] skipped query:", error.message);
    return [];
  }
}

export async function ensureConsultantBusinessSuiteTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_clients (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      organization TEXT NULL,
      primary_contact TEXT NULL,
      email TEXT NULL,
      phone TEXT NULL,
      state TEXT NULL,
      status TEXT DEFAULT 'active',
      health_status TEXT DEFAULT 'stable',
      monthly_retainer NUMERIC DEFAULT 0,
      notes TEXT NULL,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_projects (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      client_id INTEGER NULL,
      project_name TEXT NOT NULL,
      project_type TEXT DEFAULT 'campaign',
      status TEXT DEFAULT 'active',
      budget NUMERIC DEFAULT 0,
      projected_revenue NUMERIC DEFAULT 0,
      actual_cost NUMERIC DEFAULT 0,
      owner TEXT NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      notes TEXT NULL,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_invoices (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      client_id INTEGER NULL,
      invoice_number TEXT NULL,
      title TEXT NOT NULL,
      amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'draft',
      due_date DATE NULL,
      paid_at TIMESTAMPTZ NULL,
      notes TEXT NULL,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_time_entries (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      client_id INTEGER NULL,
      project_id INTEGER NULL,
      staff_name TEXT NOT NULL,
      role TEXT NULL,
      hours NUMERIC DEFAULT 0,
      billable BOOLEAN DEFAULT true,
      hourly_rate NUMERIC DEFAULT 0,
      entry_date DATE DEFAULT CURRENT_DATE,
      notes TEXT NULL,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_consultant_clients_firm
    ON consultant_clients (firm_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_consultant_projects_firm
    ON consultant_projects (firm_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_consultant_invoices_firm
    ON consultant_invoices (firm_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_consultant_time_entries_firm
    ON consultant_time_entries (firm_id, entry_date DESC);
  `);
}

export async function getConsultantBusinessSuiteDashboard({ user = {} }) {
  await ensureConsultantBusinessSuiteTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const clients = await safeQuery(
    `
      SELECT *
      FROM consultant_clients
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 200
    `,
    [firmId]
  );

  const projects = await safeQuery(
    `
      SELECT p.*, c.client_name
      FROM consultant_projects p
      LEFT JOIN consultant_clients c ON c.id = p.client_id
      WHERE p.firm_id = $1
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT 200
    `,
    [firmId]
  );

  const invoices = await safeQuery(
    `
      SELECT i.*, c.client_name
      FROM consultant_invoices i
      LEFT JOIN consultant_clients c ON c.id = i.client_id
      WHERE i.firm_id = $1
      ORDER BY i.created_at DESC
      LIMIT 200
    `,
    [firmId]
  );

  const timeEntries = await safeQuery(
    `
      SELECT t.*, c.client_name, p.project_name
      FROM consultant_time_entries t
      LEFT JOIN consultant_clients c ON c.id = t.client_id
      LEFT JOIN consultant_projects p ON p.id = t.project_id
      WHERE t.firm_id = $1
      ORDER BY t.entry_date DESC, t.created_at DESC
      LIMIT 200
    `,
    [firmId]
  );

  const clientPortalRows = await safeQuery(
    `
      SELECT client_name, organization, email, status, last_viewed_at, created_at
      FROM client_portal_clients
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `,
    [firmId]
  );

  const reportRows = await safeQuery(
    `
      SELECT id, title, report_type, state, created_at
      FROM intelligence_reports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `,
    [firmId]
  );

  const activeClients = clients.filter((c) => c.status === "active");
  const activeProjects = projects.filter((p) => p.status === "active");
  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const openInvoices = invoices.filter((i) => ["draft", "sent", "overdue", "open"].includes(String(i.status || "").toLowerCase()));
  const overdueInvoices = invoices.filter((i) => String(i.status || "").toLowerCase() === "overdue");

  const monthlyRetainerRevenue = activeClients.reduce((sum, c) => sum + Number(c.monthly_retainer || 0), 0);
  const paidRevenue = paidInvoices.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const openReceivables = openInvoices.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const projectedRevenue = projects.reduce((sum, p) => sum + Number(p.projected_revenue || 0), 0);
  const actualCost = projects.reduce((sum, p) => sum + Number(p.actual_cost || 0), 0);
  const billableHours = timeEntries.filter((t) => t.billable).reduce((sum, t) => sum + Number(t.hours || 0), 0);
  const nonBillableHours = timeEntries.filter((t) => !t.billable).reduce((sum, t) => sum + Number(t.hours || 0), 0);
  const timeRevenue = timeEntries
    .filter((t) => t.billable)
    .reduce((sum, t) => sum + Number(t.hours || 0) * Number(t.hourly_rate || 0), 0);

  const profitability = projectedRevenue + monthlyRetainerRevenue + paidRevenue - actualCost;

  const clientHealth = clients.map((client) => {
    const clientInvoices = invoices.filter((i) => String(i.client_id || "") === String(client.id));
    const clientProjects = projects.filter((p) => String(p.client_id || "") === String(client.id));
    const clientTime = timeEntries.filter((t) => String(t.client_id || "") === String(client.id));

    const unpaid = clientInvoices
      .filter((i) => i.status !== "paid")
      .reduce((sum, i) => sum + Number(i.amount || 0), 0);

    const projectCount = clientProjects.length;
    const hours = clientTime.reduce((sum, t) => sum + Number(t.hours || 0), 0);
    const retainer = Number(client.monthly_retainer || 0);

    let score = 75;
    if (retainer > 0) score += 10;
    if (projectCount > 0) score += 8;
    if (hours > 20) score += 5;
    if (unpaid > 0) score -= 12;
    if (String(client.health_status || "").toLowerCase() === "at_risk") score -= 20;

    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      id: client.id,
      client_name: client.client_name,
      organization: client.organization,
      state: client.state || "National",
      status: client.status,
      health_status: score >= 80 ? "Strong" : score >= 60 ? "Stable" : "At Risk",
      health_score: score,
      monthly_retainer: retainer,
      unpaid_balance: money(unpaid),
      projects: projectCount,
      hours: money(hours),
    };
  });

  const staffUtilizationMap = new Map();

  for (const entry of timeEntries) {
    const key = entry.staff_name || "Unassigned";
    const current = staffUtilizationMap.get(key) || {
      staff_name: key,
      role: entry.role || "Staff",
      billable_hours: 0,
      non_billable_hours: 0,
      revenue: 0,
    };

    if (entry.billable) {
      current.billable_hours += Number(entry.hours || 0);
      current.revenue += Number(entry.hours || 0) * Number(entry.hourly_rate || 0);
    } else {
      current.non_billable_hours += Number(entry.hours || 0);
    }

    staffUtilizationMap.set(key, current);
  }

  const staffUtilization = Array.from(staffUtilizationMap.values()).map((staff) => {
    const total = staff.billable_hours + staff.non_billable_hours;
    return {
      ...staff,
      billable_hours: money(staff.billable_hours),
      non_billable_hours: money(staff.non_billable_hours),
      utilization_rate: total ? Math.round((staff.billable_hours / total) * 100) : 0,
      revenue: money(staff.revenue),
    };
  });

  return {
    summary: {
      active_clients: activeClients.length,
      active_projects: activeProjects.length,
      monthly_retainer_revenue: money(monthlyRetainerRevenue),
      paid_revenue: money(paidRevenue),
      open_receivables: money(openReceivables),
      overdue_invoices: overdueInvoices.length,
      projected_revenue: money(projectedRevenue),
      actual_cost: money(actualCost),
      profitability: money(profitability),
      billable_hours: money(billableHours),
      non_billable_hours: money(nonBillableHours),
      time_revenue: money(timeRevenue),
      client_portals: clientPortalRows.length,
      reports_generated: reportRows.length,
    },
    clients,
    projects,
    invoices,
    time_entries: timeEntries,
    client_health: clientHealth,
    staff_utilization: staffUtilization,
    client_portals: clientPortalRows,
    reports: reportRows,
    updated_at: new Date().toISOString(),
  };
}

export async function createConsultantClient({ user = {}, payload = {} }) {
  await ensureConsultantBusinessSuiteTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const clientName = clean(payload.client_name || payload.name);
  if (!clientName) throw new Error("Client name is required.");

  const result = await pool.query(
    `
      INSERT INTO consultant_clients (
        firm_id, client_name, organization, primary_contact, email, phone,
        state, status, health_status, monthly_retainer, notes,
        created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      clientName,
      payload.organization || null,
      payload.primary_contact || null,
      payload.email || null,
      payload.phone || null,
      payload.state || null,
      payload.status || "active",
      payload.health_status || "stable",
      payload.monthly_retainer || 0,
      payload.notes || null,
      userId,
    ]
  );

  return result.rows[0];
}

export async function createConsultantProject({ user = {}, payload = {} }) {
  await ensureConsultantBusinessSuiteTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const projectName = clean(payload.project_name || payload.name);
  if (!projectName) throw new Error("Project name is required.");

  const result = await pool.query(
    `
      INSERT INTO consultant_projects (
        firm_id, client_id, project_name, project_type, status, budget,
        projected_revenue, actual_cost, owner, start_date, end_date, notes,
        created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      payload.client_id || null,
      projectName,
      payload.project_type || "campaign",
      payload.status || "active",
      payload.budget || 0,
      payload.projected_revenue || 0,
      payload.actual_cost || 0,
      payload.owner || null,
      payload.start_date || null,
      payload.end_date || null,
      payload.notes || null,
      userId,
    ]
  );

  return result.rows[0];
}

export async function createConsultantInvoice({ user = {}, payload = {} }) {
  await ensureConsultantBusinessSuiteTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const title = clean(payload.title);
  if (!title) throw new Error("Invoice title is required.");

  const result = await pool.query(
    `
      INSERT INTO consultant_invoices (
        firm_id, client_id, invoice_number, title, amount, status,
        due_date, paid_at, notes, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      payload.client_id || null,
      payload.invoice_number || null,
      title,
      payload.amount || 0,
      payload.status || "draft",
      payload.due_date || null,
      payload.paid_at || null,
      payload.notes || null,
      userId,
    ]
  );

  return result.rows[0];
}

export async function createConsultantTimeEntry({ user = {}, payload = {} }) {
  await ensureConsultantBusinessSuiteTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const staffName = clean(payload.staff_name);
  if (!staffName) throw new Error("Staff name is required.");

  const result = await pool.query(
    `
      INSERT INTO consultant_time_entries (
        firm_id, client_id, project_id, staff_name, role, hours,
        billable, hourly_rate, entry_date, notes, created_by, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      RETURNING *
    `,
    [
      firmId,
      payload.client_id || null,
      payload.project_id || null,
      staffName,
      payload.role || null,
      payload.hours || 0,
      payload.billable === false ? false : true,
      payload.hourly_rate || 0,
      payload.entry_date || new Date().toISOString().slice(0, 10),
      payload.notes || null,
      userId,
    ]
  );

  return result.rows[0];
}
