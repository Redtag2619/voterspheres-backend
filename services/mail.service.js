import { pool } from "../db/pool.js";

async function ensureMailTablesInternal() {
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

function asNumber(value) {
  return Number(value || 0);
}

function hoursBetween(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;
}

function average(values) {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

function median(values) {
  const filtered = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!filtered.length) return 0;
  const mid = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0
    ? (filtered[mid - 1] + filtered[mid]) / 2
    : filtered[mid];
}

function reliabilityScore(dropStats) {
  const total = dropStats.length;
  if (!total) return 0;

  const delivered = dropStats.filter((d) => d.delivered_at).length;
  const delayed = dropStats.filter((d) =>
    d.events.some((e) => String(e.event_type || "").toLowerCase() === "delayed")
  ).length;

  const deliveredRate = delivered / total;
  const delayedRate = delayed / total;

  const avgTransit = average(
    dropStats.map((d) => {
      if (!d.entered_at || !d.delivered_at) return null;
      return hoursBetween(d.entered_at, d.delivered_at);
    })
  );

  let score = deliveredRate * 70 + (1 - delayedRate) * 20;

  if (avgTransit > 0) {
    if (avgTransit <= 48) score += 10;
    else if (avgTransit <= 72) score += 6;
    else if (avgTransit <= 96) score += 3;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

async function getAllMailIntelligenceRows() {
  const result = await pool.query(`
    SELECT
      md.id AS mail_drop_id,
      md.campaign_id,
      md.program_id,
      md.drop_date,
      md.quantity,
      mp.name AS program_name,
      mte.id AS event_id,
      mte.event_type,
      mte.status,
      mte.location_name,
      mte.facility_type,
      mte.notes,
      mte.source,
      mte.created_at AS event_created_at
    FROM mail_drops md
    LEFT JOIN mail_programs mp ON mp.id = md.program_id
    LEFT JOIN mail_tracking_events mte ON mte.mail_drop_id = md.id
    ORDER BY md.id ASC, mte.created_at ASC
  `);

  return result.rows;
}

function buildDropStats(rows) {
  const dropsMap = new Map();

  for (const row of rows) {
    if (!dropsMap.has(row.mail_drop_id)) {
      dropsMap.set(row.mail_drop_id, {
        mail_drop_id: row.mail_drop_id,
        campaign_id: row.campaign_id,
        program_id: row.program_id,
        program_name: row.program_name || null,
        drop_date: row.drop_date,
        quantity: asNumber(row.quantity),
        events: []
      });
    }

    if (row.event_id) {
      dropsMap.get(row.mail_drop_id).events.push({
        id: row.event_id,
        event_type: row.event_type,
        status: row.status,
        location_name: row.location_name,
        facility_type: row.facility_type,
        notes: row.notes,
        source: row.source,
        created_at: row.event_created_at
      });
    }
  }

  const drops = Array.from(dropsMap.values()).map((drop) => {
    const enteredEvent = drop.events.find(
      (e) => String(e.event_type || "").toLowerCase() === "entered_usps"
    );
    const deliveredEvent = [...drop.events]
      .reverse()
      .find((e) => String(e.event_type || "").toLowerCase() === "delivered");
    const delayedEvents = drop.events.filter(
      (e) => String(e.event_type || "").toLowerCase() === "delayed"
    );

    const firstEventAt = drop.events[0]?.created_at || null;
    const lastEventAt = drop.events[drop.events.length - 1]?.created_at || null;
    const enteredAt = enteredEvent?.created_at || null;
    const deliveredAt = deliveredEvent?.created_at || null;

    return {
      ...drop,
      first_event_at: firstEventAt,
      last_event_at: lastEventAt,
      entered_at: enteredAt,
      delivered_at: deliveredAt,
      delayed_count: delayedEvents.length,
      transit_hours:
        enteredAt && deliveredAt ? hoursBetween(enteredAt, deliveredAt) : null,
      processing_hours:
        drop.drop_date && enteredAt
          ? hoursBetween(
              `${drop.drop_date}T00:00:00.000Z`,
              new Date(enteredAt).toISOString()
            )
          : null,
      latest_status:
        drop.events[drop.events.length - 1]?.status ||
        drop.events[drop.events.length - 1]?.event_type ||
        "pending"
    };
  });

  return drops;
}

function buildVendorIntelligence(dropStats) {
  const vendors = new Map();

  for (const drop of dropStats) {
    const vendorEvent = drop.events.find((e) => e.location_name || e.facility_type);
    const vendorName =
      drop.events.find((e) => e.notes && e.notes.toLowerCase().includes("vendor:"))?.notes ||
      "Unassigned Vendor";

    if (!vendors.has(vendorName)) {
      vendors.set(vendorName, []);
    }

    vendors.get(vendorName).push(drop);
  }

  return Array.from(vendors.entries()).map(([vendor_name, drops]) => {
    const delivered = drops.filter((d) => d.delivered_at).length;
    const delayed = drops.filter((d) => d.delayed_count > 0).length;
    const avgTransit = average(drops.map((d) => d.transit_hours));
    const medTransit = median(drops.map((d) => d.transit_hours));

    return {
      vendor_name,
      drops_count: drops.length,
      delivered_count: delivered,
      delayed_count: delayed,
      delivered_rate: drops.length ? Math.round((delivered / drops.length) * 100) : 0,
      delay_rate: drops.length ? Math.round((delayed / drops.length) * 100) : 0,
      avg_transit_hours: Math.round(avgTransit * 10) / 10,
      median_transit_hours: Math.round(medTransit * 10) / 10,
      reliability_score: reliabilityScore(drops)
    };
  }).sort((a, b) => b.reliability_score - a.reliability_score);
}

function buildCampaignIntelligence(dropStats) {
  const campaigns = new Map();

  for (const drop of dropStats) {
    if (!campaigns.has(drop.campaign_id)) {
      campaigns.set(drop.campaign_id, []);
    }
    campaigns.get(drop.campaign_id).push(drop);
  }

  return Array.from(campaigns.entries()).map(([campaign_id, drops]) => {
    const delivered = drops.filter((d) => d.delivered_at).length;
    const delayed = drops.filter((d) => d.delayed_count > 0).length;
    const avgTransit = average(drops.map((d) => d.transit_hours));

    return {
      campaign_id,
      drops_count: drops.length,
      delivered_count: delivered,
      delayed_count: delayed,
      pieces_total: drops.reduce((sum, d) => sum + asNumber(d.quantity), 0),
      avg_transit_hours: Math.round(avgTransit * 10) / 10,
      reliability_score: reliabilityScore(drops),
      alerts: [
        delayed > 0 ? `${delayed} delayed drop(s)` : null,
        delivered < drops.length ? `${drops.length - delivered} undelivered drop(s)` : null
      ].filter(Boolean)
    };
  }).sort((a, b) => b.pieces_total - a.pieces_total);
}

function buildRegionalIntelligence(rows) {
  const regionMap = new Map();

  for (const row of rows) {
    const key = row.location_name || row.facility_type || "Unknown Region";
    if (!regionMap.has(key)) {
      regionMap.set(key, {
        region: key,
        events: 0,
        delayed_events: 0,
        entered_events: 0,
        delivered_events: 0
      });
    }

    const bucket = regionMap.get(key);
    bucket.events += 1;

    const type = String(row.event_type || "").toLowerCase();
    if (type === "delayed") bucket.delayed_events += 1;
    if (type === "entered_usps") bucket.entered_events += 1;
    if (type === "delivered") bucket.delivered_events += 1;
  }

  return Array.from(regionMap.values())
    .map((r) => ({
      ...r,
      delay_rate: r.events ? Math.round((r.delayed_events / r.events) * 100) : 0
    }))
    .sort((a, b) => b.events - a.events);
}

export async function initMailTables(req, res, next) {
  try {
    await ensureMailTablesInternal();
    res.json({ ok: true, message: "Mail tables initialized" });
  } catch (err) {
    next(err);
  }
}

export async function getMailDashboardHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();

    const programs = await pool.query(`SELECT COUNT(*) FROM mail_programs`);
    const drops = await pool.query(`SELECT COUNT(*) FROM mail_drops`);
    const events = await pool.query(`SELECT COUNT(*) FROM mail_tracking_events`);

    res.json({
      metrics: [
        { label: "Programs", value: programs.rows[0].count },
        { label: "Drops", value: drops.rows[0].count },
        { label: "Tracking Events", value: events.rows[0].count }
      ]
    });
  } catch (err) {
    next(err);
  }
}

export async function listMailProgramsHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const { campaign_id } = req.query;

    const result = await pool.query(
      `SELECT * FROM mail_programs WHERE ($1::int IS NULL OR campaign_id = $1) ORDER BY id DESC`,
      [campaign_id || null]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function createMailProgramHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const { campaign_id, name, description } = req.body;

    const result = await pool.query(
      `INSERT INTO mail_programs (campaign_id, name, description)
       VALUES ($1,$2,$3) RETURNING *`,
      [campaign_id, name, description]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function listMailDropsHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const { campaign_id } = req.query;

    const result = await pool.query(
      `SELECT * FROM mail_drops WHERE ($1::int IS NULL OR campaign_id = $1) ORDER BY id DESC`,
      [campaign_id || null]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function createMailDropHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const { campaign_id, program_id, drop_date, quantity } = req.body;

    const result = await pool.query(
      `INSERT INTO mail_drops (campaign_id, program_id, drop_date, quantity)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [campaign_id, program_id, drop_date, quantity]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createMailTrackingEventHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const {
      campaign_id,
      mail_drop_id,
      event_type,
      status,
      location_name,
      facility_type,
      notes,
      source
    } = req.body;

    const result = await pool.query(
      `INSERT INTO mail_tracking_events
       (campaign_id, mail_drop_id, event_type, status, location_name, facility_type, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [campaign_id, mail_drop_id, event_type, status, location_name, facility_type, notes, source]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getPlatformMailTimelineHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const result = await pool.query(
      `SELECT * FROM mail_tracking_events ORDER BY created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignMailTimelineHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const { campaignId } = req.params;

    const result = await pool.query(
      `SELECT * FROM mail_tracking_events WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [campaignId]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getMailDropTimelineHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM mail_tracking_events WHERE mail_drop_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getMailIntelligenceSummaryHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();

    const rows = await getAllMailIntelligenceRows();
    const dropStats = buildDropStats(rows);
    const vendorStats = buildVendorIntelligence(dropStats);
    const campaignStats = buildCampaignIntelligence(dropStats);
    const regionalStats = buildRegionalIntelligence(rows);

    const avgTransit = average(dropStats.map((d) => d.transit_hours));
    const delayedDrops = dropStats.filter((d) => d.delayed_count > 0).length;
    const deliveredDrops = dropStats.filter((d) => d.delivered_at).length;

    res.json({
      metrics: [
        {
          label: "Tracked Drops",
          value: `${dropStats.length}`,
          delta: "Mail intelligence surface",
          tone: "up"
        },
        {
          label: "Delivered Drops",
          value: `${deliveredDrops}`,
          delta: "Confirmed delivered",
          tone: "up"
        },
        {
          label: "Delayed Drops",
          value: `${delayedDrops}`,
          delta: "Operational alerts",
          tone: delayedDrops > 0 ? "down" : "up"
        },
        {
          label: "Avg Transit",
          value: `${Math.round(avgTransit * 10) / 10}h`,
          delta: "Entered USPS to delivered",
          tone: "up"
        }
      ],
      summary: {
        drops_count: dropStats.length,
        delivered_drops: deliveredDrops,
        delayed_drops: delayedDrops,
        avg_transit_hours: Math.round(avgTransit * 10) / 10
      },
      vendor_rankings: vendorStats,
      campaign_rankings: campaignStats,
      regional_heatmap: regionalStats,
      recent_drop_stats: dropStats.slice().sort((a, b) => b.mail_drop_id - a.mail_drop_id).slice(0, 25)
    });
  } catch (err) {
    next(err);
  }
}

export async function getMailVendorIntelligenceHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const rows = await getAllMailIntelligenceRows();
    const dropStats = buildDropStats(rows);
    res.json(buildVendorIntelligence(dropStats));
  } catch (err) {
    next(err);
  }
}

export async function getMailCampaignIntelligenceHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const rows = await getAllMailIntelligenceRows();
    const dropStats = buildDropStats(rows);
    res.json(buildCampaignIntelligence(dropStats));
  } catch (err) {
    next(err);
  }
}

export async function getMailRegionalIntelligenceHandler(req, res, next) {
  try {
    await ensureMailTablesInternal();
    const rows = await getAllMailIntelligenceRows();
    res.json(buildRegionalIntelligence(rows));
  } catch (err) {
    next(err);
  }
}
