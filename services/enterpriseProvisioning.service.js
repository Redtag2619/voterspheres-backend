import { pool } from "../db/pool.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function nullableText(value = "") {
  const clean = text(value);
  return clean ? clean : null;
}

function slugify(value = "") {
  return (
    text(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || `enterprise-${Date.now()}`
  );
}

async function tableExists(tableName) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.exists);
}

async function getColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function ensureProvisioningColumns() {
  await pool.query(`
    ALTER TABLE enterprise_leads
      ADD COLUMN IF NOT EXISTS provisioned_workspace_id INTEGER,
      ADD COLUMN IF NOT EXISTS provisioned_workspace_table TEXT,
      ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS provisioning_status TEXT DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS provisioning_notes TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_onboarding_workspaces (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER,
      firm_id INTEGER,
      name TEXT NOT NULL,
      slug TEXT,
      client_name TEXT,
      contact_name TEXT,
      contact_email TEXT,
      states TEXT[],
      cycle TEXT,
      budget_range TEXT,
      status TEXT DEFAULT 'onboarding',
      source TEXT DEFAULT 'enterprise_provisioning',
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_onboarding_tasks (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER,
      workspace_id INTEGER,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getLead(leadId) {
  const result = await pool.query(
    `
      SELECT *
      FROM enterprise_leads
      WHERE id = $1
      LIMIT 1
    `,
    [leadId]
  );

  return result.rows?.[0] || null;
}

function buildInsert(tableName, columns, valuesByColumn) {
  const insertColumns = [];
  const params = [];

  Object.entries(valuesByColumn).forEach(([column, value]) => {
    if (columns.has(column)) {
      insertColumns.push(column);
      params.push(value);
    }
  });

  if (!insertColumns.length) {
    throw new Error(`No compatible columns found for ${tableName}`);
  }

  const placeholders = params.map((_, index) => `$${index + 1}`);

  return {
    sql: `
      INSERT INTO ${tableName} (${insertColumns.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `,
    params,
  };
}

async function createWorkspaceForLead({ lead, userId, firmId }) {
  const preferredTables = ["workspaces", "campaign_workspaces"];
  const workspaceName = `${lead.firm_name || lead.contact_name || lead.full_name || "Enterprise"} Onboarding`;
  const workspaceSlug = `${slugify(lead.firm_name || lead.email)}-${Date.now()}`;

  for (const tableName of preferredTables) {
    if (!(await tableExists(tableName))) continue;

    const columns = await getColumns(tableName);

    const valuesByColumn = {
      firm_id: lead.firm_id || firmId || null,
      user_id: userId || null,
      owner_user_id: userId || null,
      created_by: userId || null,
      created_by_user_id: userId || null,
      name: workspaceName,
      title: workspaceName,
      slug: workspaceSlug,
      client_name: lead.firm_name || null,
      contact_name: lead.contact_name || lead.full_name || null,
      contact_email: lead.email || null,
      email: lead.email || null,
      description: `Enterprise onboarding workspace created from lead #${lead.id}.`,
      status: "active",
      stage: "onboarding",
      source: "enterprise_provisioning",
      created_at: new Date(),
      updated_at: new Date(),
    };

    const insert = buildInsert(tableName, columns, valuesByColumn);
    const result = await pool.query(insert.sql, insert.params);

    return {
      workspace: result.rows[0],
      workspaceTable: tableName,
    };
  }

  const fallback = await pool.query(
    `
      INSERT INTO enterprise_onboarding_workspaces (
        lead_id,
        firm_id,
        name,
        slug,
        client_name,
        contact_name,
        contact_email,
        states,
        cycle,
        budget_range,
        status,
        source,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,'onboarding','enterprise_provisioning',$11,NOW(),NOW())
      RETURNING *
    `,
    [
      lead.id,
      lead.firm_id || firmId || null,
      workspaceName,
      workspaceSlug,
      lead.firm_name || null,
      lead.contact_name || lead.full_name || null,
      lead.email || null,
      Array.isArray(lead.states) ? lead.states : [],
      lead.cycle || null,
      lead.budget_range || null,
      userId || null,
    ]
  );

  return {
    workspace: fallback.rows[0],
    workspaceTable: "enterprise_onboarding_workspaces",
  };
}

async function seedClientContact({ lead, workspace, workspaceTable, userId }) {
  const contactTables = ["workspace_client_contacts", "client_contacts", "contacts"];

  for (const tableName of contactTables) {
    if (!(await tableExists(tableName))) continue;

    const columns = await getColumns(tableName);

    const valuesByColumn = {
      workspace_id: workspace.id,
      lead_id: lead.id,
      firm_id: lead.firm_id || null,
      name: lead.contact_name || lead.full_name || lead.email,
      full_name: lead.contact_name || lead.full_name || lead.email,
      contact_name: lead.contact_name || lead.full_name || lead.email,
      email: lead.email || null,
      phone: lead.phone || null,
      title: lead.title || null,
      firm_name: lead.firm_name || null,
      organization: lead.firm_name || null,
      source: "enterprise_provisioning",
      created_by: userId || null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const insert = buildInsert(tableName, columns, valuesByColumn);
    const result = await pool.query(insert.sql, insert.params);

    return {
      contact: result.rows[0],
      contactTable: tableName,
    };
  }

  return {
    contact: null,
    contactTable: null,
  };
}

async function seedOnboardingTasks({ lead, workspace }) {
  const tasks = [
    "Confirm enterprise onboarding goals",
    "Create first client report template",
    "Import priority campaigns and states",
    "Configure scheduled reporting cadence",
    "Review MailOps and vendor workflows",
  ];

  const inserted = [];

  for (const title of tasks) {
    const result = await pool.query(
      `
        INSERT INTO enterprise_onboarding_tasks (
          lead_id,
          workspace_id,
          title,
          status,
          priority,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,'open','high',NOW(),NOW())
        RETURNING *
      `,
      [lead.id, workspace.id, title]
    );

    inserted.push(result.rows[0]);
  }

  return inserted;
}

export async function provisionEnterpriseLeadWorkspace({
  leadId,
  userId = null,
  firmId = null,
}) {
  await ensureProvisioningColumns();

  const lead = await getLead(leadId);

  if (!lead) {
    const error = new Error("Enterprise lead not found");
    error.statusCode = 404;
    throw error;
  }

  if (lead.provisioned_workspace_id) {
    return {
      alreadyProvisioned: true,
      lead,
      workspace: {
        id: lead.provisioned_workspace_id,
        table: lead.provisioned_workspace_table || "unknown",
      },
      tasks: [],
    };
  }

  const { workspace, workspaceTable } = await createWorkspaceForLead({
    lead,
    userId,
    firmId,
  });

  const contactResult = await seedClientContact({
    lead,
    workspace,
    workspaceTable,
    userId,
  });

  const tasks = await seedOnboardingTasks({
    lead,
    workspace,
  });

  const updatedLead = await pool.query(
    `
      UPDATE enterprise_leads
      SET
        provisioned_workspace_id = $2,
        provisioned_workspace_table = $3,
        provisioned_at = NOW(),
        provisioning_status = 'provisioned',
        provisioning_notes = COALESCE(provisioning_notes, 'Workspace provisioned from enterprise CRM.'),
        stage = CASE
          WHEN stage IN ('won', 'converted') THEN stage
          ELSE 'qualified'
        END,
        status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'enterprise_leads'
              AND column_name = 'status'
          )
          THEN COALESCE(status, 'qualified')
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [lead.id, workspace.id, workspaceTable]
  );

  return {
    alreadyProvisioned: false,
    lead: updatedLead.rows[0],
    workspace,
    workspaceTable,
    contact: contactResult.contact,
    contactTable: contactResult.contactTable,
    tasks,
  };
}

export default {
  provisionEnterpriseLeadWorkspace,
};