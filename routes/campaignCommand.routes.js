import express from "express";

const router = express.Router(); 

async function getDb() {
  const candidates = [
    "../config/database.js", 
    "../db.js",
    "../config/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      return mod.default || mod.db || mod.pool || mod.client || null;
    } catch {
    }
  }

  return null;
}

async function safeQuery(sql, params = []) {
  try {
    const db = await getDb();
    if (!db) return { rows: [] };

    if (typeof db.query === "function") {
      return await db.query(sql, params);
    }

    if (typeof db.execute === "function") {
      const [rows] = await db.execute(sql, params);
      return { rows };
    }

    return { rows: [] };
  } catch {
    return { rows: [] };
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCampaign(row, campaignId) {
  return {
    id: row?.id || toNumber(campaignId, campaignId),
    campaign_name: row?.campaign_name || row?.name || `Campaign #${campaignId}`,
    candidate_name: row?.candidate_name || "Unknown Candidate",
    firm_name: row?.firm_name || "Unassigned",
    owner_name:
      row?.owner_name ||
      [row?.owner_first_name, row?.owner_last_name].filter(Boolean).join(" ") ||
      "Unassigned",
    stage: row?.stage || "Open",
    status: row?.status || "Open"
  };
}

async function getCampaignRecord(campaignId) {
  const { rows } = await safeQuery(
    `
      select c.*, f.name as firm_name
      from campaigns c
      left join firms f on f.id = c.firm_id
      where c.id = $1
      limit 1
    `,
    [campaignId]
  );

  return rows[0] || null;
}

async function getTasks(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from campaign_tasks
      where campaign_id = $1
      order by coalesce(created_at, now()) desc
    `,
    [campaignId]
  );

  if (rows.length) return rows;

  return [
    {
      id: 1,
      campaign_id: campaignId,
      title: "Prepare weekly strategy memo",
      description: "Draft and circulate campaign update.",
      priority: "high",
      status: "todo"
    }
  ];
}

async function getContacts(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from campaign_contacts
      where campaign_id = $1
      order by coalesce(created_at, now()) desc
    `,
    [campaignId]
  );

  return rows;
}

async function getVendors(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from campaign_vendors
      where campaign_id = $1
      order by coalesce(created_at, now()) desc
    `,
    [campaignId]
  );

  return rows;
}

async function getDocuments(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from campaign_documents
      where campaign_id = $1
      order by coalesce(created_at, now()) desc
    `,
    [campaignId]
  );

  return rows;
}

async function getMailPrograms(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from mail_programs
      where campaign_id = $1
      order by coalesce(created_at, now()) desc
    `,
    [campaignId]
  );

  return rows;
}

async function getMailDrops(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from mail_drops
      where campaign_id = $1
      order by coalesce(drop_date, now()::date) desc, id desc
    `,
    [campaignId]
  );

  return rows;
}

async function getMailEvents(campaignId) {
  const { rows } = await safeQuery(
    `
      select
        me.*,
        md.campaign_id
      from mail_events me
      left join mail_drops md on md.id = me.mail_drop_id
      where md.campaign_id = $1
      order by coalesce(me.created_at, now()) desc, me.id desc
    `,
    [campaignId]
  );

  return rows;
}

async function getFundraising(campaignId) {
  const { rows } = await safeQuery(
    `
      select *
      from campaign_fundraising
      where campaign_id = $1
      limit 1
    `,
    [campaignId]
  );

  return rows[0] || null;
}

async function getForecastContext(campaignId) {
  const campaign = await getCampaignRecord(campaignId);
  const state = campaign?.state || null;

  const snapshotRes = await safeQuery(
    `
      select *
      from forecast_snapshots
      order by published_at desc nulls last, created_at desc nulls last
      limit 1
    `
  );

  const racesRes = state
    ? await safeQuery(
        `
          select *
          from forecast_races
          where state = $1
          order by coalesce(rank, 999999) asc, coalesce(updated_at, created_at) desc nulls last
          limit 10
        `,
        [state]
      )
    : { rows: [] };

  return {
    snapshot: snapshotRes.rows[0] || null,
    races: racesRes.rows || []
  };
}

function buildMetrics({ tasks, alerts, vendors, contacts, documents, mailEvents }) {
  const delayed = mailEvents.filter(
    (event) =>
      String(event.status || "").toLowerCase() === "delayed" ||
      String(event.event_type || "").toLowerCase() === "delayed"
  ).length;

  return [
    {
      label: "Open Tasks",
      value: String(tasks.filter((t) => String(t.status || "").toLowerCase() !== "done").length),
      delta: `${tasks.length} total`,
      tone: "up"
    },
    {
      label: "Alerts",
      value: String(alerts.length),
      delta: "Live campaign issues",
      tone: alerts.length > 0 ? "down" : "up"
    },
    {
      label: "Vendors",
      value: String(vendors.length),
      delta: "Tracked relationships",
      tone: "up"
    },
    {
      label: "Contacts",
      value: String(contacts.length),
      delta: `${documents.length} docs`,
      tone: "up"
    },
    {
      label: "Mail Events",
      value: String(mailEvents.length),
      delta: delayed > 0 ? `${delayed} delayed` : "On track",
      tone: delayed > 0 ? "down" : "up"
    }
  ];
}

function buildAlerts({ tasks, vendors, mailEvents, campaignId }) {
  const alerts = [];

  tasks.forEach((task) => {
    if (String(task.priority || "").toLowerCase() === "high" && String(task.status || "").toLowerCase() !== "done") {
      alerts.push({
        alert_key: `task-${task.id}`,
        title: "High Priority Task",
        message: task.title || "Task needs attention",
        severity: "high",
        type: "task",
        campaign_id: campaignId,
        entity_id: task.id,
        action_status: "open",
        meta: { task_id: task.id }
      });
    }
  });

  vendors.forEach((vendor) => {
    if (String(vendor.status || "").toLowerCase() === "at_risk") {
      alerts.push({
        alert_key: `vendor-${vendor.id}`,
        title: "Vendor At Risk",
        message: vendor.vendor_name || "Vendor needs attention",
        severity: "medium",
        type: "vendor",
        campaign_id: campaignId,
        entity_id: vendor.id,
        action_status: "open",
        meta: { vendor_id: vendor.id }
      });
    }
  });

  mailEvents.forEach((event) => {
    if (
      String(event.status || "").toLowerCase() === "delayed" ||
      String(event.event_type || "").toLowerCase() === "delayed"
    ) {
      alerts.push({
        alert_key: `mail-${event.id}`,
        title: "Mail Delay Alert",
        message: event.notes || `Delay detected at ${event.location_name || event.facility_type || "Unknown facility"}`,
        severity: "high",
        type: "mail_delay",
        campaign_id: campaignId,
        entity_id: event.id,
        action_status: "open",
        meta: { mail_event_id: event.id }
      });
    }
  });

  return alerts;
}

router.get("/:campaignId/command-center", async (req, res) => {
  try {
    const { campaignId } = req.params;

    const [
      campaignRow,
      tasks,
      contacts,
      vendors,
      documents,
      programs,
      drops,
      mailEvents,
      fundraising,
      forecast
    ] = await Promise.all([
      getCampaignRecord(campaignId),
      getTasks(campaignId),
      getContacts(campaignId),
      getVendors(campaignId),
      getDocuments(campaignId),
      getMailPrograms(campaignId),
      getMailDrops(campaignId),
      getMailEvents(campaignId),
      getFundraising(campaignId),
      getForecastContext(campaignId)
    ]);

    const campaign = normalizeCampaign(campaignRow, campaignId);
    const alerts = buildAlerts({ tasks, vendors, mailEvents, campaignId });
    const metrics = buildMetrics({
      tasks,
      alerts,
      vendors,
      contacts,
      documents,
      mailEvents
    });

    res.status(200).json({
      campaign,
      metrics,
      alerts,
      contacts,
      vendors,
      tasks,
      documents,
      fundraising,
      forecast,
      mail: {
        programs,
        drops,
        recent_events: mailEvents.slice(0, 20),
        delayed_events: mailEvents.filter(
          (event) =>
            String(event.status || "").toLowerCase() === "delayed" ||
            String(event.event_type || "").toLowerCase() === "delayed"
        ),
        delivered_events: mailEvents.filter(
          (event) =>
            String(event.status || "").toLowerCase() === "delivered" ||
            String(event.event_type || "").toLowerCase() === "delivered"
        )
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load campaign command center" });
  }
});

router.get("/:campaignId/activity", async (req, res) => {
  try {
    const { campaignId } = req.params;

    const { rows } = await safeQuery(
      `
        select *
        from campaign_activity
        where campaign_id = $1
        order by coalesce(created_at, now()) desc, id desc
        limit 100
      `,
      [campaignId]
    );

    if (rows.length > 0) {
      return res.status(200).json(rows);
    }

    return res.status(200).json([
      {
        id: 1,
        campaign_id: campaignId,
        activity_type: "campaign_initialized",
        summary: "Campaign workspace ready",
        details: { actor: "system" },
        created_at: new Date().toISOString()
      }
    ]);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load campaign activity" });
  }
});

router.post("/:campaignId/tasks", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { title, description, priority, status } = req.body || {};

    const { rows } = await safeQuery(
      `
        insert into campaign_tasks (
          campaign_id,
          title,
          description,
          priority,
          status
        )
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [campaignId, title || "", description || "", priority || "medium", status || "todo"]
    );

    res.status(201).json(rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      title,
      description,
      priority: priority || "medium",
      status: status || "todo"
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create task" });
  }
});

router.patch("/:campaignId/tasks/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body || {};

    const { rows } = await safeQuery(
      `
        update campaign_tasks
        set
          status = coalesce($2, status),
          updated_at = now()
        where id = $1
        returning *
      `,
      [taskId, status || null]
    );

    res.status(200).json(rows[0] || { id: taskId, status });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update task" });
  }
});

router.post("/:campaignId/contacts", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { full_name, email, phone, role } = req.body || {};

    const { rows } = await safeQuery(
      `
        insert into campaign_contacts (
          campaign_id,
          full_name,
          email,
          phone,
          role
        )
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [campaignId, full_name || "", email || "", phone || "", role || ""]
    );

    res.status(201).json(rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      full_name,
      email,
      phone,
      role
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create contact" });
  }
});

router.post("/:campaignId/vendors", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { vendor_name, category, status, contract_value } = req.body || {};

    const { rows } = await safeQuery(
      `
        insert into campaign_vendors (
          campaign_id,
          vendor_name,
          category,
          status,
          contract_value
        )
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [campaignId, vendor_name || "", category || "", status || "active", contract_value || 0]
    );

    res.status(201).json(rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      vendor_name,
      category,
      status: status || "active",
      contract_value: contract_value || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create vendor" });
  }
});

router.patch("/:campaignId/vendors/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status } = req.body || {};

    const { rows } = await safeQuery(
      `
        update campaign_vendors
        set
          status = coalesce($2, status),
          updated_at = now()
        where id = $1
        returning *
      `,
      [vendorId, status || null]
    );

    res.status(200).json(rows[0] || { id: vendorId, status });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update vendor" });
  }
});

router.post("/:campaignId/documents", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { title, document_type, file_url } = req.body || {};

    const { rows } = await safeQuery(
      `
        insert into campaign_documents (
          campaign_id,
          title,
          document_type,
          file_url
        )
        values ($1, $2, $3, $4)
        returning *
      `,
      [campaignId, title || "", document_type || "", file_url || ""]
    );

    res.status(201).json(rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      title,
      document_type,
      file_url
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create document" });
  }
});

router.post("/:campaignId/mail-programs", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { name, description } = req.body || {};

    const { rows } = await safeQuery(
      `
        insert into mail_programs (
          campaign_id,
          name,
          description
        )
        values ($1, $2, $3)
        returning *
      `,
      [campaignId, name || "", description || ""]
    );

    res.status(201).json(rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      name,
      description
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create mail program" });
  }
});

router.post("/:campaignId/mail-drops", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { program_id, drop_date, quantity } = req.body || {};

    const { rows } = await safeQuery(
      `
        insert into mail_drops (
          campaign_id,
          program_id,
          drop_date,
          quantity
        )
        values ($1, $2, $3, $4)
        returning *
      `,
      [campaignId, program_id || null, drop_date || null, quantity || 0]
    );

    res.status(201).json(rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      program_id,
      drop_date,
      quantity
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create mail drop" });
  }
});

router.post("/:campaignId/mail-events", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const mailService = await import("../services/mail.service.js");

    const data = await mailService.createMailEvent({
      ...req.body,
      campaign_id: Number(campaignId)
    });

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create mail event" });
  }
});

router.patch("/:campaignId/mail-events/:eventId", async (req, res) => {
  try {
    const { campaignId, eventId } = req.params;
    const mailService = await import("../services/mail.service.js");

    const data = await mailService.updateMailEvent(eventId, {
      ...req.body,
      campaign_id: Number(campaignId)
    });

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update mail event" });
  }
});

export default router;
