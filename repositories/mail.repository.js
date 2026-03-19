import { pool } from "../db/pool.js";
import { ensureCrmTables } from "./crm.repository.js";

export async function ensureMailTables() {
  await ensureCrmTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_programs (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mail_type TEXT,
      target_universe TEXT,
      budget NUMERIC(14,2) DEFAULT 0,
      planned_drops INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_drops (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      mail_program_id INTEGER REFERENCES mail_programs(id) ON DELETE SET NULL,
      drop_name TEXT,
      vendor_name TEXT,
      quantity INTEGER DEFAULT 0,
      region TEXT,
      drop_date DATE,
      expected_delivery_window TEXT,
      status TEXT DEFAULT 'scheduled',
      tracking_status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_tracking_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      mail_drop_id INTEGER NOT NULL REFERENCES mail_drops(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      status TEXT,
      location_name TEXT,
      facility_type TEXT,
      event_time TIMESTAMP,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_programs_campaign_id
    ON mail_programs(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_drops_campaign_id
    ON mail_drops(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_drops_program_id
    ON mail_drops(mail_program_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_tracking_events_drop_id
    ON mail_tracking_events(mail_drop_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_tracking_events_campaign_id
    ON mail_tracking_events(campaign_id)
  `);
}

export async function createMailProgram({
  campaign_id,
  name,
  mail_type,
  target_universe,
  budget,
  planned_drops,
  status
}) {
  await ensureMailTables();

  const result = await pool.query(
    `
    INSERT INTO mail_programs (
      campaign_id,
      name,
      mail_type,
      target_universe,
      budget,
      planned_drops,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      campaign_id,
      name,
      mail_type || null,
      target_universe || null,
      Number(budget || 0),
      Number(planned_drops || 0),
      status || "draft"
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
    values.push(Number(filters.campaign_id));
    conditions.push(`mp.campaign_id = $${index}`);
    index += 1;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
    SELECT
      mp.*,
      c.campaign_name,
      c.candidate_name,
      c.state
    FROM mail_programs mp
    INNER JOIN campaigns c ON c.id = mp.campaign_id
    ${whereClause}
    ORDER BY mp.updated_at DESC, mp.created_at DESC, mp.id DESC
    `,
    values
  );

  return result.rows;
}

export async function createMailDrop({
  campaign_id,
  mail_program_id,
  drop_name,
  vendor_name,
  quantity,
  region,
  drop_date,
  expected_delivery_window,
  status,
  tracking_status
}) {
  await ensureMailTables();

  const result = await pool.query(
    `
    INSERT INTO mail_drops (
      campaign_id,
      mail_program_id,
      drop_name,
      vendor_name,
      quantity,
      region,
      drop_date,
      expected_delivery_window,
      status,
      tracking_status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
    `,
    [
      Number(campaign_id),
      mail_program_id ? Number(mail_program_id) : null,
      drop_name || null,
      vendor_name || null,
      Number(quantity || 0),
      region || null,
      drop_date || null,
      expected_delivery_window || null,
      status || "scheduled",
      tracking_status || "pending"
    ]
  );

  return result.rows[0];
}

export async function listMailDrops(filters = {}) {
  await ensureMailTables();

  const conditions = [];
  const values = [];
  let index = 1;

  if (filters.campaign_id) {
    values.push(Number(filters.campaign_id));
    conditions.push(`md.campaign_id = $${index}`);
    index += 1;
  }

  if (filters.mail_program_id) {
    values.push(Number(filters.mail_program_id));
    conditions.push(`md.mail_program_id = $${index}`);
    index += 1;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
    SELECT
      md.*,
      c.campaign_name,
      c.candidate_name,
      mp.name AS program_name
    FROM mail_drops md
    INNER JOIN campaigns c ON c.id = md.campaign_id
    LEFT JOIN mail_programs mp ON mp.id = md.mail_program_id
    ${whereClause}
    ORDER BY md.updated_at DESC, md.created_at DESC, md.id DESC
    `,
    values
  );

  return result.rows;
}

export async function createMailTrackingEvent({
  campaign_id,
  mail_drop_id,
  event_type,
  status,
  location_name,
  facility_type,
  event_time,
  notes,
  source
}) {
  await ensureMailTables();

  const inserted = await pool.query(
    `
    INSERT INTO mail_tracking_events (
      campaign_id,
      mail_drop_id,
      event_type,
      status,
      location_name,
      facility_type,
      event_time,
      notes,
      source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
    `,
    [
      Number(campaign_id),
      Number(mail_drop_id),
      event_type,
      status || null,
      location_name || null,
      facility_type || null,
      event_time || new Date().toISOString(),
      notes || null,
      source || "manual"
    ]
  );

  const event = inserted.rows[0];

  await pool.query(
    `
    UPDATE mail_drops
    SET
      tracking_status = COALESCE($2, tracking_status),
      status = CASE
        WHEN $1 = 'delivered' THEN 'delivered'
        WHEN $1 = 'out_for_delivery' THEN status
        WHEN $1 = 'in_transit' THEN status
        WHEN $1 = 'entered_usps' THEN status
        ELSE status
      END,
      updated_at = NOW()
    WHERE id = $3
    `,
    [event.event_type, event.status || event.event_type, Number(mail_drop_id)]
  );

  return event;
}

export async function getMailDropTimeline(mail_drop_id) {
  await ensureMailTables();

  const result = await pool.query(
    `
    SELECT
      mte.*,
      md.drop_name,
      md.vendor_name,
      md.region,
      md.drop_date,
      md.expected_delivery_window,
      md.tracking_status,
      c.campaign_name,
      c.candidate_name
    FROM mail_tracking_events mte
    INNER JOIN mail_drops md ON md.id = mte.mail_drop_id
    INNER JOIN campaigns c ON c.id = mte.campaign_id
    WHERE mte.mail_drop_id = $1
    ORDER BY COALESCE(mte.event_time, mte.created_at) DESC, mte.id DESC
    `,
    [Number(mail_drop_id)]
  );

  return result.rows;
}

export async function getCampaignMailTimeline(campaign_id) {
  await ensureMailTables();

  const result = await pool.query(
    `
    SELECT
      mte.*,
      md.drop_name,
      md.vendor_name,
      md.region,
      md.drop_date,
      md.expected_delivery_window,
      md.tracking_status,
      c.campaign_name,
      c.candidate_name
    FROM mail_tracking_events mte
    INNER JOIN mail_drops md ON md.id = mte.mail_drop_id
    INNER JOIN campaigns c ON c.id = mte.campaign_id
    WHERE mte.campaign_id = $1
    ORDER BY COALESCE(mte.event_time, mte.created_at) DESC, mte.id DESC
    `,
    [Number(campaign_id)]
  );

  return result.rows;
}

export async function getPlatformMailTimeline(limit = 50) {
  await ensureMailTables();

  const result = await pool.query(
    `
    SELECT
      mte.*,
      md.drop_name,
      md.vendor_name,
      md.region,
      md.drop_date,
      md.expected_delivery_window,
      md.tracking_status,
      c.campaign_name,
      c.candidate_name
    FROM mail_tracking_events mte
    INNER JOIN mail_drops md ON md.id = mte.mail_drop_id
    INNER JOIN campaigns c ON c.id = mte.campaign_id
    ORDER BY COALESCE(mte.event_time, mte.created_at) DESC, mte.id DESC
    LIMIT $1
    `,
    [Number(limit)]
  );

  return result.rows;
}

export async function getMailDashboard() {
  await ensureMailTables();

  const [summaryResult, programsResult, dropsResult, timelineResult] =
    await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM mail_programs) AS programs,
          (SELECT COUNT(*)::int FROM mail_drops) AS drops,
          (SELECT COALESCE(SUM(budget),0)::numeric FROM mail_programs) AS total_budget,
          (SELECT COALESCE(SUM(quantity),0)::bigint FROM mail_drops) AS total_quantity
      `),
      pool.query(`
        SELECT
          mp.*,
          c.campaign_name,
          c.candidate_name
        FROM mail_programs mp
        INNER JOIN campaigns c ON c.id = mp.campaign_id
        ORDER BY mp.updated_at DESC, mp.created_at DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT
          md.*,
          c.campaign_name,
          c.candidate_name,
          mp.name AS program_name
        FROM mail_drops md
        INNER JOIN campaigns c ON c.id = md.campaign_id
        LEFT JOIN mail_programs mp ON mp.id = md.mail_program_id
        ORDER BY md.updated_at DESC, md.created_at DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT
          mte.*,
          md.drop_name,
          md.vendor_name,
          md.region,
          md.tracking_status,
          c.campaign_name,
          c.candidate_name
        FROM mail_tracking_events mte
        INNER JOIN mail_drops md ON md.id = mte.mail_drop_id
        INNER JOIN campaigns c ON c.id = mte.campaign_id
        ORDER BY COALESCE(mte.event_time, mte.created_at) DESC, mte.id DESC
        LIMIT 25
      `)
    ]);

  return {
    summary: {
      programs: Number(summaryResult.rows[0]?.programs || 0),
      drops: Number(summaryResult.rows[0]?.drops || 0),
      total_budget: Number(summaryResult.rows[0]?.total_budget || 0),
      total_quantity: Number(summaryResult.rows[0]?.total_quantity || 0)
    },
    programs: programsResult.rows,
    drops: dropsResult.rows,
    timeline: timelineResult.rows
  };
}
