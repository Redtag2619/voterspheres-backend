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

export async function getCampaignCommandCenter(req, res, next) {
  try {
    await ensureCrmTables();
    await ensureMailTables();

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
      forecastRacesResult
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
        ORDER BY updated_at DESC, created_at DESC
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
      ).catch(() => ({ rows: [] }))
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

    const alerts = [
      ...highPriorityTasks.map((task) => ({
        id: `task-${task.id}`,
        type: "task",
        severity: "high",
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
        type: "mail_delay",
        severity: "high",
        title: "Delayed mail event",
        message: `Drop #${event.mail_drop_id} delayed at ${event.location_name || event.facility_type || "network"}`,
        meta: {
          mail_drop_id: event.mail_drop_id,
          location_name: event.location_name,
          facility_type: event.facility_type
        },
        created_at: event.created_at
      })),

      ...atRiskVendors.map((vendor) => ({
        id: `vendor-${vendor.id}`,
        type: "vendor",
        severity: "high",
        title: "Vendor at risk",
        message: `${vendor.vendor_name} is marked at risk`,
        meta: {
          vendor_id: vendor.id,
          category: vendor.category
        },
        created_at: vendor.updated_at || vendor.created_at
      }))
    ].sort((a, b) => {
      const severityDiff = severityRank(b.severity) - severityRank(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

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
          tone: atRiskVendors.length > 0 ? "down" : "up"
        },
        {
          label: "Mail Pieces",
          value: `${totalMailPieces.toLocaleString()}`,
          delta: `${mailDrops.length} tracked drops`,
          tone: "up"
        },
        {
          label: "Mail Delays",
          value: `${delayedMailEvents.length}`,
          delta: `${deliveredMailEvents.length} delivered events`,
          tone: delayedMailEvents.length > 0 ? "down" : "up"
        },
        {
          label: "Fundraising",
          value: money(fundraising?.total_receipts || 0),
          delta: fundraising ? "Matched candidate fundraising" : "No fundraising match",
          tone: "up"
        },
        {
          label: "Alerts",
          value: `${alerts.length}`,
          delta: "Live campaign alert surface",
          tone: alerts.length > 0 ? "down" : "up"
        }
      ],
      summary: {
        contacts_count: contacts.length,
        vendors_count: vendors.length,
        open_tasks_count: openTasks.length,
        documents_count: documents.length,
        mail_programs_count: mailPrograms.length,
        mail_drops_count: mailDrops.length,
        delayed_mail_events_count: delayedMailEvents.length,
        total_mail_pieces: totalMailPieces,
        fundraising_total: n(fundraising?.total_receipts),
        cash_on_hand: n(fundraising?.cash_on_hand)
      },
      alerts,
      contacts,
      vendors,
      tasks,
      documents,
      fundraising,
      forecast: {
        snapshot: forecastSnapshot
          ? {
              id: forecastSnapshot.id,
              snapshot_run_id: forecastSnapshot.snapshot_run_id,
              created_at: forecastSnapshot.created_at,
              published_at: forecastSnapshot.published_at,
              race_count: forecastSnapshot.race_count,
              tossup_count: forecastSnapshot.tossup_count,
              high_confidence_count: forecastSnapshot.high_confidence_count
            }
          : null,
        races: forecastRaces
      },
      mail: {
        programs: mailPrograms,
        drops: mailDrops,
        recent_events: mailEvents,
        delayed_events: delayedMailEvents,
        delivered_events: deliveredMailEvents
      }
    });
  } catch (err) {
    next(err);
  }
}
