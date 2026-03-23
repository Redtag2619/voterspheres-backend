import { pool } from "../db/pool.js";
import { ensureCrmTables } from "../repositories/crm.repository.js";
import { logCampaignActivity } from "./campaignCommand.service.js";

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

async function ensureAlertsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_actions (
      id SERIAL PRIMARY KEY,
      alert_key TEXT NOT NULL UNIQUE,
      alert_type TEXT NOT NULL,
      campaign_id INTEGER,
      entity_id INTEGER,
      action_status TEXT NOT NULL DEFAULT 'open',
      notes TEXT DEFAULT '',
      resolved_at TIMESTAMP NULL,
      dismissed_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function ensureAllTables() {
  await ensureCrmTables();
  await ensureMailTables();
  await ensureAlertsTable();
}

function normalizePriority(priority = "medium") {
  const value = String(priority).toLowerCase();
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function severityRank(severity = "medium") {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

async function loadAlertActionsMap() {
  const result = await pool.query(`
    SELECT *
    FROM alert_actions
  `);

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.alert_key, row);
  }
  return map;
}

function attachAlertState(alert, actionRow) {
  if (!actionRow) {
    return {
      ...alert,
      action_status: "open",
      notes: "",
      resolved_at: null,
      dismissed_at: null
    };
  }

  return {
    ...alert,
    action_status: actionRow.action_status,
    notes: actionRow.notes || "",
    resolved_at: actionRow.resolved_at,
    dismissed_at: actionRow.dismissed_at
  };
}

async function buildAlertsInternal(campaignId = null) {
  await ensureAllTables();

  const params = [];
  const campaignWhere = campaignId ? `WHERE t.campaign_id = $1` : "";
  const delayedWhere = campaignId
    ? `WHERE (LOWER(COALESCE(mte.event_type, '')) = 'delayed' OR LOWER(COALESCE(mte.status, '')) = 'delayed') AND mte.campaign_id = $1`
    : `WHERE LOWER(COALESCE(mte.event_type, '')) = 'delayed' OR LOWER(COALESCE(mte.status, '')) = 'delayed'`;
  const campaignsWhere = campaignId ? `WHERE id = $1` : "";
  const vendorsWhere = campaignId ? `WHERE v.campaign_id = $1` : "";

  if (campaignId) {
    params.push(campaignId);
  }

  const [tasksResult, delayedMailResult, campaignsResult, vendorResult, actionsMap] =
    await Promise.all([
      pool.query(
        `
        SELECT
          t.id,
          t.campaign_id,
          t.title,
          t.priority,
          t.status,
          t.created_at,
          c.campaign_name,
          c.candidate_name
        FROM campaign_tasks t
        INNER JOIN campaigns c ON c.id = t.campaign_id
        ${campaignWhere}
        AND LOWER(COALESCE(t.status, 'todo')) <> 'done'
        ORDER BY t.created_at DESC
        `.replace(/\n\s+AND/, "\nWHERE"),
        params
      ),

      pool.query(
        `
        SELECT
          mte.id,
          mte.campaign_id,
          mte.mail_drop_id,
          mte.event_type,
          mte.status,
          mte.location_name,
          mte.facility_type,
          mte.notes,
          mte.created_at,
          c.campaign_name,
          c.candidate_name
        FROM mail_tracking_events mte
        LEFT JOIN campaigns c ON c.id = mte.campaign_id
        ${delayedWhere}
        ORDER BY mte.created_at DESC
        `,
        params
      ),

      pool.query(
        `
        SELECT
          id,
          campaign_name,
          candidate_name,
          stage,
          status,
          contract_value,
          budget_total,
          updated_at
        FROM campaigns
        ${campaignsWhere}
        ORDER BY updated_at DESC
        `,
        params
      ),

      pool.query(
        `
        SELECT
          v.id,
          v.campaign_id,
          v.vendor_name,
          v.category,
          v.status,
          v.contract_value,
          v.updated_at,
          v.created_at,
          c.campaign_name,
          c.candidate_name
        FROM campaign_vendors v
        INNER JOIN campaigns c ON c.id = v.campaign_id
        ${vendorsWhere}
        ORDER BY v.updated_at DESC, v.created_at DESC
        `,
        params
      ),

      loadAlertActionsMap()
    ]);

  const alerts = [];

  for (const task of tasksResult.rows) {
    const severity = normalizePriority(task.priority) === "high" ? "high" : "medium";
    const alertKey = `task-${task.id}`;

    alerts.push(
      attachAlertState(
        {
          id: alertKey,
          alert_key: alertKey,
          type: "task",
          entity_id: task.id,
          severity,
          campaign_id: task.campaign_id,
          title: `Open ${normalizePriority(task.priority)} priority task`,
          message: `${task.title} • ${task.campaign_name || task.candidate_name || "Campaign"}`,
          meta: {
            task_id: task.id,
            task_status: task.status,
            priority: task.priority
          },
          created_at: task.created_at
        },
        actionsMap.get(alertKey)
      )
    );
  }

  for (const event of delayedMailResult.rows) {
    const alertKey = `mail-${event.id}`;

    alerts.push(
      attachAlertState(
        {
          id: alertKey,
          alert_key: alertKey,
          type: "mail_delay",
          entity_id: event.id,
          severity: "high",
          campaign_id: event.campaign_id,
          title: "Delayed mail detected",
          message: `Drop #${event.mail_drop_id} delayed at ${event.location_name || event.facility_type || "mail network"}`,
          meta: {
            mail_event_id: event.id,
            mail_drop_id: event.mail_drop_id,
            location_name: event.location_name,
            facility_type: event.facility_type,
            notes: event.notes
          },
          created_at: event.created_at
        },
        actionsMap.get(alertKey)
      )
    );
  }

  for (const campaign of campaignsResult.rows) {
    const contractValue = Number(campaign.contract_value || 0);
    const budgetTotal = Number(campaign.budget_total || 0);

    if (contractValue > 0 && budgetTotal > 0 && contractValue > budgetTotal) {
      const alertKey = `budget-${campaign.id}`;

      alerts.push(
        attachAlertState(
          {
            id: alertKey,
            alert_key: alertKey,
            type: "budget",
            entity_id: campaign.id,
            severity: "medium",
            campaign_id: campaign.id,
            title: "Contract value exceeds tracked budget",
            message: `${campaign.campaign_name || campaign.candidate_name || "Campaign"} has contract value above current budget tracking`,
            meta: {
              contract_value: contractValue,
              budget_total: budgetTotal
            },
            created_at: campaign.updated_at
          },
          actionsMap.get(alertKey)
        )
      );
    }

    if (
      String(campaign.status || "").toLowerCase() === "open" &&
      String(campaign.stage || "").toLowerCase() === "lead"
    ) {
      const alertKey = `pipeline-${campaign.id}`;

      alerts.push(
        attachAlertState(
          {
            id: alertKey,
            alert_key: alertKey,
            type: "pipeline",
            entity_id: campaign.id,
            severity: "low",
            campaign_id: campaign.id,
            title: "Lead-stage campaign still open",
            message: `${campaign.campaign_name || campaign.candidate_name || "Campaign"} remains in lead stage`,
            meta: {
              stage: campaign.stage,
              status: campaign.status
            },
            created_at: campaign.updated_at
          },
          actionsMap.get(alertKey)
        )
      );
    }
  }

  for (const vendor of vendorResult.rows) {
    if (String(vendor.status || "").toLowerCase() === "at_risk") {
      const alertKey = `vendor-${vendor.id}`;

      alerts.push(
        attachAlertState(
          {
            id: alertKey,
            alert_key: alertKey,
            type: "vendor",
            entity_id: vendor.id,
            severity: "high",
            campaign_id: vendor.campaign_id,
            title: "Vendor marked at risk",
            message: `${vendor.vendor_name} is at risk on ${vendor.campaign_name || vendor.candidate_name || "campaign"}`,
            meta: {
              vendor_id: vendor.id,
              vendor_name: vendor.vendor_name,
              category: vendor.category
            },
            created_at: vendor.updated_at || vendor.created_at || new Date().toISOString()
          },
          actionsMap.get(alertKey)
        )
      );
    }
  }

  return alerts
    .filter((alert) => alert.action_status !== "dismissed")
    .sort((a, b) => {
      const severityDiff = severityRank(b.severity) - severityRank(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

export async function getAllAlerts(req, res, next) {
  try {
    const alerts = await buildAlertsInternal();

    res.json({
      metrics: [
        {
          label: "Total Alerts",
          value: `${alerts.length}`,
          delta: "Active intelligence surface",
          tone: alerts.length > 0 ? "down" : "up"
        },
        {
          label: "High Severity",
          value: `${alerts.filter((a) => a.severity === "high").length}`,
          delta: "Immediate attention",
          tone: alerts.some((a) => a.severity === "high") ? "down" : "up"
        }
      ],
      alerts
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignAlerts(req, res, next) {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId) {
      return res.status(400).json({ error: "valid campaign id required" });
    }

    const alerts = await buildAlertsInternal(campaignId);
    res.json(alerts);
  } catch (err) {
    next(err);
  }
}

export async function rebuildAlerts(req, res, next) {
  try {
    const alerts = await buildAlertsInternal();
    res.json({
      ok: true,
      rebuilt: alerts.length,
      alerts
    });
  } catch (err) {
    next(err);
  }
}

export async function resolveAlert(req, res, next) {
  try {
    await ensureAllTables();

    const {
      alert_key,
      alert_type,
      campaign_id = null,
      entity_id = null,
      notes = ""
    } = req.body || {};

    if (!alert_key || !alert_type) {
      return res.status(400).json({ error: "alert_key and alert_type are required" });
    }

    await pool.query(
      `
      INSERT INTO alert_actions
      (alert_key, alert_type, campaign_id, entity_id, action_status, notes, resolved_at, dismissed_at, updated_at)
      VALUES ($1, $2, $3, $4, 'resolved', $5, NOW(), NULL, NOW())
      ON CONFLICT (alert_key)
      DO UPDATE SET
        alert_type = EXCLUDED.alert_type,
        campaign_id = EXCLUDED.campaign_id,
        entity_id = EXCLUDED.entity_id,
        action_status = 'resolved',
        notes = EXCLUDED.notes,
        resolved_at = NOW(),
        dismissed_at = NULL,
        updated_at = NOW()
      `,
      [alert_key, alert_type, campaign_id, entity_id, notes]
    );

    await logCampaignActivity(campaign_id, "alert_resolved", {
      alert_key,
      alert_type,
      entity_id,
      notes
    });

    res.json({
      ok: true,
      alert_key,
      action_status: "resolved"
    });
  } catch (err) {
    next(err);
  }
}

export async function dismissAlert(req, res, next) {
  try {
    await ensureAllTables();

    const {
      alert_key,
      alert_type,
      campaign_id = null,
      entity_id = null,
      notes = ""
    } = req.body || {};

    if (!alert_key || !alert_type) {
      return res.status(400).json({ error: "alert_key and alert_type are required" });
    }

    await pool.query(
      `
      INSERT INTO alert_actions
      (alert_key, alert_type, campaign_id, entity_id, action_status, notes, resolved_at, dismissed_at, updated_at)
      VALUES ($1, $2, $3, $4, 'dismissed', $5, NULL, NOW(), NOW())
      ON CONFLICT (alert_key)
      DO UPDATE SET
        alert_type = EXCLUDED.alert_type,
        campaign_id = EXCLUDED.campaign_id,
        entity_id = EXCLUDED.entity_id,
        action_status = 'dismissed',
        notes = EXCLUDED.notes,
        resolved_at = NULL,
        dismissed_at = NOW(),
        updated_at = NOW()
      `,
      [alert_key, alert_type, campaign_id, entity_id, notes]
    );

    await logCampaignActivity(campaign_id, "alert_dismissed", {
      alert_key,
      alert_type,
      entity_id,
      notes
    });

    res.json({
      ok: true,
      alert_key,
      action_status: "dismissed"
    });
  } catch (err) {
    next(err);
  }
}
