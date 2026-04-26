import pool from "../config/database.js";
import { publishRealtimeEvent } from "../lib/realtime.bus.js";

function scoreTier(score) {
  if (score >= 8) return "Tier 1";
  if (score >= 5) return "Tier 2";
  return "Tier 3";
}

function riskFromScore(score, hasContact, isVerified) {
  if (!hasContact) return "Elevated";
  if (score >= 8 && !isVerified) return "Watch";
  if (score >= 8) return "Strong";
  if (score >= 5) return "Monitor";
  return "Incomplete";
}

export async function getCandidateIntelligenceSummary(filters = {}) {
  const params = [];
  const where = [];

  if (filters.state) {
    params.push(filters.state);
    where.push(`c.state = $${params.length}`);
  }

  if (filters.office) {
    params.push(filters.office);
    where.push(`c.office = $${params.length}`);
  }

  if (filters.party) {
    params.push(filters.party);
    where.push(`c.party = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const query = `
    SELECT
      c.id,
      c.full_name,
      c.state,
      c.office,
      c.party,
      c.district,
      c.website,
      c.status,

      cp.campaign_website,
      cp.official_website,
      cp.email,
      cp.phone,
      cp.press_contact_email,
      cp.source_label,
      cp.updated_at AS profile_updated_at,
      cp.admin_locked,
      cp.locked_fields,
      cp.is_verified,

      CASE
        WHEN COALESCE(cp.campaign_website, '') <> ''
          OR COALESCE(cp.official_website, '') <> ''
          OR COALESCE(c.website, '') <> ''
        THEN true ELSE false
      END AS has_website,

      CASE
        WHEN COALESCE(cp.email, '') <> ''
          OR COALESCE(cp.phone, '') <> ''
          OR COALESCE(cp.press_contact_email, '') <> ''
        THEN true ELSE false
      END AS has_contact,

      (
        CASE WHEN COALESCE(cp.email, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.phone, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.press_contact_email, '') <> '' THEN 1 ELSE 0 END +
        CASE
          WHEN COALESCE(cp.campaign_website, '') <> ''
            OR COALESCE(cp.official_website, '') <> ''
            OR COALESCE(c.website, '') <> ''
          THEN 1 ELSE 0
        END
      ) AS contact_depth,

      CASE
        WHEN cp.updated_at IS NULL THEN 0
        WHEN cp.updated_at > NOW() - INTERVAL '7 days' THEN 3
        WHEN cp.updated_at > NOW() - INTERVAL '30 days' THEN 2
        WHEN cp.updated_at > NOW() - INTERVAL '90 days' THEN 1
        ELSE 0
      END AS recency_score,

      CASE WHEN cp.is_verified = true THEN 2 ELSE 0 END AS verification_score,
      CASE WHEN cp.admin_locked = true THEN -1 ELSE 0 END AS lock_penalty,

      (
        CASE WHEN COALESCE(cp.email, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.phone, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.press_contact_email, '') <> '' THEN 1 ELSE 0 END +
        CASE
          WHEN COALESCE(cp.campaign_website, '') <> ''
            OR COALESCE(cp.official_website, '') <> ''
            OR COALESCE(c.website, '') <> ''
          THEN 1 ELSE 0
        END +
        CASE
          WHEN cp.updated_at > NOW() - INTERVAL '7 days' THEN 3
          WHEN cp.updated_at > NOW() - INTERVAL '30 days' THEN 2
          WHEN cp.updated_at > NOW() - INTERVAL '90 days' THEN 1
          ELSE 0
        END +
        CASE WHEN cp.is_verified = true THEN 2 ELSE 0 END +
        CASE WHEN cp.admin_locked = true THEN -1 ELSE 0 END
      ) AS intelligence_score

    FROM candidates c
    LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
    ${whereSql}
    ORDER BY intelligence_score DESC, cp.updated_at DESC NULLS LAST, c.id DESC
    LIMIT 200
  `;

  const { rows } = await pool.query(query, params);

  const results = rows.map((row) => ({
    ...row,
    intelligence_score: Number(row.intelligence_score || 0),
    priority_tier: scoreTier(Number(row.intelligence_score || 0)),
    risk: riskFromScore(
      Number(row.intelligence_score || 0),
      row.has_contact,
      row.is_verified
    ),
    recommended_actions: [
      !row.has_contact ? "Add campaign email, phone, or press contact." : null,
      !row.has_website ? "Add campaign or official website." : null,
      !row.is_verified ? "Verify contact record." : null,
      !row.profile_updated_at ? "Run contact enrichment." : null
    ].filter(Boolean)
  }));

  return {
    summary: {
      total: results.length,
      withWebsite: results.filter((r) => r.has_website).length,
      withContact: results.filter((r) => r.has_contact).length,
      verified: results.filter((r) => r.is_verified).length,
      tier1: results.filter((r) => r.priority_tier === "Tier 1").length,
      tier2: results.filter((r) => r.priority_tier === "Tier 2").length,
      tier3: results.filter((r) => r.priority_tier === "Tier 3").length,
      elevated: results.filter((r) => r.risk === "Elevated").length
    },
    heat_map: results.reduce((acc, row) => {
      const key = row.state || "Unknown";
      if (!acc[key]) {
        acc[key] = {
          state: key,
          candidates: 0,
          avg_score: 0,
          missing_contacts: 0,
          tier1: 0
        };
      }

      acc[key].candidates += 1;
      acc[key].avg_score += row.intelligence_score;
      if (!row.has_contact) acc[key].missing_contacts += 1;
      if (row.priority_tier === "Tier 1") acc[key].tier1 += 1;

      return acc;
    }, {}),
    results
  };
}

export async function dispatchCandidateIntelligenceAlerts(filters = {}) {
  const intelligence = await getCandidateIntelligenceSummary(filters);

  const alerts = intelligence.results
    .filter((row) => row.risk === "Elevated" || row.priority_tier === "Tier 1")
    .slice(0, 25)
    .map((row) => ({
      event_type: "candidate.intelligence",
      title: `${row.full_name} candidate intelligence: ${row.risk}`,
      severity: row.risk === "Elevated" ? "High" : "Medium",
      source: "Candidate Intelligence",
      state: row.state,
      office: row.office,
      risk: row.risk,
      candidate_id: row.id,
      candidate_name: row.full_name,
      priority_tier: row.priority_tier,
      intelligence_score: row.intelligence_score,
      detail:
        row.recommended_actions?.join(" ") ||
        "Candidate intelligence record requires review."
    }));

  for (const alert of alerts) {
    publishRealtimeEvent({
      type: "alert.dispatched",
      channel: "intelligence:global",
      payload: { alert }
    });
  }

  return {
    ok: true,
    dispatched: alerts.length,
    alerts
  };
}
