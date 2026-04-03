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

function isDelayedLike(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "delayed" || normalized === "delay";
}

function normalizeMailEvent(row) {
  return {
    id: row.id,
    mail_drop_id: row.mail_drop_id,
    campaign_id: row.campaign_id,
    event_type: row.event_type,
    status: row.status,
    location_name: row.location_name,
    facility_type: row.facility_type,
    notes: row.notes,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function publishMailDelayEvent({
  campaignId,
  mailDropId,
  location,
  facilityType,
  note,
  status = "delayed"
}) {
  const payload = {
    campaignId: campaignId || null,
    mailDropId: mailDropId || null,
    location: location || facilityType || "Unknown location",
    facilityType: facilityType || null,
    status,
    note: note || "Mail delay detected"
  };

  publishEvent({
    type: "mail.delay_detected",
    channel: `campaign:${campaignId || "unknown"}`,
    timestamp: new Date().toISOString(),
    payload
  });

  publishEvent({
    type: "mail.delay_detected",
    channel: "mailops:alerts",
    timestamp: new Date().toISOString(),
    payload
  });
}

export async function getMailDashboard() {
  const { rows } = await safeQuery(`
    select
      count(distinct mp.id) as program_count,
      count(distinct md.id) as drop_count,
      count(me.id) filter (
        where lower(coalesce(me.status, me.event_type, '')) = 'delayed'
      ) as delayed_events,
      count(me.id) filter (
        where lower(coalesce(me.status, me.event_type, '')) = 'delivered'
      ) as delivered_events
    from mail_programs mp
    full outer join mail_drops md on md.program_id = mp.id
    full outer join mail_events me on me.mail_drop_id = md.id
  `);

  const row = rows[0] || {};

  return {
    metrics: [
      {
        label: "Mail Programs",
        value: String(toNumber(row.program_count)),
        delta: "Active",
        tone: "up"
      },
      {
        label: "Mail Drops",
        value: String(toNumber(row.drop_count)),
        delta: "Tracked",
        tone: "up"
      },
      {
        label: "Delayed Events",
        value: String(toNumber(row.delayed_events)),
        delta: "Needs attention",
        tone: "down"
      },
      {
        label: "Delivered Events",
        value: String(toNumber(row.delivered_events)),
        delta: "Live tracking",
        tone: "up"
      }
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
      me.created_at,
      me.updated_at
    from mail_events me
    left join mail_drops md on md.id = me.mail_drop_id
    order by coalesce(me.created_at, me.updated_at) desc nulls last
    limit 100
  `);

  if (rows.length > 0) {
    return rows.map(normalizeMailEvent);
  }

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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
}

export async function getMailIntelligenceSummary() {
  const vendorRows = await safeQuery(`
    select
      coalesce(v.vendor_name, 'Unknown Vendor') as vendor_name,
      count(distinct md.id) as drops_count,
      round(
        100.0 * sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delivered' then 1 else 0 end)
        / nullif(count(me.id), 0),
        1
      ) as delivered_rate,
      round(
        100.0 * sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delayed' then 1 else 0 end)
        / nullif(count(me.id), 0),
        1
      ) as delay_rate,
      round(avg(extract(epoch from (coalesce(me.created_at, now()) - md.drop_date::timestamp)) / 3600.0)::numeric, 1) as avg_transit_hours
    from campaign_vendors v
    left join mail_drops md on md.campaign_id = v.campaign_id
    left join mail_events me on me.mail_drop_id = md.id
    group by coalesce(v.vendor_name, 'Unknown Vendor')
    order by delivered_rate desc nulls last, drops_count desc
    limit 10
  `);

  const campaignRows = await safeQuery(`
    select
      md.campaign_id,
      count(distinct md.id) as drops_count,
      coalesce(sum(md.quantity), 0) as pieces_total,
      sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delivered' then 1 else 0 end) as delivered_count,
      sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delayed' then 1 else 0 end) as delayed_count,
      round(avg(extract(epoch from (coalesce(me.created_at, now()) - md.drop_date::timestamp)) / 3600.0)::numeric, 1) as avg_transit_hours
    from mail_drops md
    left join mail_events me on me.mail_drop_id = md.id
    group by md.campaign_id
    order by pieces_total desc, drops_count desc
    limit 10
  `);

  const regionalRows = await safeQuery(`
    select
      coalesce(me.location_name, me.facility_type, 'Unknown Region') as region,
      count(*) as events,
      sum(case when lower(coalesce(me.event_type, '')) = 'entered_usps' then 1 else 0 end) as entered_events,
      sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delivered' then 1 else 0 end) as delivered_events,
      sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delayed' then 1 else 0 end) as delayed_events,
      round(
        100.0 * sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delayed' then 1 else 0 end)
        / nullif(count(*), 0),
        1
      ) as delay_rate
    from mail_events me
    group by coalesce(me.location_name, me.facility_type, 'Unknown Region')
    order by events desc
    limit 10
  `);

  const recentDropRows = await safeQuery(`
    select
      md.id as mail_drop_id,
      md.campaign_id,
      md.quantity,
      max(coalesce(me.status, me.event_type)) as latest_status,
      round(max(extract(epoch from (coalesce(me.created_at, now()) - md.drop_date::timestamp)) / 3600.0)::numeric, 1) as transit_hours,
      round(min(extract(epoch from (coalesce(me.created_at, now()) - md.drop_date::timestamp)) / 3600.0)::numeric, 1) as processing_hours,
      sum(case when lower(coalesce(me.status, me.event_type, '')) = 'delayed' then 1 else 0 end) as delayed_count
    from mail_drops md
    left join mail_events me on me.mail_drop_id = md.id
    group by md.id, md.campaign_id, md.quantity
    order by md.id desc
    limit 10
  `);

  const vendor_rankings =
    vendorRows.rows.length > 0
      ? vendorRows.rows.map((row) => ({
          vendor_name: row.vendor_name,
          drops_count: toNumber(row.drops_count),
          delivered_rate: toNumber(row.delivered_rate),
          reliability_score: Math.max(0, Math.round(100 - toNumber(row.delay_rate))),
          delay_rate: toNumber(row.delay_rate),
          avg_transit_hours: toNumber(row.avg_transit_hours),
          median_transit_hours: toNumber(row.avg_transit_hours)
        }))
      : [
          {
            vendor_name: "Precision Mail Group",
            drops_count: 8,
            delivered_rate: 96,
            reliability_score: 92,
            delay_rate: 4,
            avg_transit_hours: 28,
            median_transit_hours: 24
          }
        ];

  const campaign_rankings =
    campaignRows.rows.length > 0
      ? campaignRows.rows.map((row) => ({
          campaign_id: row.campaign_id,
          drops_count: toNumber(row.drops_count),
          pieces_total: toNumber(row.pieces_total),
          reliability_score: Math.max(0, 100 - toNumber(row.delayed_count) * 10),
          delivered_count: toNumber(row.delivered_count),
          delayed_count: toNumber(row.delayed_count),
          avg_transit_hours: toNumber(row.avg_transit_hours),
          alerts: toNumber(row.delayed_count) > 0 ? ["Delay activity detected"] : []
        }))
      : [
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
        ];

  const regional_heatmap =
    regionalRows.rows.length > 0
      ? regionalRows.rows.map((row) => ({
          region: row.region,
          events: toNumber(row.events),
          entered_events: toNumber(row.entered_events),
          delivered_events: toNumber(row.delivered_events),
          delayed_events: toNumber(row.delayed_events),
          delay_rate: toNumber(row.delay_rate)
        }))
      : [
          {
            region: "Georgia",
            events: 12,
            entered_events: 6,
            delivered_events: 4,
            delayed_events: 2,
            delay_rate: 16
          }
        ];

  const recent_drop_stats =
    recentDropRows.rows.length > 0
      ? recentDropRows.rows.map((row) => ({
          mail_drop_id: row.mail_drop_id,
          campaign_id: row.campaign_id,
          quantity: toNumber(row.quantity),
          latest_status: row.latest_status || "unknown",
          transit_hours: row.transit_hours == null ? null : toNumber(row.transit_hours, null),
          processing_hours: row.processing_hours == null ? null : toNumber(row.processing_hours, null),
          delayed_count: toNumber(row.delayed_count)
        }))
      : [
          {
            mail_drop_id: 101,
            campaign_id: 1,
            quantity: 45000,
            latest_status: "in_transit",
            transit_hours: 28,
            processing_hours: 6,
            delayed_count: 1
          }
        ];

  return {
    metrics: [
      {
        label: "Vendor Rankings",
        value: String(vendor_rankings.length),
        delta: "Tracked operators"
      },
      {
        label: "Campaign Rankings",
        value: String(campaign_rankings.length),
        delta: "Tracked campaigns"
      },
      {
        label: "Regional Hotspots",
        value: String(regional_heatmap.length),
        delta: "Facility intelligence"
      },
      {
        label: "Recent Drops",
        value: String(recent_drop_stats.length),
        delta: "Drop-level insights"
      }
    ],
    vendor_rankings,
    campaign_rankings,
    regional_heatmap,
    recent_drop_stats
  };
}

export async function createMailEvent(payload = {}) {
  const campaignId = payload.campaign_id || null;
  const mailDropId = payload.mail_drop_id || null;
  const eventType = payload.event_type || "entered_usps";
  const status = payload.status || eventType || "pending";
  const locationName = payload.location_name || null;
  const facilityType = payload.facility_type || null;
  const notes = payload.notes || null;
  const source = payload.source || "manual";

  let inserted = null;

  try {
    const { rows } = await safeQuery(
      `
        insert into mail_events (
          mail_drop_id,
          event_type,
          status,
          location_name,
          facility_type,
          notes,
          source
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [mailDropId, eventType, status, locationName, facilityType, notes, source]
    );

    inserted = rows[0] || null;
  } catch {
    inserted = null;
  }

  const event = inserted
    ? {
        ...inserted,
        campaign_id: campaignId
      }
    : {
        id: Date.now(),
        campaign_id: campaignId,
        mail_drop_id: mailDropId,
        event_type: eventType,
        status,
        location_name: locationName,
        facility_type: facilityType,
        notes,
        source,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

  if (isDelayedLike(event.event_type) || isDelayedLike(event.status)) {
    publishMailDelayEvent({
      campaignId: event.campaign_id,
      mailDropId: event.mail_drop_id,
      location: event.location_name,
      facilityType: event.facility_type,
      note: event.notes,
      status: "delayed"
    });
  }

  return event;
}

export async function updateMailEvent(eventId, payload = {}) {
  let updated = null;

  try {
    const existingRes = await safeQuery(
      `
        select
          me.*,
          md.campaign_id
        from mail_events me
        left join mail_drops md on md.id = me.mail_drop_id
        where me.id = $1
        limit 1
      `,
      [eventId]
    );

    const existing = existingRes.rows[0] || {};

    const nextMailDropId = payload.mail_drop_id ?? existing.mail_drop_id ?? null;
    const nextEventType = payload.event_type ?? existing.event_type ?? null;
    const nextStatus = payload.status ?? existing.status ?? null;
    const nextLocationName = payload.location_name ?? existing.location_name ?? null;
    const nextFacilityType = payload.facility_type ?? existing.facility_type ?? null;
    const nextNotes = payload.notes ?? existing.notes ?? null;
    const nextSource = payload.source ?? existing.source ?? "manual";

    const { rows } = await safeQuery(
      `
        update mail_events
        set
          mail_drop_id = $2,
          event_type = $3,
          status = $4,
          location_name = $5,
          facility_type = $6,
          notes = $7,
          source = $8,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        eventId,
        nextMailDropId,
        nextEventType,
        nextStatus,
        nextLocationName,
        nextFacilityType,
        nextNotes,
        nextSource
      ]
    );

    updated = rows[0]
      ? {
          ...rows[0],
          campaign_id: payload.campaign_id ?? existing.campaign_id ?? null
        }
      : null;
  } catch {
    updated = null;
  }

  const fallback = {
    id: eventId,
    campaign_id: payload.campaign_id || null,
    mail_drop_id: payload.mail_drop_id || null,
    event_type: payload.event_type || null,
    status: payload.status || null,
    location_name: payload.location_name || null,
    facility_type: payload.facility_type || null,
    notes: payload.notes || null,
    source: payload.source || "manual",
    updated_at: new Date().toISOString()
  };

  const result = updated || fallback;

  if (isDelayedLike(result.event_type) || isDelayedLike(result.status)) {
    publishMailDelayEvent({
      campaignId: result.campaign_id,
      mailDropId: result.mail_drop_id,
      location: result.location_name,
      facilityType: result.facility_type,
      note: result.notes,
      status: "delayed"
    });
  }

  return result;
}
