import { pool } from "../db/pool.js";
import { publishEvent } from "../lib/intelligence.events.js";

const demoMailOpsDashboard = {
  metrics: [
    { label: "Mail Drops", value: "18", delta: "4 active today", tone: "up" },
    { label: "Delivery Risk", value: "3", delta: "2 elevated", tone: "down" },
    { label: "Postal Alerts", value: "7", delta: "Live monitoring", tone: "up" },
    { label: "On-Time Rate", value: "94%", delta: "+2.1%", tone: "up" },
  ],
  drops: [
    {
      id: 1,
      campaign: "GA Senate Victory",
      state: "Georgia",
      office: "Senate",
      risk: "Elevated",
      location: "Atlanta NDC",
      status: "Elevated",
      in_home: "2026-10-14",
      note: "Watch weekend clearance volume",
    },
    {
      id: 2,
      campaign: "PA Governor Push",
      state: "Pennsylvania",
      office: "Governor",
      risk: "Watch",
      location: "Philadelphia P&DC",
      status: "On Track",
      in_home: "2026-10-16",
      note: "Vendor scan performance stable",
    },
  ],
  alerts: [
    {
      id: 1,
      title: "Atlanta NDC delay pressure increasing",
      severity: "High",
      source: "MailOps",
      detail: "Projected slip risk on high-volume trays.",
      state: "Georgia",
      office: "Senate",
      risk: "Elevated",
    },
    {
      id: 2,
      title: "Philadelphia scan recovery improving",
      severity: "Medium",
      source: "MailOps",
      detail: "Recent tray movement indicates stabilization.",
      state: "Pennsylvania",
      office: "Governor",
      risk: "Watch",
    },
  ],
  demo: true,
};

function applyExecutiveFilters(rows, query = {}) {
  const state = String(query.state || "").trim().toLowerCase();
  const office = String(query.office || "").trim().toLowerCase();
  const risk = String(query.risk || "").trim().toLowerCase();

  return rows.filter((row) => {
    const rowState = String(row.state || "").trim().toLowerCase();
    const rowOffice = String(row.office || "").trim().toLowerCase();
    const rowRisk = String(row.risk || "").trim().toLowerCase();

    if (state && rowState !== state) return false;
    if (office && rowOffice !== office) return false;
    if (risk && rowRisk !== risk) return false;

    return true;
  });
}

function buildMetricsFromLiveData(drops, alerts) {
  const activeDrops = drops.length;
  const elevatedDrops = drops.filter(
    (row) => String(row.status || "").toLowerCase() === "elevated"
  ).length;
  const highAlerts = alerts.filter(
    (row) => String(row.severity || "").toLowerCase() === "high"
  ).length;
  const onTrackDrops = drops.filter(
    (row) => String(row.status || "").toLowerCase() === "on track"
  ).length;

  const onTimeRate = activeDrops
    ? `${Math.round((onTrackDrops / activeDrops) * 100)}%`
    : "0%";

  return [
    {
      label: "Mail Drops",
      value: String(activeDrops),
      delta: `${Math.min(activeDrops, 4)} active today`,
      tone: "up",
    },
    {
      label: "Delivery Risk",
      value: String(elevatedDrops),
      delta: elevatedDrops > 0 ? `${elevatedDrops} elevated` : "No elevated drops",
      tone: elevatedDrops > 0 ? "down" : "up",
    },
    {
      label: "Postal Alerts",
      value: String(alerts.length),
      delta: highAlerts > 0 ? `${highAlerts} high severity` : "Monitoring stable",
      tone: alerts.length > 0 ? "up" : "neutral",
    },
    {
      label: "On-Time Rate",
      value: onTimeRate,
      delta: onTrackDrops > 0 ? `${onTrackDrops} on track` : "No active drops",
      tone: "up",
    },
  ];
}

function normalizeSeverity(value) {
  const severity = String(value || "Medium").trim();
  const allowed = new Set(["Low", "Medium", "High"]);
  return allowed.has(severity) ? severity : "Medium";
}

function normalizeStatus(value) {
  const status = String(value || "Pending").trim();
  const allowed = new Set([
    "Pending",
    "Scheduled",
    "In Transit",
    "On Track",
    "Elevated",
    "Delivered",
    "Delayed",
    "Resolved",
  ]);
  return allowed.has(status) ? status : "Pending";
}

function normalizeEventType(value) {
  const eventType = String(value || "mail_update").trim();
  const allowed = new Set([
    "mail_update",
    "drop_created",
    "scan_update",
    "delay_alert",
    "delivery_update",
    "vendor_update",
    "issue_opened",
    "issue_resolved",
  ]);
  return allowed.has(eventType) ? eventType : "mail_update";
}

function buildLiveAlertFromEvent(event) {
  return {
    id: event.id,
    title: `${event.campaign} • ${event.location}`,
    severity: event.severity,
    source: "MailOps",
    detail: event.note || `${event.event_type} updated`,
    state: event.state,
    office: event.office,
    risk: event.risk,
  };
}

export async function getMailOpsDashboard(req, res) {
  try {
    const dropsResult = await pool.query(`
      SELECT
        id,
        campaign,
        state,
        office,
        risk,
        location,
        status,
        in_home,
        note
      FROM mailops_drops
      ORDER BY in_home ASC NULLS LAST, id DESC
    `);

    const alertsResult = await pool.query(`
      SELECT
        id,
        title,
        severity,
        source,
        detail,
        state,
        office,
        risk
      FROM mailops_alerts
      ORDER BY id DESC
    `);

    const drops = applyExecutiveFilters(dropsResult.rows || [], req.query);
    const alerts = applyExecutiveFilters(alertsResult.rows || [], req.query);
    const metrics = buildMetricsFromLiveData(drops, alerts);

    return res.json({
      metrics,
      drops,
      alerts,
      demo: false,
    });
  } catch (error) {
    console.error("getMailOpsDashboard fallback:", error.message);

    const filteredDrops = applyExecutiveFilters(
      demoMailOpsDashboard.drops,
      req.query
    );
    const filteredAlerts = applyExecutiveFilters(
      demoMailOpsDashboard.alerts,
      req.query
    );
    const metrics = buildMetricsFromLiveData(filteredDrops, filteredAlerts);

    return res.json({
      metrics,
      drops: filteredDrops,
      alerts: filteredAlerts,
      demo: true,
    });
  }
}

export async function listMailOpsEvents(req, res) {
  try {
    const values = [];
    const conditions = [];

    if (req.query.state) {
      values.push(req.query.state);
      conditions.push(`state = $${values.length}`);
    }

    if (req.query.office) {
      values.push(req.query.office);
      conditions.push(`office = $${values.length}`);
    }

    if (req.query.risk) {
      values.push(req.query.risk);
      conditions.push(`risk = $${values.length}`);
    }

    if (req.query.event_type) {
      values.push(req.query.event_type);
      conditions.push(`event_type = $${values.length}`);
    }

    if (req.query.status) {
      values.push(req.query.status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await pool.query(
      `
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
          updated_at,
          firm_id
        FROM mailops_events
        ${whereClause}
        ORDER BY event_time DESC NULLS LAST, id DESC
      `,
      values
    );

    return res.json({
      results: result.rows || [],
      demo: false,
    });
  } catch (error) {
    console.error("listMailOpsEvents error:", error.message);
    return res.status(500).json({
      error: "Failed to load MailOps events",
    });
  }
}

export async function createMailOpsEvent(req, res) {
  let inserted = null;

  try {
    const {
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
    } = req.body || {};

    if (!campaign || !state || !office || !location) {
      return res.status(400).json({
        error: "campaign, state, office, and location are required",
      });
    }

    const resolvedFirmId = req.auth?.firmId ?? req.user?.firm_id ?? null;

    if (!resolvedFirmId) {
      return res.status(400).json({
        error: "User is not associated with a firm",
      });
    }

    const normalizedEventType = normalizeEventType(event_type);
    const normalizedStatus = normalizeStatus(status);
    const normalizedSeverity = normalizeSeverity(severity);

    const result = await pool.query(
      `
        INSERT INTO mailops_events (
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
          firm_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          COALESCE($10::timestamptz, NOW()),
          $11,
          $12,
          $13,
          $14
        )
        RETURNING
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
          updated_at,
          firm_id
      `,
      [
        campaign,
        state,
        office,
        risk || null,
        location,
        vendor_name || null,
        normalizedEventType,
        normalizedStatus,
        normalizedSeverity,
        event_time || null,
        in_home || null,
        note || null,
        req.auth?.userId ?? req.user?.id ?? null,
        resolvedFirmId,
      ]
    );

    inserted = result.rows[0];
  } catch (error) {
    console.error("createMailOpsEvent INSERT error:", {
      message: error.message,
      detail: error.detail,
      code: error.code,
      constraint: error.constraint,
    });

    return res.status(500).json({
      error: error.detail || error.message || "Failed to create MailOps event",
    });
  }

  try {
    if (
      ["Elevated", "Delayed"].includes(inserted.status) ||
      inserted.severity === "High"
    ) {
      await pool.query(
        `
          INSERT INTO mailops_alerts (
            title,
            severity,
            source,
            detail,
            state,
            office,
            risk
          )
          VALUES ($1, $2, 'MailOps Event', $3, $4, $5, $6)
        `,
        [
          `${inserted.campaign} • ${inserted.location}`,
          inserted.severity,
          inserted.note || `${inserted.event_type} created`,
          inserted.state,
          inserted.office,
          inserted.risk || null,
        ]
      );
    }
  } catch (alertError) {
    console.error("createMailOpsEvent alert sync warning:", {
      message: alertError.message,
      detail: alertError.detail,
      code: alertError.code,
    });
  }

  try {
    publishEvent({
      type: "mailops.event_created",
      channel: "intelligence:mailops",
      timestamp: new Date().toISOString(),
      payload: {
        event: inserted,
        alert:
          ["Elevated", "Delayed"].includes(inserted.status) ||
          inserted.severity === "High"
            ? buildLiveAlertFromEvent(inserted)
            : null,
      },
    });
  } catch (publishErr) {
    console.error("createMailOpsEvent publish warning:", publishErr.message);
  }

  return res.status(201).json({
    ok: true,
    event: inserted,
  });
}

export async function updateMailOpsEvent(req, res) {
  try {
    const { eventId } = req.params;
    const payload = req.body || {};

    if (!eventId) {
      return res.status(400).json({
        error: "eventId is required",
      });
    }

    const allowedFields = {
      campaign: payload.campaign,
      state: payload.state,
      office: payload.office,
      risk: payload.risk,
      location: payload.location,
      vendor_name: payload.vendor_name,
      event_type:
        payload.event_type !== undefined
          ? normalizeEventType(payload.event_type)
          : undefined,
      status:
        payload.status !== undefined
          ? normalizeStatus(payload.status)
          : undefined,
      severity:
        payload.severity !== undefined
          ? normalizeSeverity(payload.severity)
          : undefined,
      event_time: payload.event_time,
      in_home: payload.in_home,
      note: payload.note,
    };

    const entries = Object.entries(allowedFields).filter(
      ([, value]) => value !== undefined
    );

    if (!entries.length) {
      return res.status(400).json({
        error: "No updatable fields were provided",
      });
    }

    const setParts = [];
    const values = [];

    entries.forEach(([column, value], index) => {
      values.push(value);
      setParts.push(`${column} = $${index + 1}`);
    });

    values.push(eventId);

    const result = await pool.query(
      `
        UPDATE mailops_events
        SET
          ${setParts.join(", ")},
          updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING
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
          updated_at,
          firm_id
      `,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "MailOps event not found",
      });
    }

    const updated = result.rows[0];

    try {
      publishEvent({
        type: "mailops.event_updated",
        channel: "intelligence:mailops",
        timestamp: new Date().toISOString(),
        payload: {
          event: updated,
          alert:
            ["Elevated", "Delayed"].includes(updated.status) ||
            updated.severity === "High"
              ? buildLiveAlertFromEvent(updated)
              : null,
        },
      });
    } catch (publishErr) {
      console.error("updateMailOpsEvent publish warning:", publishErr.message);
    }

    return res.json({
      ok: true,
      event: updated,
    });
  } catch (error) {
    console.error("updateMailOpsEvent error:", error.message);
    return res.status(500).json({
      error: "Failed to update MailOps event",
    });
  }
}
