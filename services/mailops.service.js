import pool from "../db.js";

async function resolveFirmId(user) {
  const directFirmId =
    user?.firm_id ||
    user?.firmId ||
    user?.firm?.id ||
    null;

  if (directFirmId) {
    return Number(directFirmId);
  }

  if (!user?.id) {
    const error = new Error("No authenticated user found.");
    error.statusCode = 401;
    throw error;
  }

  const result = await pool.query(
    `
      SELECT firm_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [user.id]
  );

  const firmId = result.rows?.[0]?.firm_id || null;

  if (!firmId) {
    const error = new Error("No firm_id found for authenticated user.");
    error.statusCode = 400;
    throw error;
  }

  return Number(firmId);
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredString(value, fieldName) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function buildUpdateQuery(eventId, firmId, payload) {
  const allowedFields = [
    "campaign",
    "state",
    "office",
    "risk",
    "location",
    "vendor_name",
    "event_type",
    "status",
    "severity",
    "event_time",
    "in_home",
    "note",
  ];

  const keys = Object.keys(payload).filter((key) => allowedFields.includes(key));

  if (!keys.length) {
    return { text: "", values: [] };
  }

  const setClauses = keys.map((key, index) => `${key} = $${index + 1}`);
  const values = keys.map((key) => payload[key]);

  values.push(eventId);
  values.push(firmId);

  return {
    text: `
      UPDATE mailops_events
      SET
        ${setClauses.join(", ")},
        updated_at = NOW()
      WHERE id = $${values.length - 1}
        AND firm_id = $${values.length}
      RETURNING *
    `,
    values,
  };
}

function toMetric(label, value, delta, tone = "up") {
  return { label, value: String(value), delta, tone };
}

export async function getMailOpsDashboard(user) {
  const firmId = await resolveFirmId(user);

  const eventsQuery = `
    SELECT
      id,
      campaign,
      state,
      office,
      risk,
      location,
      vendor_name,
      event_type,
      status,
      severity,
      event_time,
      in_home,
      note,
      created_by_user_id,
      created_at,
      updated_at
    FROM mailops_events
    WHERE firm_id = $1
    ORDER BY COALESCE(in_home, event_time, created_at) ASC, id DESC
  `;

  const alertsQuery = `
    SELECT
      id,
      campaign,
      state,
      office,
      risk,
      location,
      severity,
      status,
      note,
      event_time
    FROM mailops_events
    WHERE firm_id = $1
      AND (
        LOWER(COALESCE(severity, '')) IN ('high', 'medium')
        OR LOWER(COALESCE(risk, '')) IN ('elevated', 'watch')
        OR LOWER(COALESCE(status, '')) IN ('elevated', 'delayed', 'watch')
      )
    ORDER BY
      CASE
        WHEN LOWER(COALESCE(severity, '')) = 'high' THEN 3
        WHEN LOWER(COALESCE(severity, '')) = 'medium' THEN 2
        WHEN LOWER(COALESCE(severity, '')) = 'low' THEN 1
        ELSE 0
      END DESC,
      id DESC
    LIMIT 10
  `;

  const [eventsResult, alertsResult] = await Promise.all([
    pool.query(eventsQuery, [firmId]),
    pool.query(alertsQuery, [firmId]),
  ]);

  const events = eventsResult.rows || [];
  const alertRows = alertsResult.rows || [];

  const totalDrops = events.length;
  const elevatedCount = events.filter((row) =>
    ["elevated", "watch"].includes(String(row.risk || "").toLowerCase()) ||
    ["elevated", "delayed", "watch"].includes(String(row.status || "").toLowerCase())
  ).length;

  const highSeverityCount = events.filter(
    (row) => String(row.severity || "").toLowerCase() === "high"
  ).length;

  const onTrackCount = events.filter(
    (row) => String(row.status || "").toLowerCase() === "on track"
  ).length;

  const onTimeRate =
    totalDrops > 0 ? `${Math.round((onTrackCount / totalDrops) * 100)}%` : "0%";

  const metrics = [
    toMetric(
      "Mail Drops",
      totalDrops,
      totalDrops ? `${totalDrops} active today` : "No active drops",
      "up"
    ),
    toMetric(
      "Delivery Risk",
      elevatedCount,
      elevatedCount ? `${elevatedCount} elevated` : "No elevated risks",
      elevatedCount ? "down" : "up"
    ),
    toMetric(
      "Postal Alerts",
      alertRows.length,
      highSeverityCount ? `${highSeverityCount} high severity` : "No high severity",
      "up"
    ),
    toMetric(
      "On-Time Rate",
      onTimeRate,
      onTrackCount ? `${onTrackCount} on track` : "No on-track drops yet",
      "up"
    ),
  ];

  const drops = events.slice(0, 25).map((row) => ({
    id: row.id,
    campaign: row.campaign,
    state: row.state,
    office: row.office,
    risk: row.risk,
    location: row.location,
    status: row.status,
    in_home: row.in_home,
    note: row.note,
  }));

  const alerts = alertRows.map((row) => ({
    id: row.id,
    title: `${row.campaign} • ${row.location}`,
    severity: row.severity || "Medium",
    source: "MailOps Event",
    detail: row.note || "No additional detail provided.",
    state: row.state,
    office: row.office,
    risk: row.risk,
  }));

  return {
    metrics,
    drops,
    alerts,
    demo: false,
  };
}

export async function createMailOpsEvent(user, body) {
  const firmId = await resolveFirmId(user);

  const campaign = normalizeRequiredString(body?.campaign, "campaign");
  const state = normalizeRequiredString(body?.state, "state");
  const office = normalizeRequiredString(body?.office, "office");
  const location = normalizeRequiredString(body?.location, "location");

  const risk = normalizeNullableString(body?.risk);
  const vendorName = normalizeNullableString(body?.vendor_name);
  const eventType = normalizeNullableString(body?.event_type) || "mail_update";
  const status = normalizeNullableString(body?.status) || "Pending";
  const severity = normalizeNullableString(body?.severity) || "Medium";
  const eventTime = body?.event_time || null;
  const inHome = body?.in_home || null;
  const note = normalizeNullableString(body?.note);

  const result = await pool.query(
    `
      INSERT INTO mailops_events (
        firm_id,
        campaign,
        state,
        office,
        risk,
        location,
        vendor_name,
        event_type,
        status,
        severity,
        event_time,
        in_home,
        note,
        created_by_user_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        COALESCE($11, NOW()),
        $12,
        $13,
        $14
      )
      RETURNING *
    `,
    [
      firmId,
      campaign,
      state,
      office,
      risk,
      location,
      vendorName,
      eventType,
      status,
      severity,
      eventTime,
      inHome,
      note,
      user?.id || null,
    ]
  );

  return {
    ok: true,
    event: result.rows[0],
  };
}

export async function updateMailOpsEvent(user, eventId, body) {
  const firmId = await resolveFirmId(user);
  const parsedId = Number(eventId);

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    const error = new Error("Invalid event id");
    error.statusCode = 400;
    throw error;
  }

  const payload = {};

  const fieldMap = [
    "campaign",
    "state",
    "office",
    "risk",
    "location",
    "vendor_name",
    "event_type",
    "status",
    "severity",
    "event_time",
    "in_home",
    "note",
  ];

  for (const field of fieldMap) {
    if (body[field] !== undefined) {
      if (["campaign", "state", "office", "location"].includes(field)) {
        payload[field] = normalizeRequiredString(body[field], field);
      } else {
        payload[field] = normalizeNullableString(body[field]);
      }
    }
  }

  const query = buildUpdateQuery(parsedId, firmId, payload);

  if (!query.text) {
    const error = new Error("No valid fields provided for update");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(query.text, query.values);

  if (!result.rows.length) {
    const error = new Error("MailOps event not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    ok: true,
    event: result.rows[0],
  };
}
