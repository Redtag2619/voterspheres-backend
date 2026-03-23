import { pool } from "../db/pool.js";
import { ensureCrmTables } from "../repositories/crm.repository.js";

async function ensureMailTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_programs (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      name TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_drops (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      program_id INTEGER,
      drop_date DATE,
      quantity INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_tracking_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      mail_drop_id INTEGER,
      event_type TEXT,
      status TEXT,
      location_name TEXT,
      facility_type TEXT,
      notes TEXT,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function ensureCampaignActivityTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_activity (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      activity_type TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function ensureAllTables() {
  await ensureCrmTables();
  await ensureMailTables();
  await ensureCampaignActivityTable();
}

function n(value) {
  return Number(value || 0);
}

function money(value) {
  return `$${n(value).toLocaleString()}`;
}

function severityRank(severity = "medium") {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function taskSeverity(priority = "medium") {
  const value = String(priority).toLowerCase();
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function formatActivityTitle(activityType) {
  const map = {
    task_created: "Task created",
    task_updated: "Task updated",
    contact_created: "Contact added",
    vendor_created: "Vendor added",
    vendor_updated: "Vendor updated",
    document_created: "Document added",
    mail_program_created: "Mail program created",
    mail_drop_created: "Mail drop created",
    mail_event_created: "Mail event created",
    mail_event_updated: "Mail event updated",
    alert_resolved: "Alert resolved",
    alert_dismissed: "Alert dismissed"
  };

  return map[activityType] || activityType.replaceAll("_", " ");
}

function formatActivityMessage(activityType, details = {}) {
  switch (activityType) {
    case "task_created":
      return details.title ? `Created task: ${details.title}` : "Created a new task";
    case "task_updated":
      return `Updated task #${details.task_id || ""} ${details.status ? `to ${details.status}` : ""}`.trim();
    case "contact_created":
      return details.full_name ? `Added contact: ${details.full_name}` : "Added a new contact";
    case "vendor_created":
      return details.vendor_name ? `Added vendor: ${details.vendor_name}` : "Added a new vendor";
    case "vendor_updated":
      return `Updated vendor #${details.vendor_id || ""} ${details.status ? `to ${details.status}` : ""}`.trim();
    case "document_created":
      return details.title ? `Added document: ${details.title}` : "Added a new document";
    case "mail_program_created":
      return details.name ? `Created mail program: ${details.name}` : "Created a mail program";
    case "mail_drop_created":
      return `Created mail drop #${details.mail_drop_id || ""} ${details.quantity ? `for ${Number(details.quantity).toLocaleString()} pieces` : ""}`.trim();
    case "mail_event_created":
      return `Added mail event: ${details.event_type || "event"}${details.mail_drop_id ? ` for drop #${details.mail_drop_id}` : ""}`;
    case "mail_event_updated":
      return `Updated mail event #${details.event_id || ""} ${details.status ? `to ${details.status}` : ""}`.trim();
    case "alert_resolved":
      return `Resolved alert: ${details.alert_key || details.alert_type || "alert"}`;
    case "alert_dismissed":
      return `Dismissed alert: ${details.alert_key || details.alert_type || "alert"}`;
    default:
      return "Activity recorded";
  }
}

function formatActivityTone(activityType) {
  if (activityType.includes("resolved")) return "up";
  if (activityType.includes("dismissed")) return "neutral";
  if (activityType.includes("updated")) return "neutral";
  return "up";
}

async function campaignExists(campaignId) {
  const result = await pool.query(
    `SELECT id, candidate_name, campaign_name FROM campaigns WHERE id = $1 LIMIT 1`,
    [campaignId]
  );
  return result.rows[0] || null;
}

async function logCampaignActivity(campaignId, activityType, details = {}) {
  await ensureCampaignActivityTable();

  await pool.query(
    `
    INSERT INTO campaign_activity (campaign_id, activity_type, details)
    VALUES ($1, $2, $3::jsonb)
    `,
    [campaignId, activityType, JSON.stringify(details)]
  );
}

export async function getCampaignCommandCenter(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    if (!campaignId) {
      return res.status(400).json({ error: "valid campaign id required" });
    }

    const [
      campaignResult,
      contactsResult,
      vendorsResult,
      tasksResult,
      documentsResult,
      fundraisingResult,
      mailProgramsResult,
      mailDropsResult,
      mailEventsResult,
      forecastSnapshotResult,
      forecastRacesResult,
      alertActionsResult,
      activityResult
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          c.*,
          f.name AS firm_name,
          u.first_name AS owner_first_name,
          u.last_name AS owner_last_name
        FROM campaigns c
        LEFT JOIN firms f ON f.id = c.firm_id
        LEFT JOIN app_users u ON u.id = c.owner_user_id
        WHERE c.id = $1
        LIMIT 1
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM campaign_contacts
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 12
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM campaign_vendors
        WHERE campaign_id = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 12
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM campaign_tasks
        WHERE campaign_id = $1
        ORDER BY
          CASE
            WHEN LOWER(COALESCE(priority, 'medium')) = 'high' THEN 1
            WHEN LOWER(COALESCE(priority, 'medium')) = 'medium' THEN 2
            ELSE 3
          END,
          created_at DESC
        LIMIT 20
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM campaign_documents
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 12
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM fundraising
        WHERE LOWER(TRIM(candidate_name)) = LOWER(TRIM((
          SELECT candidate_name FROM campaigns WHERE id = $1
        )))
        ORDER BY COALESCE(total_receipts, 0) DESC
        LIMIT 1
        `,
        [campaignId]
      ).catch(() => ({ rows: [] })),

      pool.query(
        `
        SELECT *
        FROM mail_programs
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 12
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM mail_drops
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 20
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM mail_tracking_events
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [campaignId]
      ),

      pool.query(
        `
        SELECT *
        FROM forecast_snapshots
        ORDER BY created_at DESC
        LIMIT 1
        `
      ).catch(() => ({ rows: [] })),

      pool.query(
        `
        SELECT *
        FROM forecast_races
        WHERE LOWER(TRIM(state)) = LOWER(TRIM((
          SELECT state FROM campaigns WHERE id = $1
        )))
        ORDER BY created_at DESC
        LIMIT 15
        `,
        [campaignId]
      ).catch(() => ({ rows: [] })),

      pool.query(
        `
        SELECT *
        FROM alert_actions
        WHERE campaign_id = $1
        `,
        [campaignId]
      ).catch(() => ({ rows: [] })),

      pool.query(
        `
        SELECT *
        FROM campaign_activity
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 40
        `,
        [campaignId]
      )
    ]);

    const campaign = campaignResult.rows[0];
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const contacts = contactsResult.rows || [];
    const vendors = vendorsResult.rows || [];
    const tasks = tasksResult.rows || [];
    const documents = documentsResult.rows || [];
    const fundraising = fundraisingResult.rows?.[0] || null;
    const mailPrograms = mailProgramsResult.rows || [];
    const mailDrops = mailDropsResult.rows || [];
    const mailEvents = mailEventsResult.rows || [];
    const forecastSnapshot = forecastSnapshotResult.rows?.[0] || null;
    const forecastRaces = forecastRacesResult.rows || [];
    const alertActions = alertActionsResult.rows || [];
    const activityRows = activityResult.rows || [];

    const alertActionsMap = new Map();
    for (const row of alertActions) {
      alertActionsMap.set(row.alert_key, row);
    }

    const openTasks = tasks.filter(
      (task) => String(task.status || "").toLowerCase() !== "done"
    );

    const highPriorityTasks = openTasks.filter(
      (task) => taskSeverity(task.priority) === "high"
    );

    const activeVendors = vendors.filter(
      (vendor) => String(vendor.status || "").toLowerCase() === "active"
    );

    const atRiskVendors = vendors.filter(
      (vendor) => String(vendor.status || "").toLowerCase() === "at_risk"
    );

    const delayedMailEvents = mailEvents.filter((event) => {
      const eventType = String(event.event_type || "").toLowerCase();
      const status = String(event.status || "").toLowerCase();
      return eventType === "delayed" || status === "delayed";
    });

    const deliveredMailEvents = mailEvents.filter(
      (event) => String(event.event_type || "").toLowerCase() === "delivered"
    );

    const totalMailPieces = mailDrops.reduce(
      (sum, drop) => sum + n(drop.quantity),
      0
    );

    const rawAlerts = [
      ...highPriorityTasks.map((task) => ({
        id: `task-${task.id}`,
        alert_key: `task-${task.id}`,
        type: "task",
        entity_id: task.id,
        severity: "high",
        campaign_id: campaignId,
        title: "High-priority task open",
        message: task.title,
        meta: {
          task_id: task.id,
          status: task.status,
          priority: task.priority
        },
        created_at: task.created_at
      })),

      ...delayedMailEvents.map((event) => ({
        id: `mail-${event.id}`,
        alert_key: `mail-${event.id}`,
        type: "mail_delay",
        entity_id: event.id,
        severity: "high",
        campaign_id: campaignId,
        title: "Delayed mail event",
        message: `Drop #${event.mail_drop_id} delayed at ${event.location_name || event.facility_type || "network"}`,
        meta: {
          mail_event_id: event.id,
          mail_drop_id: event.mail_drop_id,
          location_name: event.location_name,
          facility_type: event.facility_type
        },
        created_at: event.created_at
      })),

      ...atRiskVendors.map((vendor) => ({
        id: `vendor-${vendor.id}`,
        alert_key: `vendor-${vendor.id}`,
        type: "vendor",
        entity_id: vendor.id,
        severity: "high",
        campaign_id: campaignId,
        title: "Vendor at risk",
        message: `${vendor.vendor_name} is marked at risk`,
        meta: {
          vendor_id: vendor.id,
          category: vendor.category
        },
        created_at: vendor.updated_at || vendor.created_at
      }))
    ];

    const alerts = rawAlerts
      .map((alert) => {
        const action = alertActionsMap.get(alert.alert_key);
        return {
          ...alert,
          action_status: action?.action_status || "open",
          notes: action?.notes || "",
          resolved_at: action?.resolved_at || null,
          dismissed_at: action?.dismissed_at || null
        };
      })
      .filter((alert) => alert.action_status !== "dismissed")
      .sort((a, b) => {
        const severityDiff = severityRank(b.severity) - severityRank(a.severity);
        if (severityDiff !== 0) return severityDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

    const timeline = activityRows.map((row) => ({
      id: row.id,
      activity_type: row.activity_type,
      title: formatActivityTitle(row.activity_type),
      message: formatActivityMessage(row.activity_type, row.details || {}),
      tone: formatActivityTone(row.activity_type),
      details: row.details || {},
      created_at: row.created_at
    }));

    res.json({
      campaign: {
        ...campaign,
        owner_name: [campaign.owner_first_name, campaign.owner_last_name]
          .filter(Boolean)
          .join(" ")
      },
      metrics: [
        {
          label: "Open Tasks",
          value: `${openTasks.length}`,
          delta: `${highPriorityTasks.length} high priority`,
          tone: highPriorityTasks.length > 0 ? "down" : "up"
        },
        {
          label: "Active Vendors",
          value: `${activeVendors.length}`,
          delta: `${atRiskVendors.length} at risk`,
          tone: atRiskVendors.length > 0 ? "down
