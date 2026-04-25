import { pool } from "../db/pool.js";
import { publishEvent } from "../lib/intelligence.events.js";

function text(value = "") {
  return String(value || "").trim();
}

function normalizeSeverity(value) {
  const severity = text(value || "Medium");
  return ["Low", "Medium", "High"].includes(severity) ? severity : "Medium";
}

function normalizeStatus(value) {
  const status = text(value || "Pending");
  return [
    "Pending",
    "Scheduled",
    "In Transit",
    "On Track",
    "Elevated",
    "Delivered",
    "Delayed",
    "Resolved"
  ].includes(status)
    ? status
    : "Pending";
}

function normalizeEventType(value) {
  const eventType = text(value || "mail_update");
  return [
    "mail_update",
    "drop_created",
    "scan_update",
    "delay_alert",
    "delivery_update",
    "vendor_update",
    "issue_opened",
    "issue_resolved"
  ].includes(eventType)
    ? eventType
    : "mail_update";
}

async function ensureMailOpsEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailops_events (
      id SERIAL PRIMARY KEY,
      campaign TEXT,
      state TEXT,
      office TEXT,
      risk TEXT,
      location TEXT,
      vendor_name TEXT,
      event_type TEXT DEFAULT 'mail_update',
      status TEXT DEFAULT 'Pending',
      severity TEXT DEFAULT 'Medium',
      event_time TIMESTAMP DEFAULT NOW(),
      in_home DATE,
      note TEXT,
      created_by_user_id INTEGER,
      firm_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS campaign TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS office TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS risk TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS location TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS vendor_name TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'mail_update'`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Pending'`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'Medium'`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS event_time TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS in_home DATE`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS note TEXT`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE mailops_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailops_events_state ON mailops_events(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailops_events_office ON mailops_events(office)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailops_events_risk ON mailops_events(risk)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailops_events_time ON mailops_events(event_time DESC)`);
}

async function seedMailOpsEventsIfEmpty() {
  await ensureMailOpsEventsTable();

  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM mailops_events`);
  if (Number(count.rows[0]?.total || 0) > 0) return;

  await pool.query(`
    INSERT INTO mailops_events (
      campaign, state, office, risk, location, vendor_name,
      event_type, status, severity, event_time, in_home, note
    )
    VALUES
      (
        'GA Senate Victory',
        'Georgia',
        'Senate',
        'Elevated',
        'Atlanta NDC',
        'Precision Mail Group',
        'delay_alert',
        'Elevated',
        'High',
        NOW(),
        CURRENT_DATE + INTERVAL '3 days',
        'Weekend backlog building. Watch clearance volume and scan latency.'
      ),
      (
        'PA Governor Push',
        'Pennsylvania',
        'Governor',
        'Watch',
        'Philadelphia P&DC',
        'Keystone Mail',
        'scan_update',
        'On Track',
        'Medium',
        NOW(),
        CURRENT_DATE + INTERVAL '5 days',
        'Scan recovery improving and vendor scan performance stable.'
      )
  `);
}

function buildWhere(query = {}) {
  const values = [];
  const conditions = [];

  if (query.state) {
    values.push(text(query.state));
    conditions.push(`state = $${values.length}`);
  }

  if (query.office) {
    values.push(text(query.office));
    conditions.push(`office = $${values.length}`);
  }

  if (query.risk) {
    values.push(text(query.risk));
    conditions.push(`risk = $${values.length}`);
  }

  if (query.status) {
    values.push(text(query.status));
    conditions.push(`status = $${values.length}`);
  }

  if (query.event_type) {
    values.push(text(query.event_type));
    conditions.push(`event_type = $${values.length}`);
  }

  return {
    values,
    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  };
}

function buildMetrics(rows) {
  const total = rows.length;
  const elevated = rows.filter((row) =>
    ["elevated", "delayed"].includes(String(row.status || "").toLowerCase())
  ).length;
  const high = rows.filter((row) => String(row.severity || "").toLowerCase() === "high").length;
  const onTrack = rows.filter((row) =>
    ["on track", "delivered", "resolved"].includes(String(row.status || "").toLowerCase())
  ).length;

  return [
    { label: "Mail Drops", value: String(total), delta: `${Math.min(total, 4)} active today`, tone: "up" },
    { label: "Delivery Risk", value: String(elevated), delta: elevated ? `${elevated} elevated` : "No elevated drops", tone: elevated ? "down" : "up" },
    { label: "Postal Alerts", value: String(high), delta: high ? `${high} high severity` : "Monitoring stable", tone: high ? "down" : "up" },
    { label: "On-Time Rate", value: total ? `${Math.round((onTrack / total) * 100)}%` : "0%", delta: `${onTrack} on track`, tone: "up" }
  ];
}

function eventToDrop(row) {
  return {
    id: row.id,
    campaign: row.campaign,
    state: row.state,
    office: row.office,
    risk: row.risk,
    location: row.location,
    status: row.status,
    in_home: row.in_home,
    note: row.note
  };
}

function eventToAlert(row) {
  return {
    id: row.id,
    title: `${row.campaign || "MailOps"} • ${row.location || "Operational update"}`,
    severity: row.severity,
    source: "MailOps",
    detail: row.note || `${row.event_type || "mail_update"} updated`,
    state: row.state,
    office: row.office,
    risk: row.risk
  };
}

function publishMailOps(type, event) {
  try {
    publishEvent({
      type,
      channel: "intelligence:mailops",
      timestamp: new Date().toISOString(),
      payload: {
        event,
        alert:
          ["Elevated", "Delayed"].includes(event.status) || event.severity === "High"
            ? eventToAlert(event)
            : null
      }
    });
  } catch (error) {
    console.error("MailOps publish warning:", error.message);
  }
}

export async function getMailOpsDashboard(req, res) {
  try {
    await seedMailOpsEventsIfEmpty();

    const { values, whereSql } = buildWhere(req.query);

    const result = await pool.query(
      `
        SELECT *
        FROM mailops_events
        ${whereSql}
        ORDER BY event_time DESC NULLS LAST, id DESC
        LIMIT 50
      `,
      values
    );

    const rows = result.rows || [];
    const drops = rows.slice(0, 10).map(eventToDrop);
    const alerts = rows
      .filter((row) =>
        ["High"].includes(row.severity) ||
        ["Elevated", "Delayed"].includes(row.status)
      )
      .slice(0, 10)
      .map(eventToAlert);

    return res.json({
      metrics: buildMetrics(rows),
      drops,
      alerts,
      _demo: false,
      demo: false
    });
  } catch (error) {
    console.error("getMailOpsDashboard error:", error.message);
    return res.status(500).json({ error: error.message || "Failed to load MailOps dashboard" });
  }
}

export async function listMailOpsEvents(req, res) {
  try {
    await seedMailOpsEventsIfEmpty();

    const { values, whereSql } = buildWhere(req.query);

    const result = await pool.query(
      `
        SELECT *
        FROM mailops_events
        ${whereSql}
        ORDER BY event_time DESC NULLS LAST, id DESC
        LIMIT 100
      `,
      values
    );

    return res.json({
      results: result.rows || [],
      _demo: false,
      demo: false
    });
  } catch (error) {
    console.error("listMailOpsEvents error:", error.message);
    return res.status(500).json({ error: error.message || "Failed to load MailOps events" });
  }
}

export async function createMailOpsEvent(req, res) {
  try {
    await ensureMailOpsEventsTable();

    const payload = req.body || {};

    if (!payload.campaign || !payload.state || !payload.office || !payload.location) {
      return res.status(400).json({
        error: "campaign, state, office, and location are required"
      });
    }

    const firmId = req.auth?.firmId ?? req.user?.firm_id ?? null;
    const userId = req.auth?.userId ?? req.user?.id ?? null;

    const result = await pool.query(
      `
        INSERT INTO mailops_events (
          campaign, state, office, risk, location, vendor_name,
          event_type, status, severity, event_time, in_home, note,
          created_by_user_id, firm_id, created_at, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          COALESCE($10::timestamp, NOW()),
          $11,
          $12,
          $13,
          $14,
          NOW(),
          NOW()
        )
        RETURNING *
      `,
      [
        text(payload.campaign),
        text(payload.state),
        text(payload.office),
        text(payload.risk),
        text(payload.location),
        text(payload.vendor_name),
        normalizeEventType(payload.event_type),
        normalizeStatus(payload.status),
        normalizeSeverity(payload.severity),
        payload.event_time || null,
        payload.in_home || null,
        text(payload.note),
        userId,
        firmId
      ]
    );

    const event = result.rows[0];
    publishMailOps("mailops.event_created", event);

    return res.status(201).json({
      ok: true,
      event
    });
  } catch (error) {
    console.error("createMailOpsEvent error:", error.message);
    return res.status(500).json({ error: error.message || "Failed to create MailOps event" });
  }
}

export async function updateMailOpsEvent(req, res) {
  try {
    await ensureMailOpsEventsTable();

    const { eventId } = req.params;
    const payload = req.body || {};

    if (!eventId) {
      return res.status(400).json({ error: "eventId is required" });
    }

    const allowed = {
      campaign: payload.campaign,
      state: payload.state,
      office: payload.office,
      risk: payload.risk,
      location: payload.location,
      vendor_name: payload.vendor_name,
      event_type: payload.event_type !== undefined ? normalizeEventType(payload.event_type) : undefined,
      status: payload.status !== undefined ? normalizeStatus(payload.status) : undefined,
      severity: payload.severity !== undefined ? normalizeSeverity(payload.severity) : undefined,
      event_time: payload.event_time,
      in_home: payload.in_home,
      note: payload.note
    };

    const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);

    if (!entries.length) {
      return res.status(400).json({ error: "No updatable fields were provided" });
    }

    const values = [];
    const setParts = entries.map(([key, value], index) => {
      values.push(value);
      return `${key} = $${index + 1}`;
    });

    values.push(eventId);

    const result = await pool.query(
      `
        UPDATE mailops_events
        SET ${setParts.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "MailOps event not found" });
    }

    const event = result.rows[0];
    publishMailOps("mailops.event_updated", event);

    return res.json({
      ok: true,
      event
    });
  } catch (error) {
    console.error("updateMailOpsEvent error:", error.message);
    return res.status(500).json({ error: error.message || "Failed to update MailOps event" });
  }
}
