import { pool } from "../db/pool.js";
import { ensureCrmTables } from "./crm.repository.js";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapStatusFromEventType(eventType = "") {
  const key = String(eventType).toLowerCase();

  if (key === "created") return "planned";
  if (key === "entered_usps") return "entered_usps";
  if (key === "in_transit") return "in_transit";
  if (key === "out_for_delivery") return "out_for_delivery";
  if (key === "delivered") return "delivered";
  if (key === "issue") return "issue";

  return null;
}

export async function ensureMailTables() {
  await ensureCrmTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_programs (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      program_name TEXT NOT NULL,
      mail_type TEXT,
      vendor_name TEXT,
      audience_name TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC(14,2) NOT NULL DEFAULT 0,
      expected_in_home_start DATE,
      expected_in_home_end DATE,
      drop_date DATE,
      status TEXT NOT NULL DEFAULT 'planned',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_tracking_events (
      id SERIAL PRIMARY KEY,
      mail_program_id INTEGER NOT NULL REFERENCES mail_programs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      location_name TEXT,
      event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_programs_campaign_id
    ON mail_programs(campaign_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_programs_status
    ON mail_programs(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_tracking_events_program_id
    ON mail_tracking_events(mail_program_id)
  `);
}

export async function createMailProgram(payload = {}) {
  await ensureMailTables();

  const result = await pool.query(
    `
    INSERT INTO mail_programs (
      campaign_id,
      program_name,
      mail_type,
      vendor_name,
      audience_name,
      quantity,
      budget,
      expected_in_home_start,
      expected_in_home_end,
      drop_date,
      status,
      notes
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
    )
    RETURNING *
    `,
    [
      Number(payload.campaign_id),
      payload.program_name,
      payload.mail_type || null,
      payload.vendor_name || null,
      payload.audience_name || null,
      toNumber(payload.quantity, 0),
      toNumber(payload.budget, 0),
      payload.expected_in_home_start || null,
      payload.expected_in_home_end || null,
      payload.drop_date || null,
      payload.status || "planned",
      payload.notes || null
    ]
  );

  return result.rows[0];
}

export async function addMailTrackingEvent(mailProgramId, payload = {}) {
  await ensureMailTables();

  const eventResult = await pool.query(
    `
    INSERT INTO mail_tracking_events (
      mail_program_id,
      event_type,
      location_name,
      event_timestamp,
      description,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    RETURNING *
    `,
    [
      Number(mailProgramId),
      payload.event_type,
      payload.location_name || null,
      payload.event_timestamp || new Date().toISOString(),
      payload.description || null,
      JSON.stringify(payload.metadata || {})
    ]
  );

  const nextStatus = mapStatusFromEventType(payload.event_type);
  if (nextStatus) {
    await pool.query(
      `
      UPDATE mail_programs
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [Number(mailProgramId), nextStatus]
    );
  } else {
    await pool.query(
      `
      UPDATE mail_programs
      SET updated_at = NOW()
      WHERE id = $1
      `,
      [Number(mailProgramId)]
    );
  }

  return eventResult.rows[0];
}

export async function getMailProgramById(id) {
  await ensureMailTables();

  const [programResult, eventsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        mp.*,
        c.campaign_name,
        c.candidate_name,
        c.state,
        c.office,
        c.party,
        c.firm_id,
        f.name AS firm_name
      FROM mail_programs mp
      INNER JOIN campaigns c ON c.id = mp.campaign_id
      LEFT JOIN firms f ON f.id = c.firm_id
      WHERE mp.id = $1
      `,
      [Number(id)]
    ),
    pool.query(
      `
      SELECT *
      FROM mail_tracking_events
      WHERE mail_program_id = $1
      ORDER BY event_timestamp DESC, id DESC
      `,
      [Number(id)]
    )
  ]);

  const program = programResult.rows[0];
  if (!program) return null;

  return {
    ...program,
    budget: toNumber(program.budget, 0),
    quantity: toNumber(program.quantity, 0),
    events: eventsResult.rows
  };
}

export async function listMailPrograms(filters = {}) {
  await ensureMailTables();

  const conditions = [];
  const values = [];
  let idx = 1;

  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`
      (
        mp.program_name ILIKE $${idx}
        OR COALESCE(mp.mail_type, '') ILIKE $${idx}
        OR COALESCE(mp.vendor_name, '') ILIKE $${idx}
        OR COALESCE(mp.audience_name, '') ILIKE $${idx}
        OR COALESCE(c.campaign_name, '') ILIKE $${idx}
        OR COALESCE(c.candidate_name, '') ILIKE $${idx}
      )
    `);
    idx += 1;
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`LOWER(COALESCE(mp.status, '')) = LOWER($${idx})`);
    idx += 1;
  }

  if (filters.state) {
    values.push(filters.state);
    conditions.push(`LOWER(COALESCE(c.state, '')) = LOWER($${idx})`);
    idx += 1;
  }

  if (filters.campaign_id) {
    values.push(Number(filters.campaign_id));
    conditions.push(`mp.campaign_id = $${idx}`);
    idx += 1;
  }

  if (filters.firm_id) {
    values.push(Number(filters.firm_id));
    conditions.push(`c.firm_id = $${idx}`);
    idx += 1;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.min(100, Math.max(1, Number(filters.limit || 25)));
  const offset = (page - 1) * limit;

  const [countResult, rowsResult] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM mail_programs mp
      INNER JOIN campaigns c ON c.id = mp.campaign_id
      ${whereClause}
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
        c.office,
        c.party,
        c.firm_id,
        f.name AS firm_name,
        (
          SELECT event_type
          FROM mail_tracking_events e
          WHERE e.mail_program_id = mp.id
          ORDER BY e.event_timestamp DESC, e.id DESC
          LIMIT 1
        ) AS latest_event_type,
        (
          SELECT event_timestamp
          FROM mail_tracking_events e
          WHERE e.mail_program_id = mp.id
          ORDER BY e.event_timestamp DESC, e.id DESC
          LIMIT 1
        ) AS latest_event_timestamp
      FROM mail_programs mp
      INNER JOIN campaigns c ON c.id = mp.campaign_id
      LEFT JOIN firms f ON f.id = c.firm_id
      ${whereClause}
      ORDER BY mp.updated_at DESC, mp.id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
      `,
      [...values, limit, offset]
    )
  ]);

  return {
    page,
    limit,
    total: countResult.rows[0]?.total || 0,
    results: rowsResult.rows.map((row) => ({
      ...row,
      budget: toNumber(row.budget, 0),
      quantity: toNumber(row.quantity, 0)
    }))
  };
}

export async function getMailDashboard(filters = {}) {
  await ensureMailTables();

  const conditions = [];
  const values = [];
  let idx = 1;

  if (filters.firm_id) {
    values.push(Number(filters.firm_id));
    conditions.push(`c.firm_id = $${idx}`);
    idx += 1;
  }

  if (filters.campaign_id) {
    values.push(Number(filters.campaign_id));
    conditions.push(`mp.campaign_id = $${idx}`);
    idx += 1;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [summaryResult, programsResult, eventsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(*)::int AS total_programs,
        COUNT(*) FILTER (WHERE LOWER(mp.status) IN ('planned','entered_usps','in_transit','out_for_delivery'))::int AS active_programs,
        COUNT(*) FILTER (WHERE LOWER(mp.status) = 'delivered')::int AS delivered_programs,
        COUNT(*) FILTER (WHERE LOWER(mp.status) = 'issue')::int AS issue_programs,
        COALESCE(SUM(mp.budget), 0)::numeric AS total_budget,
        COALESCE(SUM(mp.quantity), 0)::bigint AS total_quantity
      FROM mail_programs mp
      INNER JOIN campaigns c ON c.id = mp.campaign_id
      ${whereClause}
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
      ORDER BY mp.updated_at DESC, mp.id DESC
      LIMIT 12
      `,
      values
    ),
    pool.query(
      `
      SELECT
        e.*,
        mp.program_name,
        mp.status AS program_status,
        c.campaign_name,
        c.candidate_name,
        c.state
      FROM mail_tracking_events e
      INNER JOIN mail_programs mp ON mp.id = e.mail_program_id
      INNER JOIN campaigns c ON c.id = mp.campaign_id
      ${whereClause.replace(/mp\./g, "mp.")}
      ORDER BY e.event_timestamp DESC, e.id DESC
      LIMIT 20
      `,
      values
    )
  ]);

  const summary = summaryResult.rows[0] || {};

  return {
    metrics: [
      {
        label: "Mail Programs",
        value: `${toNumber(summary.total_programs, 0)}`,
        delta: "Tracked programs",
        tone: "up"
      },
      {
        label: "Active Drops",
        value: `${toNumber(summary.active_programs, 0)}`,
        delta: "In motion",
        tone: "up"
      },
      {
        label: "Delivered",
        value: `${toNumber(summary.delivered_programs, 0)}`,
        delta: "Completed",
        tone: "up"
      },
      {
        label: "Issues",
        value: `${toNumber(summary.issue_programs, 0)}`,
        delta: "Needs attention",
        tone: toNumber(summary.issue_programs, 0) > 0 ? "alert" : "up"
      }
    ],
    summary: {
      total_programs: toNumber(summary.total_programs, 0),
      active_programs: toNumber(summary.active_programs, 0),
      delivered_programs: toNumber(summary.delivered_programs, 0),
      issue_programs: toNumber(summary.issue_programs, 0),
      total_budget: toNumber(summary.total_budget, 0),
      total_quantity: toNumber(summary.total_quantity, 0)
    },
    recent_programs: programsResult.rows.map((row) => ({
      ...row,
      budget: toNumber(row.budget, 0),
      quantity: toNumber(row.quantity, 0)
    })),
    recent_events: eventsResult.rows
  };
}

export async function getCampaignMailTracking(campaignId) {
  await ensureMailTables();

  const [campaignResult, dashboard] = await Promise.all([
    pool.query(
      `
      SELECT *
      FROM campaigns
      WHERE id = $1
      `,
      [Number(campaignId)]
    ),
    getMailDashboard({ campaign_id: Number(campaignId) })
  ]);

  const campaign = campaignResult.rows[0];
  if (!campaign) return null;

  const programs = await listMailPrograms({
    campaign_id: Number(campaignId),
    page: 1,
    limit: 100
  });

  return {
    campaign,
    metrics: dashboard.metrics,
    summary: dashboard.summary,
    programs: programs.results,
    recent_events: dashboard.recent_events
  };
}
