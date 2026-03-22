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

export async function createCampaignCommandTask(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const {
      assigned_user_id = null,
      title,
      description = "",
      priority = "medium",
      status = "todo",
      due_date = null
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO campaign_tasks
      (campaign_id, assigned_user_id, title, description, priority, status, due_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        campaignId,
        assigned_user_id || null,
        String(title).trim(),
        description,
        priority,
        status,
        due_date || null
      ]
    );

    await logCampaignActivity(campaignId, "task_created", {
      task_id: result.rows[0].id,
      title: result.rows[0].title
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignCommandContact(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const {
      full_name,
      email = "",
      phone = "",
      role = "",
      notes = ""
    } = req.body || {};

    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: "full_name is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO campaign_contacts
      (campaign_id, full_name, email, phone, role, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [campaignId, String(full_name).trim(), email, phone, role, notes]
    );

    await logCampaignActivity(campaignId, "contact_created", {
      contact_id: result.rows[0].id,
      full_name: result.rows[0].full_name
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignCommandVendor(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const {
      vendor_name,
      category = "",
      status = "active",
      contract_value = 0,
      notes = ""
    } = req.body || {};

    if (!vendor_name || !String(vendor_name).trim()) {
      return res.status(400).json({ error: "vendor_name is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO campaign_vendors
      (campaign_id, vendor_name, category, status, contract_value, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        campaignId,
        String(vendor_name).trim(),
        category,
        status,
        n(contract_value),
        notes
      ]
    );

    await logCampaignActivity(campaignId, "vendor_created", {
      vendor_id: result.rows[0].id,
      vendor_name: result.rows[0].vendor_name
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignCommandDocument(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const {
      title,
      document_type = "",
      file_url = "",
      notes = ""
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO campaign_documents
      (campaign_id, title, document_type, file_url, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [campaignId, String(title).trim(), document_type, file_url, notes]
    );

    await logCampaignActivity(campaignId, "document_created", {
      document_id: result.rows[0].id,
      title: result.rows[0].title
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignCommandMailProgram(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const { name, description = "" } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO mail_programs
      (campaign_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [campaignId, String(name).trim(), description]
    );

    await logCampaignActivity(campaignId, "mail_program_created", {
      program_id: result.rows[0].id,
      name: result.rows[0].name
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignCommandMailDrop(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const {
      program_id = null,
      drop_date,
      quantity = 0
    } = req.body || {};

    if (!drop_date) {
      return res.status(400).json({ error: "drop_date is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO mail_drops
      (campaign_id, program_id, drop_date, quantity)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [campaignId, program_id || null, drop_date, n(quantity)]
    );

    await logCampaignActivity(campaignId, "mail_drop_created", {
      mail_drop_id: result.rows[0].id,
      quantity: result.rows[0].quantity
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignCommandMailEvent(req, res, next) {
  try {
    await ensureAllTables();

    const campaignId = Number(req.params.id);
    const campaign = await campaignExists(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    const {
      mail_drop_id = null,
      event_type,
      status = "",
      location_name = "",
      facility_type = "",
      notes = "",
      source = "manual"
    } = req.body || {};

    if (!event_type || !String(event_type).trim()) {
      return res.status(400).json({ error: "event_type is required" });
    }

    const result = await pool.query(
      `
      INSERT INTO mail_tracking_events
      (campaign_id, mail_drop_id, event_type, status, location_name, facility_type, notes, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        campaignId,
        mail_drop_id || null,
        String(event_type).trim(),
        status,
        location_name,
        facility_type,
        notes,
        source
      ]
    );

    await logCampaignActivity(campaignId, "mail_event_created", {
      event_id: result.rows[0].id,
      event_type: result.rows[0].event_type,
      mail_drop_id: result.rows[0].mail_drop_id
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
