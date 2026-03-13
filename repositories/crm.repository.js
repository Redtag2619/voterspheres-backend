import { pool } from "../db/pool.js";

export async function ensureCrmTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS firms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      website TEXT,
      firm_type TEXT,
      primary_state TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      firm_id INT REFERENCES firms(id) ON DELETE SET NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      title TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      firm_id INT REFERENCES firms(id) ON DELETE SET NULL,
      owner_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
      candidate_id TEXT,
      candidate_name TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      office TEXT,
      state TEXT,
      county TEXT,
      party TEXT,
      election_year INT,
      stage TEXT NOT NULL DEFAULT 'Lead',
      status TEXT NOT NULL DEFAULT 'Open',
      incumbent_status TEXT,
      website TEXT,
      contract_value NUMERIC DEFAULT 0,
      budget_total NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_contacts (
      id SERIAL PRIMARY KEY,
      campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT,
      organization TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_vendors (
      id SERIAL PRIMARY KEY,
      campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      vendor_name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'prospect',
      contract_value NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_tasks (
      id SERIAL PRIMARY KEY,
      campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      assigned_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'medium',
      due_date DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_documents (
      id SERIAL PRIMARY KEY,
      campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      document_type TEXT,
      file_url TEXT,
      uploaded_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_activity (
      id SERIAL PRIMARY KEY,
      campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      actor_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
      activity_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_firm_id ON campaigns(firm_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_stage ON campaigns(stage)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_state ON campaigns(state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_id ON campaign_contacts(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_vendors_campaign_id ON campaign_vendors(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_tasks_campaign_id ON campaign_tasks(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_documents_campaign_id ON campaign_documents(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_activity_campaign_id ON campaign_activity(campaign_id)
  `);
}

export async function createFirm({
  name,
  slug,
  website = null,
  firm_type = null,
  primary_state = null,
  description = null
}) {
  const result = await pool.query(
    `
    INSERT INTO firms (
      name, slug, website, firm_type, primary_state, description, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
    RETURNING *
    `,
    [name, slug, website, firm_type, primary_state, description]
  );

  return result.rows[0];
}

export async function listFirms({ search = "" } = {}) {
  const hasSearch = Boolean(search?.trim());

  const result = await pool.query(
    `
    SELECT *
    FROM firms
    WHERE ($1 = FALSE OR name ILIKE $2 OR slug ILIKE $2)
    ORDER BY updated_at DESC, name ASC
    `,
    [hasSearch, `%${search}%`]
  );

  return result.rows;
}

export async function createUser({
  firm_id = null,
  first_name,
  last_name,
  email,
  role = "member",
  title = null
}) {
  const result = await pool.query(
    `
    INSERT INTO app_users (
      firm_id, first_name, last_name, email, role, title, is_active, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW(),NOW())
    RETURNING *
    `,
    [firm_id, first_name, last_name, email, role, title]
  );

  return result.rows[0];
}

export async function listUsers({ firm_id = null, search = "" } = {}) {
  const result = await pool.query(
    `
    SELECT
      u.*,
      f.name AS firm_name
    FROM app_users u
    LEFT JOIN firms f ON f.id = u.firm_id
    WHERE ($1::INT IS NULL OR u.firm_id = $1)
      AND ($2 = '' OR u.first_name ILIKE $3 OR u.last_name ILIKE $3 OR u.email ILIKE $3)
    ORDER BY u.updated_at DESC, u.last_name ASC, u.first_name ASC
    `,
    [firm_id, search, `%${search}%`]
  );

  return result.rows;
}

export async function createCampaign({
  firm_id = null,
  owner_user_id = null,
  candidate_id = null,
  candidate_name,
  campaign_name,
  office = null,
  state = null,
  county = null,
  party = null,
  election_year = null,
  stage = "Lead",
  status = "Open",
  incumbent_status = null,
  website = null,
  contract_value = 0,
  budget_total = 0,
  notes = null
}) {
  const result = await pool.query(
    `
    INSERT INTO campaigns (
      firm_id,
      owner_user_id,
      candidate_id,
      candidate_name,
      campaign_name,
      office,
      state,
      county,
      party,
      election_year,
      stage,
      status,
      incumbent_status,
      website,
      contract_value,
      budget_total,
      notes,
      created_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()
    )
    RETURNING *
    `,
    [
      firm_id,
      owner_user_id,
      candidate_id,
      candidate_name,
      campaign_name,
      office,
      state,
      county,
      party,
      election_year,
      stage,
      status,
      incumbent_status,
      website,
      Number(contract_value || 0),
      Number(budget_total || 0),
      notes
    ]
  );

  return result.rows[0];
}

export async function listCampaigns({
  firm_id = null,
  stage = "",
  state = "",
  search = ""
} = {}) {
  const result = await pool.query(
    `
    SELECT
      c.*,
      f.name AS firm_name,
      u.first_name AS owner_first_name,
      u.last_name AS owner_last_name
    FROM campaigns c
    LEFT JOIN firms f ON f.id = c.firm_id
    LEFT JOIN app_users u ON u.id = c.owner_user_id
    WHERE ($1::INT IS NULL OR c.firm_id = $1)
      AND ($2 = '' OR c.stage = $2)
      AND ($3 = '' OR c.state = $3)
      AND (
        $4 = ''
        OR c.candidate_name ILIKE $5
        OR c.campaign_name ILIKE $5
        OR c.office ILIKE $5
      )
    ORDER BY c.updated_at DESC, c.created_at DESC
    `,
    [firm_id, stage, state, search, `%${search}%`]
  );

  return result.rows;
}

export async function getCampaignById(campaignId) {
  const campaignResult = await pool.query(
    `
    SELECT
      c.*,
      f.name AS firm_name,
      f.slug AS firm_slug,
      u.first_name AS owner_first_name,
      u.last_name AS owner_last_name,
      u.email AS owner_email
    FROM campaigns c
    LEFT JOIN firms f ON f.id = c.firm_id
    LEFT JOIN app_users u ON u.id = c.owner_user_id
    WHERE c.id = $1
    `,
    [campaignId]
  );

  const campaign = campaignResult.rows[0];
  if (!campaign) return null;

  const [contacts, vendors, tasks, documents, activity] = await Promise.all([
    pool.query(
      `
      SELECT *
      FROM campaign_contacts
      WHERE campaign_id = $1
      ORDER BY updated_at DESC, full_name ASC
      `,
      [campaignId]
    ),
    pool.query(
      `
      SELECT *
      FROM campaign_vendors
      WHERE campaign_id = $1
      ORDER BY updated_at DESC, vendor_name ASC
      `,
      [campaignId]
    ),
    pool.query(
      `
      SELECT
        t.*,
        u.first_name AS assigned_first_name,
        u.last_name AS assigned_last_name
      FROM campaign_tasks t
      LEFT JOIN app_users u ON u.id = t.assigned_user_id
      WHERE t.campaign_id = $1
      ORDER BY
        CASE t.status
          WHEN 'todo' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'done' THEN 3
          ELSE 4
        END,
        t.due_date ASC NULLS LAST,
        t.updated_at DESC
      `,
      [campaignId]
    ),
    pool.query(
      `
      SELECT *
      FROM campaign_documents
      WHERE campaign_id = $1
      ORDER BY created_at DESC
      `,
      [campaignId]
    ),
    pool.query(
      `
      SELECT
        a.*,
        u.first_name AS actor_first_name,
        u.last_name AS actor_last_name
      FROM campaign_activity a
      LEFT JOIN app_users u ON u.id = a.actor_user_id
      WHERE a.campaign_id = $1
      ORDER BY a.created_at DESC
      LIMIT 50
      `,
      [campaignId]
    )
  ]);

  return {
    ...campaign,
    contacts: contacts.rows,
    vendors: vendors.rows,
    tasks: tasks.rows,
    documents: documents.rows,
    activity: activity.rows
  };
}

export async function addCampaignContact({
  campaign_id,
  full_name,
  email = null,
  phone = null,
  role = null,
  organization = null,
  notes = null
}) {
  const result = await pool.query(
    `
    INSERT INTO campaign_contacts (
      campaign_id, full_name, email, phone, role, organization, notes, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    RETURNING *
    `,
    [campaign_id, full_name, email, phone, role, organization, notes]
  );

  return result.rows[0];
}

export async function addCampaignVendor({
  campaign_id,
  vendor_name,
  category = null,
  status = "prospect",
  contract_value = 0,
  notes = null
}) {
  const result = await pool.query(
    `
    INSERT INTO campaign_vendors (
      campaign_id, vendor_name, category, status, contract_value, notes, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
    RETURNING *
    `,
    [campaign_id, vendor_name, category, status, Number(contract_value || 0), notes]
  );

  return result.rows[0];
}

export async function addCampaignTask({
  campaign_id,
  assigned_user_id = null,
  title,
  description = null,
  status = "todo",
  priority = "medium",
  due_date = null
}) {
  const result = await pool.query(
    `
    INSERT INTO campaign_tasks (
      campaign_id, assigned_user_id, title, description, status, priority, due_date, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    RETURNING *
    `,
    [campaign_id, assigned_user_id, title, description, status, priority, due_date]
  );

  return result.rows[0];
}

export async function addCampaignDocument({
  campaign_id,
  name,
  document_type = null,
  file_url = null,
  uploaded_by_user_id = null
}) {
  const result = await pool.query(
    `
    INSERT INTO campaign_documents (
      campaign_id, name, document_type, file_url, uploaded_by_user_id, created_at
    )
    VALUES ($1,$2,$3,$4,$5,NOW())
    RETURNING *
    `,
    [campaign_id, name, document_type, file_url, uploaded_by_user_id]
  );

  return result.rows[0];
}

export async function addCampaignActivity({
  campaign_id,
  actor_user_id = null,
  activity_type,
  summary,
  metadata = {}
}) {
  const result = await pool.query(
    `
    INSERT INTO campaign_activity (
      campaign_id, actor_user_id, activity_type, summary, metadata, created_at
    )
    VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
    RETURNING *
    `,
    [campaign_id, actor_user_id, activity_type, summary, JSON.stringify(metadata || {})]
  );

  return result.rows[0];
}
