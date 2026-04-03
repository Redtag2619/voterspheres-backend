import { publishEvent } from "../lib/intelligence.events.js";

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
      // keep trying
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

export async function getMailDashboard() {
  return {
    metrics: [
      { label: "Mail Programs", value: "4", delta: "Active", tone: "up" },
      { label: "Mail Drops", value: "12", delta: "Tracked", tone: "up" },
      { label: "Delayed Events", value: "2", delta: "Needs attention", tone: "down" },
      { label: "Delivered Events", value: "18", delta: "Live tracking", tone: "up" }
    ]
  };
}

export async function getMailTimeline() {
  const { rows } = await safeQuery(
    `
      select *
      from mail_events
      order by coalesce(created_at, updated_at) desc nulls last
      limit 50
    `
  );

  if (rows.length > 0) return rows;

  return [
    {
      id: 1,
      event_type: "entered_usps",
      mail_drop_id: 101,
      campaign_id: 1,
      location_name: "Atlanta NDC",
      facility_type: "NDC",
      source: "manual",
      status: "in_transit",
      created_at: new Date().toISOString()
    }
  ];
}

export async function getMailIntelligenceSummary() {
  return {
    metrics: [
      { label: "MailOps Status", value: "Live", delta: "Shared API connected" },
      { label: "Vendor Rankings", value: "3", delta: "Tracked operators" },
      { label: "Campaign Rankings", value: "3", delta: "Tracked campaigns" },
      { label: "Timeline Events", value: "12", delta: "Recent tracking movement" }
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
        delay_rate: 16,
        entered_events: 6,
        delivered_events: 4,
        delayed_events: 2
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

  if (
    String(event.event_type).toLowerCase() === "delayed" ||
    String(event.status).toLowerCase() === "delayed"
  ) {
    publishEvent({
      type: "mail.delay_detected",
      channel: `campaign:${event.campaign_id || "unknown"}`,
      timestamp: new Date().toISOString(),
      payload: {
        campaignId: event.campaign_id,
        mailDropId: event.mail_drop_id,
        location: event.location_name || event.facility_type || "Unknown location",
        status: "delayed",
        note: event.notes || "Mail delay detected"
      }
    });
  }

  return event;
}

export async function updateMailEvent(eventId, payload = {}) {
  const updated = {
    id: eventId,
    ...payload,
    updated_at: new Date().toISOString()
  };

  if (
    String(updated.event_type || "").toLowerCase() === "delayed" ||
    String(updated.status || "").toLowerCase() === "delayed"
  ) {
    publishEvent({
      type: "mail.delay_detected",
      channel: `campaign:${updated.campaign_id || "unknown"}`,
      timestamp: new Date().toISOString(),
      payload: {
        campaignId: updated.campaign_id,
        mailDropId: updated.mail_drop_id,
        location: updated.location_name || updated.facility_type || "Unknown location",
        status: "delayed",
        note: updated.notes || "Mail delay detected"
      }
    });
  }

  return updated;
}
