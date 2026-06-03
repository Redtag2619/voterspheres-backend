import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

function clean(value = "") {
  return String(value ?? "").trim();
}

export async function ensureCampaignWorkspaceCrmTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_crm_contacts (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      full_name TEXT NOT NULL,
      organization TEXT NULL,
      title TEXT NULL,
      email TEXT NULL,
      phone TEXT NULL,
      role_type TEXT DEFAULT 'stakeholder',
      state TEXT NULL,
      county TEXT NULL,
      notes TEXT NULL,
      tags TEXT[] DEFAULT ARRAY[]::TEXT[],
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_crm_activities (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      contact_id INTEGER NULL,
      activity_type TEXT DEFAULT 'note',
      title TEXT NOT NULL,
      body TEXT NULL,
      outcome TEXT NULL,
      due_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_crm_contacts_firm_workspace
    ON campaign_crm_contacts (firm_id, workspace_id);

    CREATE INDEX IF NOT EXISTS idx_campaign_crm_activities_firm_workspace
    ON campaign_crm_activities (firm_id, workspace_id);
  `);
}

export async function getCampaignWorkspaceCrmDashboard({ user = {}, workspaceId = null }) {
  await ensureCampaignWorkspaceCrmTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const workspaceFilter = workspaceId ? `AND workspace_id = $2` : "";
  const params = workspaceId ? [firmId, workspaceId] : [firmId];

  const contacts = await pool.query(
    `
      SELECT *
      FROM campaign_crm_contacts
      WHERE firm_id = $1 ${workspaceFilter}
      ORDER BY updated_at DESC
      LIMIT 250
    `,
    params
  );

  const activities = await pool.query(
    `
      SELECT a.*, c.full_name AS contact_name
      FROM campaign_crm_activities a
      LEFT JOIN campaign_crm_contacts c ON c.id = a.contact_id
      WHERE a.firm_id = $1 ${workspaceFilter}
      ORDER BY a.created_at DESC
      LIMIT 250
    `,
    params
  );

  const tasks = await pool.query(
    `
      SELECT *
      FROM tasks
      WHERE firm_id = $1
      ${workspaceId ? "AND workspace_id = $2" : ""}
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 100
    `,
    params
  ).catch(() => ({ rows: [] }));

  const signals = await pool.query(
    `
      SELECT *
      FROM political_signals
      WHERE firm_id = $1
      ${workspaceId ? "AND workspace_id = $2" : ""}
      ORDER BY observed_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 100
    `,
    params
  ).catch(() => ({ rows: [] }));

  const responses = await pool.query(
    `
      SELECT *
      FROM narrative_rapid_responses
      WHERE firm_id = $1
      ${workspaceId ? "AND workspace_id = $2" : ""}
      ORDER BY updated_at DESC
      LIMIT 50
    `,
    params
  ).catch(() => ({ rows: [] }));

  const openTasks = tasks.rows.filter(
    (t) => !["complete", "completed", "done", "resolved"].includes(String(t.status || "").toLowerCase())
  );

  const highSignals = signals.rows.filter(
    (s) => ["Critical", "High", "critical", "high"].includes(String(s.risk || s.severity || ""))
  );

  return {
    summary: {
      contacts: contacts.rows.length,
      activities: activities.rows.length,
      open_tasks: openTasks.length,
      signals: signals.rows.length,
      high_signals: highSignals.length,
      rapid_responses: responses.rows.length,
    },
    contacts: contacts.rows,
    activities: activities.rows,
    tasks: tasks.rows,
    signals: signals.rows,
    rapid_responses: responses.rows,
    ai_recommendations: [
      highSignals.length
        ? "High-risk political signals detected. Assign a rapid response owner and log follow-up activity."
        : "Signal environment is stable. Continue monitoring workspace movement.",
      openTasks.length
        ? "Open execution tasks remain. Review owner assignment and due dates."
        : "No major task backlog detected.",
      contacts.rows.length
        ? "Use CRM notes to track consultant, vendor, donor, and stakeholder relationships."
        : "Add key campaign stakeholders to begin building institutional memory.",
    ],
    updated_at: new Date().toISOString(),
  };
}

export async function createCampaignCrmContact({ user = {}, payload = {} }) {
  await ensureCampaignWorkspaceCrmTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const fullName = clean(payload.full_name || payload.name);
  if (!fullName) throw new Error("Contact name is required.");

  const result = await pool.query(
    `
      INSERT INTO campaign_crm_contacts (
        firm_id, workspace_id, full_name, organization, title, email, phone,
        role_type, state, county, notes, tags, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      payload.workspace_id || null,
      fullName,
      payload.organization || null,
      payload.title || null,
      payload.email || null,
      payload.phone || null,
      payload.role_type || "stakeholder",
      payload.state || null,
      payload.county || null,
      payload.notes || null,
      Array.isArray(payload.tags) ? payload.tags : [],
      userId,
    ]
  );

  return result.rows[0];
}

export async function createCampaignCrmActivity({ user = {}, payload = {} }) {
  await ensureCampaignWorkspaceCrmTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const title = clean(payload.title);
  if (!title) throw new Error("Activity title is required.");

  const result = await pool.query(
    `
      INSERT INTO campaign_crm_activities (
        firm_id, workspace_id, contact_id, activity_type, title, body,
        outcome, due_at, metadata, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      payload.workspace_id || null,
      payload.contact_id || null,
      payload.activity_type || "note",
      title,
      payload.body || null,
      payload.outcome || null,
      payload.due_at || null,
      JSON.stringify(payload.metadata || {}),
      userId,
    ]
  );

  return result.rows[0];
}

export async function completeCampaignCrmActivity({ user = {}, id }) {
  await ensureCampaignWorkspaceCrmTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      UPDATE campaign_crm_activities
      SET completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
      RETURNING *
    `,
    [id, firmId]
  );

  if (!result.rows[0]) throw new Error("Activity not found.");
  return result.rows[0];
}
