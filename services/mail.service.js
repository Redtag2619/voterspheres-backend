import { publishEvent } from "../lib/intelligence.events.js";
import {
  publishCampaignAlert,
  publishCampaignActivity,
  publishCampaignMailUpdated
} from "./campaignAlerts.service.js";

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
      // try next
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

export async function getMailDashboard() {
  const { rows } = await safeQuery(`
    select
      count(distinct mp.id) as program_count,
      count(distinct md.id) as drop_count,
      count(*) filter (where lower(coalesce(me.status, '')) = 'delayed' or lower(coalesce(me.event_type, '')) = 'delayed') as delayed_events,
      count(*) filter (where lower(coalesce(me.status, '')) = 'delivered' or lower(coalesce(me.event_type, '')) = 'delivered') as delivered_events
    from mail_programs mp
    full outer join mail_drops md on md.program_id = mp.id
    full outer join mail_events me on me.mail_drop_id = md.id
  `);

  const row = rows[0] || {};

  return {
    metrics: [
      { label: "Mail Programs", value: String(toNumber(row.program_count)), delta: "Active", tone: "up" },
      { label: "Mail Drops", value: String(toNumber(row.drop_count)), delta: "Tracked", tone: "up" },
      { label: "Delayed Events", value: String(toNumber(row.delayed_events)), delta: "Needs attention", tone: "down" },
      { label: "Delivered Events", value: String(toNumber(row.delivered_events)), delta: "Live tracking", tone: "up" }
    ]
  };
}

export async function getMailTimeline() {
  const { rows } = await safeQuery(`
    select
      me.id,
      me.mail_drop_id,
      md.campaign_id,
      me.event_type,
      me.status,
      me.location_name,
      me.facility_type,
      me.notes,
      me.source,
      me.created_at
    from mail_events me
    left join mail_drops md on md.id = me.mail_drop_id
    order by me.created_at desc nulls last
    limit 100
  `);

  if (rows.length > 0) return rows;

  return [
    {
      id: 1,
      mail_drop_id: 101,
      campaign_id: 1,
      event_type: "entered_usps",
      status: "in_transit",
      location_name: "Atlanta NDC",
      facility_type: "NDC",
      notes: "Initial intake scan",
      source: "manual",
      created_at: new Date().toISOString()
    }
  ];
}

export async function getMailIntelligenceSummary() {
  return {
    metrics: [
      { label: "Vendor Rankings", value: "3", delta: "Tracked operators" },
      { label: "Campaign Rankings", value: "3", delta: "Tracked campaigns" },
      { label: "Regional Hotspots", value: "1", delta: "Facility intelligence" },
      { label: "Recent Drops", value: "1", delta: "Drop-level insights" }
    ],
    vendor_rankings: [
      {
        vendor_name: "Precision Mail Group",
        drops_count: 8,
        delivered_rate: 96,
        reliability_score: 92,
        delay_rate: 4,
        avg_transit_hours: 28,
        median_transit_hours: 24
      }
    ],
    campaign_rankings: [
      {
        campaign_id: 1,
        drops_count: 4,
        pieces_total: 125000,
        reliability_score: 89,
        delivered_count: 3,
        delayed_count: 1,
        avg_transit_hours: 31,
        alerts: ["Delay spike in Atlanta NDC"]
      }
    ],
    regional_heatmap: [
      {
        region: "Georgia",
        events: 12,
        entered_events: 6,
        delivered_events: 4,
        delayed_events: 2,
        delay_rate: 16
      }
    ],
    recent_drop_stats: [
      {
        mail_drop_id: 101,
        campaign_id: 1,
        quantity: 45000,
        latest_status: "in_transit",
        transit_hours: 28,
        processing_hours: 6,
        delayed_count: 1
      }
    ]
  };
}

function emitDelaySignals(event) {
  publishEvent({
    type: "mail.delay_detected",
    channel: "mailops:alerts",
    timestamp: new Date().toISOString(),
    payload: {
      campaignId: event.campaign_id,
      mailDropId: event.mail_drop_id,
      location: event.location_name || event.facility_type || "Unknown location",
      status: "delayed",
      note: event.notes || "Mail delay detected"
    }
  });

  publishCampaignAlert({
    campaignId: event.campaign_id,
    type: "mail_delay",
    title: "Mail delay detected",
    message: `Mail drop #${event.mail_drop_id || "N/A"} has a delay at ${event.location_name || event.facility_type || "Unknown location"}.`,
    severity: "high",
    entityId: event.id,
    meta: {
      mail_event_id: event.id,
      mail_drop_id: event.mail_drop_id,
      location: event.location_name || event.facility_type || null
    }
  });

  publishCampaignActivity({
    campaignId: event.campaign_id,
    activityType: "mail_delay_detected",
    summary: `Mail delay detected for drop #${event.mail_drop_id || "N/A"}`,
    metadata: {
      mail_event_id: event.id,
      location: event.location_name || event.facility_type || "Unknown location",
      status: event.status || event.event_type || "delayed"
    }
  });

  publishCampaignMailUpdated({
    campaignId: event.campaign_id,
    mailEvent: event
  });
}

export async function createMailEvent(payload = {}) {
  const event = {
    id: Date.now(),
    campaign_id: payload.campaign_id || null,
    mail_drop_id: payload.mail_drop_id || null,
    event_type: payload.event_type || "entered_usps",
    status: payload.status || payload.event_type || "pending",
    location_name: payload.location_name || null,
    facility_type: payload.facility_type || null,
    notes: payload.notes || null,
    source: payload.source || "manual",
    created_at: new Date().toISOString()
  };

  publishCampaignMailUpdated({
    campaignId: event.campaign_id,
    mailEvent: event
  });

  publishCampaignActivity({
    campaignId: event.campaign_id,
    activityType: "mail_event_created",
    summary: `Mail event created: ${event.event_type || event.status}`,
    metadata: {
      mail_event_id: event.id,
      mail_drop_id: event.mail_drop_id,
      location: event.location_name || event.facility_type || null
    }
  });

  if (
    String(event.event_type).toLowerCase() === "delayed" ||
    String(event.status).toLowerCase() === "delayed"
  ) {
    emitDelaySignals(event);
  }

  return event;
}

export async function updateMailEvent(eventId, payload = {}) {
  const updated = {
    id: eventId,
    ...payload,
    updated_at: new Date().toISOString()
  };

  publishCampaignMailUpdated({
    campaignId: updated.campaign_id,
    mailEvent: updated
  });

  publishCampaignActivity({
    campaignId: updated.campaign_id,
    activityType: "mail_event_updated",
    summary: `Mail event updated: ${updated.event_type || updated.status}`,
    metadata: {
      mail_event_id: updated.id,
      mail_drop_id: updated.mail_drop_id,
      status: updated.status || updated.event_type || null
    }
  });

  if (
    String(updated.event_type || "").toLowerCase() === "delayed" ||
    String(updated.status || "").toLowerCase() === "delayed"
  ) {
    emitDelaySignals(updated);
  }

  return updated;
}
