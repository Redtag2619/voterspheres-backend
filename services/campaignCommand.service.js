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

export async function logCampaignActivity({
  campaign_id,
  activity_type,
  summary,
  details = {},
  metadata = {}
}) {
  const campaignId = campaign_id || null;
  const type = activity_type || "activity_logged";
  const safeSummary = summary || null;
  const payload = Object.keys(details || {}).length ? details : metadata || {};

  try {
    const { rows } = await safeQuery(
      `
        insert into campaign_activity (
          campaign_id,
          activity_type,
          summary,
          details,
          metadata,
          created_at
        )
        values ($1, $2, $3, $4, $5, now())
        returning *
      `,
      [
        campaignId,
        type,
        safeSummary,
        JSON.stringify(payload || {}),
        JSON.stringify(payload || {})
      ]
    );

    return rows[0] || {
      id: Date.now(),
      campaign_id: campaignId,
      activity_type: type,
      summary: safeSummary,
      details: payload,
      metadata: payload,
      created_at: new Date().toISOString()
    };
  } catch {
    return {
      id: Date.now(),
      campaign_id: campaignId,
      activity_type: type,
      summary: safeSummary,
      details: payload,
      metadata: payload,
      created_at: new Date().toISOString()
    };
  }
}

export async function getCampaignActivity(campaignId, limit = 100) {
  const { rows } = await safeQuery(
    `
      select *
      from campaign_activity
      where campaign_id = $1
      order by coalesce(created_at, now()) desc, id desc
      limit $2
    `,
    [campaignId, limit]
  );

  return rows;
}

export default {
  logCampaignActivity,
  getCampaignActivity
};
