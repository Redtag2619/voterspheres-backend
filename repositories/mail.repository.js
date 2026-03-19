import { pool } from "../db/pool.js";
import { ensureCrmTables } from "./crm.repository.js";

export async function ensureMailTables() {
  await ensureCrmTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_programs (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      vendor_name TEXT,
      mail_type TEXT,
      target_universe TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC(14,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      in_home_start DATE,
      in_home_end DATE,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_drops (
      id SERIAL PRIMARY KEY,
      program_id INTEGER NOT NULL REFERENCES mail_programs(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      drop_name TEXT NOT NULL,
      drop_date DATE,
      entered_at DATE,
      usps_entry_facility TEXT,
      region TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      expected_delivery_start DATE,
      expected_delivery_end DATE,
      actual_delivery_date DATE,
      status TEXT NOT NULL DEFAULT 'planned',
      tracking_status TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_tracking_events (
      id SERIAL PRIMARY KEY,
      drop_id INTEGER NOT NULL REFERENCES mail_drops(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_label TEXT NOT NULL,
      facility TEXT,
      event_time TIMESTAMP,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_programs_campaign_id
      ON mail_programs(campaign_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_drops_campaign_id
      ON mail_drops(campaign_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_drops_program_id
      ON mail_drops(program_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_tracking_events_drop_id
      ON mail_tracking_events(drop_id);
  `);
}

export async function createMailProgram(data) {
  await ensureMailTables();

  const result = await pool.query(
    `
    INSERT INTO mail_programs (
      campaign_id,
      name,
      vendor_name,
      mail_type,
      target_universe,
      quantity,
      budget,
      status,
      in_home_start,
      in_home_end,
      notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
    `,
    [
      data.campaign_id,
      data.name,
      data.vendor_name || null,
      data.mail_type || null,
      data.target_universe || null,
      Number(data.quantity || 0),
      Number(data.budget || 0),
      data.status || "draft",
      data.in_home_start || null,
      data.in_home_end || null,
      data.notes || null
    ]
  );

  return result.rows[0];
}

export async function listMailPrograms(filters = {}) {
  await ensureMailTables();

  const conditions = [];
  const values = [];
  let index = 1;

  if (filters.campaign_id) {
    conditions.push(`mp.campaign_id = $${index++}`);
    values.push(Number(filters.campaign_id));
  }

  if (filters.firm_id) {
    conditions.push(`c.firm_id = $${index++}`);
    values.push(Number(filters.firm_id));
  }

  if (filters.status) {
    conditions.push(`LOWER(COALESCE(mp.status,'')) = LOWER($${index++})`);
    values.push(filters.status);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
    SELECT
      mp.*,
      c.campaign_name,
      c.candidate_name,
      c.state,
      c.office,
      f.name AS firm_name
    FROM mail_programs mp
    INNER JOIN campaigns c ON c.id = mp.campaign_id
    LEFT JOIN firms f ON f.id = c.firm_id
    ${whereClause}
    ORDER BY mp.updated_at DESC, mp.created_at DESC, mp.id DESC
    `,
    values
  );

  return result.rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity || 0),
    budget: Number(row.budget || 0)
  }));
}

export async function getMailProgramById(id) {
  await ensureMailTables();

  const result = await pool.query(
    `
    SELECT
      mp.*,
      c.campaign_name,
      c.candidate_name,
      c.state,
      c.office,
      f.name AS firm_name
    FROM mail_programs mp
    INNER JOIN campaigns c ON c.id = mp.campaign_id
    LEFT JOIN firms f ON f.id = c.firm_id
    WHERE mp.id = $1
    `,
    [Number(id)]
  );

  return result.rows[0] || null;
}

export async function createMailDrop(data) {
  await ensureMailTables();

  const result = await pool.query(
    `
    INSERT INTO mail_drops (
      program_id,
      campaign_id,
      drop_name,
      drop_date,
      entered_at,
      usps_entry_facility,
      region,
      quantity,
      expected_delivery_start,
      expected_delivery_end,
      actual_delivery_date,
      status,
      tracking_status,
      notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
    `,
    [
      Number(data.program_id),
      Number(data.campaign_id),
      data.drop_name,
      data.drop_date || null,
      data.entered_at || null,
      data.usps_entry_facility || null,
      data.region || null,
      Number(data.quantity || 0),
      data.expected_delivery_start || null,
      data.expected_delivery_end || null,
      data.actual_delivery_date || null,
      data.status || "planned",
      data.tracking_status || null,
      data.notes || null
    ]
  );

  return result.rows[0];
}

export async function listMailDrops(filters = {}) {
  await ensureMailTables();

  const conditions = [];
  const values = [];
  let index = 1;

  if (filters.program_id) {
    conditions.push(`md.program_id = $${index++}`);
    values.push(Number(filters.program_id));
  }

  if (filters.campaign_id) {
    conditions.push(`md.campaign_id = $${index++}`);
    values.push(Number(filters.campaign_id));
  }

  if (filters.firm_id) {
    conditions.push(`c.firm_id = $${index++}`);
    values.push(Number(filters.firm_id));
  }

  if (filters.status) {
    conditions.push(`LOWER(COALESCE(md.status,'')) = LOWER($${index++})`);
    values.push(filters.status);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
    SELECT
      md.*,
      mp.name AS program_name,
      mp.mail_type,
      mp.vendor_name,
      c.campaign_name,
      c.candidate_name,
      c.state,
      c.office,
      f.name AS firm_name
    FROM mail_drops md
    INNER JOIN mail_programs mp ON mp.id = md.program_id
    INNER JOIN campaigns c ON c.id = md.campaign_id
    LEFT JOIN firms f ON f.id = c.firm_id
    ${whereClause}
    ORDER BY md.updated_at DESC, md.created_at DESC, md.id DESC
    `,
    values
  );

  return result.rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity || 0)
  }));
}

export async function createMailTrackingEvent(data) {
  await ensureMailTables();

  const result = await pool.query(
    `
    INSERT INTO mail_tracking_events (
      drop_id,
      event_type,
      event_label,
      facility,
      event_time,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
    `,
    [
      Number(data.drop_id),
      data.event_type,
      data.event_label,
      data.facility || null,
      data.event_time || null,
      data.metadata || {}
    ]
  );

  return result.rows[0];
}

export async function listMailTrackingEvents(dropId) {
  await ensureMailTables();

  const result = await pool.query(
    `
    SELECT *
    FROM mail_tracking_events
    WHERE drop_id = $1
    ORDER BY event_time ASC NULLS LAST, created_at ASC
    `,
    [Number(dropId)]
  );

  return result.rows;
}

export async function getMailDashboard(filters = {}) {
  await ensureMailTables();

  const conditions = [];
  const values = [];
  let index = 1;

  if (filters.firm_id) {
    conditions.push(`c.firm_id = $${index++}`);
    values.push(Number(filters.firm_id));
  }

  if (filters.campaign_id) {
    conditions.push(`c.id = $${index++}`);
    values.push(Number(filters.campaign_id));
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [summaryResult, recentDropsResult, programResult] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(DISTINCT mp.id)::int AS programs,
        COUNT(DISTINCT md.id)::int AS drops,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(md.status,'')) = 'in_transit')::int AS in_transit,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(md.status,'')) = 'delivered')::int AS delivered,
        COALESCE(SUM(md.quantity), 0)::bigint AS total_quantity,
        COALESCE(SUM(mp.budget), 0)::numeric AS total_budget
      FROM campaigns c
      LEFT JOIN mail_programs mp ON mp.campaign_id = c.id
      LEFT JOIN mail_drops md ON md.program_id = mp.id
      ${whereClause}
      `,
      values
    ),
    pool.query(
      `
      SELECT
        md.*,
        mp.name AS program_name,
        mp.mail_type,
        mp.vendor_name,
        c.campaign_name,
        c.candidate_name,
        c.state,
        f.name AS firm_name
      FROM mail_drops md
      INNER JOIN mail_programs mp ON mp.id = md.program_id
      INNER JOIN campaigns c ON c.id = md.campaign_id
      LEFT JOIN firms f ON f.id = c.firm_id
      ${whereClause}
      ORDER BY md.updated_at DESC, md.created_at DESC
      LIMIT 12
      `,
      values
    ),
    pool.query(
      `
      SELECT
        mp.*,
        c.campaign_name,
        c.candidate_name,
        c.state,
        f.name AS firm_name
      FROM mail_programs mp
      INNER JOIN campaigns c ON c.id = mp.campaign_id
      LEFT JOIN firms f ON f.id = c.firm_id
      ${whereClause}
      ORDER BY mp.updated_at DESC, mp.created_at DESC
      LIMIT 12
      `,
      values
    )
  ]);

  const summary = summaryResult.rows[0] || {};

  return {
    summary: {
      programs: Number(summary.programs || 0),
      drops: Number(summary.drops || 0),
      in_transit: Number(summary.in_transit || 0),
      delivered: Number(summary.delivered || 0),
      total_quantity: Number(summary.total_quantity || 0),
      total_budget: Number(summary.total_budget || 0)
    },
    recent_drops: recentDropsResult.rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0)
    })),
    recent_programs: programResult.rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      budget: Number(row.budget || 0)
    }))
  };
}

export async function getCampaignMailWorkspace(campaignId) {
  await ensureMailTables();

  const [programs, drops] = await Promise.all([
    listMailPrograms({ campaign_id: campaignId }),
    listMailDrops({ campaign_id: campaignId })
  ]);

  return {
    programs,
    drops
  };
}
