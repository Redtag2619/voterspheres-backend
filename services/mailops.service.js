import pool from "../db.js";

function getFirmIdFromUser(user) {
  return (
    user?.firm_id ||
    user?.firmId ||
    user?.firm?.id ||
    null
  );
}

function normalizeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildUpdateQuery(table, idField, idValue, firmId, payload) {
  const allowedFields = [
    "campaign_name",
    "client_name",
    "office_sought",
    "election_date",
    "state",
    "district",
    "mail_class",
    "format",
    "drop_date",
    "in_home_date",
    "quantity",
    "pieces_mailed",
    "status",
    "tracking_number",
    "postage_method",
    "production_vendor",
    "consultant_name",
    "notes",
    "updated_by",
  ];

  const keys = Object.keys(payload).filter((key) => allowedFields.includes(key));

  if (!keys.length) {
    return {
      text: "",
      values: [],
    };
  }

  const sets = keys.map((key, index) => `${key} = $${index + 1}`);
  const values = keys.map((key) => payload[key]);

  values.push(idValue);
  values.push(firmId);

  const text = `
    UPDATE ${table}
    SET
      ${sets.join(", ")},
      updated_at = NOW()
    WHERE ${idField} = $${values.length - 1}
      AND firm_id = $${values.length}
    RETURNING *
  `;

  return { text, values };
}

export async function getMailOpsDashboard(user) {
  const firmId = getFirmIdFromUser(user);

  if (!firmId) {
    throw new Error("No firm_id found on authenticated user.");
  }

  const summaryQuery = `
    SELECT
      COUNT(*)::int AS total_events,
      COUNT(*) FILTER (WHERE status = 'Draft')::int AS draft_count,
      COUNT(*) FILTER (WHERE status = 'Scheduled')::int AS scheduled_count,
      COUNT(*) FILTER (WHERE status = 'In Production')::int AS in_production_count,
      COUNT(*) FILTER (WHERE status = 'Dropped')::int AS dropped_count,
      COUNT(*) FILTER (WHERE status = 'In Home')::int AS in_home_count,
      COALESCE(SUM(quantity), 0)::int AS total_quantity,
      COALESCE(SUM(pieces_mailed), 0)::int AS total_pieces_mailed
    FROM mail_events
    WHERE firm_id = $1
  `;

  const upcomingQuery = `
    SELECT
      id,
      campaign_name,
      client_name,
      office_sought,
      election_date,
      state,
      district,
      mail_class,
      format,
      drop_date,
      in_home_date,
      quantity,
      pieces_mailed,
      status,
      tracking_number,
      postage_method,
      production_vendor,
      consultant_name,
      notes,
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM mail_events
    WHERE firm_id = $1
    ORDER BY
      COALESCE(in_home_date, drop_date, election_date, created_at) ASC,
      id DESC
    LIMIT 10
  `;

  const statusBreakdownQuery = `
    SELECT
      status,
      COUNT(*)::int AS count
    FROM mail_events
    WHERE firm_id = $1
    GROUP BY status
    ORDER BY count DESC, status ASC
  `;

  const recentActivityQuery = `
    SELECT
      id,
      campaign_name,
      status,
      drop_date,
      in_home_date,
      quantity,
      pieces_mailed,
      updated_at
    FROM mail_events
    WHERE firm_id = $1
    ORDER BY updated_at DESC
    LIMIT 8
  `;

  const [summaryResult, upcomingResult, statusBreakdownResult, recentActivityResult] =
    await Promise.all([
      pool.query(summaryQuery, [firmId]),
      pool.query(upcomingQuery, [firmId]),
      pool.query(statusBreakdownQuery, [firmId]),
      pool.query(recentActivityQuery, [firmId]),
    ]);

  return {
    summary: summaryResult.rows[0] || {
      total_events: 0,
      draft_count: 0,
      scheduled_count: 0,
      in_production_count: 0,
      dropped_count: 0,
      in_home_count: 0,
      total_quantity: 0,
      total_pieces_mailed: 0,
    },
    upcoming_events: upcomingResult.rows || [],
    status_breakdown: statusBreakdownResult.rows || [],
    recent_activity: recentActivityResult.rows || [],
    demo: false,
  };
}

export async function createMailEvent(user, body) {
  const firmId = getFirmIdFromUser(user);

  if (!firmId) {
    throw new Error("No firm_id found on authenticated user.");
  }

  const campaignName = body?.campaign_name?.trim();

  if (!campaignName) {
    const error = new Error("campaign_name is required.");
    error.statusCode = 400;
    throw error;
  }

  const quantity = normalizeInteger(body.quantity, 0);
  const piecesMailed = normalizeInteger(body.pieces_mailed, 0);

  const insertQuery = `
    INSERT INTO mail_events (
      firm_id,
      campaign_name,
      client_name,
      office_sought,
      election_date,
      state,
      district,
      mail_class,
      format,
      drop_date,
      in_home_date,
      quantity,
      pieces_mailed,
      status,
      tracking_number,
      postage_method,
      production_vendor,
      consultant_name,
      notes,
      created_by,
      updated_by
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
    )
    RETURNING *
  `;

  const values = [
    firmId,
    campaignName,
    body.client_name || null,
    body.office_sought || null,
    body.election_date || null,
    body.state || null,
    body.district || null,
    body.mail_class || "Standard",
    body.format || null,
    body.drop_date || null,
    body.in_home_date || null,
    quantity,
    piecesMailed,
    body.status || "Draft",
    body.tracking_number || null,
    body.postage_method || null,
    body.production_vendor || null,
    body.consultant_name || null,
    body.notes || null,
    user?.id || null,
    user?.id || null,
  ];

  const result = await pool.query(insertQuery, values);
  return result.rows[0];
}

export async function updateMailEvent(user, eventId, body) {
  const firmId = getFirmIdFromUser(user);

  if (!firmId) {
    throw new Error("No firm_id found on authenticated user.");
  }

  const parsedId = Number(eventId);

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    const error = new Error("Invalid event id.");
    error.statusCode = 400;
    throw error;
  }

  const updatePayload = {};

  const fields = [
    "campaign_name",
    "client_name",
    "office_sought",
    "election_date",
    "state",
    "district",
    "mail_class",
    "format",
    "drop_date",
    "in_home_date",
    "status",
    "tracking_number",
    "postage_method",
    "production_vendor",
    "consultant_name",
    "notes",
  ];

  for (const field of fields) {
    if (body[field] !== undefined) {
      updatePayload[field] = body[field] === "" ? null : body[field];
    }
  }

  if (body.quantity !== undefined) {
    updatePayload.quantity = normalizeInteger(body.quantity, 0);
  }

  if (body.pieces_mailed !== undefined) {
    updatePayload.pieces_mailed = normalizeInteger(body.pieces_mailed, 0);
  }

  if (body.campaign_name !== undefined && !String(body.campaign_name).trim()) {
    const error = new Error("campaign_name cannot be empty.");
    error.statusCode = 400;
    throw error;
  }

  updatePayload.updated_by = user?.id || null;

  const query = buildUpdateQuery(
    "mail_events",
    "id",
    parsedId,
    firmId,
    updatePayload
  );

  if (!query.text) {
    const error = new Error("No valid fields provided for update.");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(query.text, query.values);

  if (!result.rows.length) {
    const error = new Error("Mail event not found.");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}
