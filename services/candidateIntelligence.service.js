import pool from "../config/database.js";

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

      -- =========================
      -- BASE FLAGS
      -- =========================
      CASE
        WHEN COALESCE(cp.campaign_website, '') <> '' OR COALESCE(cp.official_website, '') <> '' THEN true
        ELSE false
      END AS has_website,

      CASE
        WHEN COALESCE(cp.email, '') <> '' OR COALESCE(cp.phone, '') <> '' OR COALESCE(cp.press_contact_email, '') <> '' THEN true
        ELSE false
      END AS has_contact,

      -- =========================
      -- CONTACT DEPTH SCORE (0–4)
      -- =========================
      (
        CASE WHEN COALESCE(cp.email, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.phone, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.press_contact_email, '') <> '' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(cp.campaign_website, '') <> '' OR COALESCE(cp.official_website, '') <> '' THEN 1 ELSE 0 END
      ) AS contact_depth,

      -- =========================
      -- RECENCY SCORE
      -- =========================
      CASE
        WHEN cp.updated_at IS NULL THEN 0
        WHEN cp.updated_at > NOW() - INTERVAL '7 days' THEN 3
        WHEN cp.updated_at > NOW() - INTERVAL '30 days' THEN 2
        WHEN cp.updated_at > NOW() - INTERVAL '90 days' THEN 1
        ELSE 0
      END AS recency_score,

      -- =========================
      -- VERIFIED BOOST
      -- =========================
      CASE
        WHEN cp.is_verified = true THEN 2
        ELSE 0
      END AS verification_score,

      -- =========================
      -- LOCK PENALTY
      -- =========================
      CASE
        WHEN cp.admin_locked = true THEN -1
        ELSE 0
      END AS lock_penalty,

      -- =========================
      -- VENDOR SIGNAL (future ready)
      -- =========================
      COALESCE(v.vendor_count, 0) AS vendor_count,

      -- =========================
      -- FINAL INTELLIGENCE SCORE
      -- =========================
      (
        -- contact quality (max 4)
        (
          CASE WHEN COALESCE(cp.email, '') <> '' THEN 1 ELSE 0 END +
          CASE WHEN COALESCE(cp.phone, '') <> '' THEN 1 ELSE 0 END +
          CASE WHEN COALESCE(cp.press_contact_email, '') <> '' THEN 1 ELSE 0 END +
          CASE WHEN COALESCE(cp.campaign_website, '') <> '' OR COALESCE(cp.official_website, '') <> '' THEN 1 ELSE 0 END
        )

        -- recency (max 3)
        +
        CASE
          WHEN cp.updated_at > NOW() - INTERVAL '7 days' THEN 3
          WHEN cp.updated_at > NOW() - INTERVAL '30 days' THEN 2
          WHEN cp.updated_at > NOW() - INTERVAL '90 days' THEN 1
          ELSE 0
        END

        -- verified bonus
        +
        CASE WHEN cp.is_verified = true THEN 2 ELSE 0 END

        -- vendor signal (scaled)
        +
        LEAST(COALESCE(v.vendor_count, 0), 3)

        -- penalty
        +
        CASE WHEN cp.admin_locked = true THEN -1 ELSE 0 END

      ) AS intelligence_score

    FROM candidates c

    LEFT JOIN candidate_profiles cp
      ON cp.candidate_id = c.id

    -- vendor signal join (optional future table)
    LEFT JOIN (
      SELECT candidate_id, COUNT(*) AS vendor_count
      FROM vendor_engagements
      GROUP BY candidate_id
    ) v
      ON v.candidate_id = c.id

    ${whereSql}

    ORDER BY intelligence_score DESC, cp.updated_at DESC NULLS LAST, c.id DESC
    LIMIT 200
  `;

  const { rows } = await pool.query(query, params);

  const summary = {
    total: rows.length,
    withWebsite: rows.filter((r) => r.has_website).length,
    withContact: rows.filter((r) => r.has_contact).length,
    verified: rows.filter((r) => r.is_verified).length,
    locked: rows.filter((r) => r.admin_locked).length,

    highPriority: rows.filter((r) => r.intelligence_score >= 6).length,
    midPriority: rows.filter((r) => r.intelligence_score >= 3 && r.intelligence_score < 6).length,
    lowPriority: rows.filter((r) => r.intelligence_score < 3).length
  };

  return {
    summary,
    results: rows
  };
}
