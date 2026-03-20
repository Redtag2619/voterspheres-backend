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

async function buildAlerts() {
  await ensureCrmTables();
  await ensureMailTables();

  const [tasksResult, delayedMailResult, campaignsResult, vendorResult] =
    await Promise.all([
      pool.query(`
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
        WHERE LOWER(COALESCE(t.status, 'todo')) <> 'done'
        ORDER BY t.created_at DESC
      `),

      pool.query(`
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
        WHERE LOWER(COALESCE(mte.event_type, '')) = 'delayed'
           OR LOWER(COALESCE(mte.status, '')) = 'delayed'
        ORDER BY mte.created_at DESC
      `),

      pool.query(`
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
        ORDER BY updated_at DESC
      `),

      pool.query(`
        SELECT
          v.id,
          v.campaign_id,
          v.vendor_name,
          v.category,
          v.status,
          v.contract_value,
          c.campaign_name,
          c.candidate_name
        FROM campaign_vendors v
        INNER JOIN campaigns c ON c.id = v.campaign_id
        ORDER BY v.updated_at DESC, v.created_at DESC
      `)
    ]);

  const alerts = [];

  for (const task of tasksResult.rows) {
    const severity = normalizePriority(task.priority) === "high" ? "high" : "medium";

    alerts.push({
      id: `task-${task.id}`,
      type: "task",
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
    });
  }

  for (const event of delayedMailResult.rows) {
    alerts.push({
      id: `mail-${event.id}`,
      type: "mail_delay",
      severity: "high",
      campaign_id: event.campaign_id,
      title: "Delayed mail detected",
      message: `Drop #${event.mail_drop_id} delayed at ${event.location_name || event.facility_type || "mail network"}`,
      meta: {
        mail_drop_id: event.mail_drop_id,
        location_name: event.location_name,
        facility_type: event.facility_type,
        notes: event.notes
      },
      created_at: event.created_at
    });
  }

  for (const campaign of campaignsResult.rows) {
    const contractValue = Number(campaign.contract_value || 0);
    const budgetTotal = Number(campaign.budget_total || 0);

    if (contractValue > 0 && budgetTotal > 0 && contractValue > budgetTotal) {
      alerts.push({
        id: `budget-${campaign.id}`,
        type: "budget",
        severity: "medium",
        campaign_id: campaign.id,
        title: "Contract value exceeds tracked budget",
        message: `${campaign.campaign_name || campaign.candidate_name || "Campaign"} has contract value above current budget tracking`,
        meta: {
          contract_value: contractValue,
          budget_total: budgetTotal
        },
        created_at: campaign.updated_at
      });
    }

    if (String(campaign.status || "").toLowerCase() === "open" && String(campaign.stage || "").toLowerCase() === "lead") {
      alerts.push({
        id: `pipeline-${campaign.id}`,
        type: "pipeline",
        severity: "low",
        campaign_id: campaign.id,
        title: "Lead-stage campaign still open",
        message: `${campaign.campaign_name || campaign.candidate_name || "Campaign"} remains in lead stage`,
        meta: {
          stage: campaign.stage,
          status: campaign.status
        },
        created_at: campaign.updated_at
      });
    }
  }

  for (const vendor of vendorResult.rows) {
    if (String(vendor.status || "").toLowerCase() === "at_risk") {
      alerts.push({
        id: `vendor-${vendor.id}`,
        type: "vendor",
        severity: "high",
        campaign_id: vendor.campaign_id,
        title: "Vendor marked at risk",
        message: `${vendor.vendor_name} is at risk on ${vendor.campaign_name || vendor.candidate_name || "campaign"}`,
        meta: {
          vendor_id: vendor.id,
          vendor_name: vendor.vendor_name,
          category: vendor.category
        },
        created_at: new Date().toISOString()
      });
    }
  }

  return alerts.sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export async function getAllAlerts(req, res, next) {
  try {
    const alerts = await buildAlerts();
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

    const alerts = await buildAlerts();
    res.json(alerts.filter((alert) => Number(alert.campaign_id) === campaignId));
  } catch (err) {
    next(err);
  }
}

export async function rebuildAlerts(req, res, next) {
  try {
    const alerts = await buildAlerts();
    res.json({
      ok: true,
      rebuilt: alerts.length,
      alerts
    });
  } catch (err) {
    next(err);
  }
}
