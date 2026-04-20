import pool from "../config/database.js";

export async function getBattlegroundDashboardData() {
  const query = `
    SELECT
      c.state,
      c.office,
      COUNT(*) AS candidate_count,

      SUM(
        CASE
          WHEN COALESCE(cp.verified_status, '') = 'verified' THEN 1
          ELSE 0
        END
      ) AS verified_profiles,

      SUM(
        CASE
          WHEN COALESCE(cp.campaign_website, '') <> ''
            OR COALESCE(cp.official_website, '') <> ''
          THEN 1
          ELSE 0
        END
      ) AS website_count,

      SUM(
        CASE
          WHEN COALESCE(cp.email, '') <> ''
            OR COALESCE(cp.phone, '') <> ''
            OR COALESCE(cp.press_contact_email, '') <> ''
          THEN 1
          ELSE 0
        END
      ) AS contact_count,

      MAX(cp.updated_at) AS last_profile_update

    FROM candidates c
    LEFT JOIN candidate_profiles cp
      ON cp.candidate_id = c.id
    WHERE c.state IS NOT NULL
      AND c.office IS NOT NULL
    GROUP BY c.state, c.office
    HAVING COUNT(*) > 0
    ORDER BY
      COUNT(*) DESC,
      SUM(
        CASE
          WHEN COALESCE(cp.verified_status, '') = 'verified' THEN 1
          ELSE 0
        END
      ) ASC,
      MAX(cp.updated_at) ASC NULLS LAST
    LIMIT 12
  `;

  const { rows } = await pool.query(query);

  const results = rows.map((row, index) => {
    const candidateCount = Number(row.candidate_count || 0);
    const verifiedProfiles = Number(row.verified_profiles || 0);
    const contactCount = Number(row.contact_count || 0);
    const websiteCount = Number(row.website_count || 0);

    const coverageRatio =
      candidateCount > 0
        ? (verifiedProfiles + contactCount + websiteCount) / (candidateCount * 3)
        : 0;

    const winProbability = Math.max(
      45,
      Math.min(62, Math.round(52 + (coverageRatio - 0.5) * 10 - index * 0.4))
    );

    const momentum = (coverageRatio * 4 - 1.5).toFixed(1);

    const risk =
      coverageRatio >= 0.8 ? "Stabilized" :
      coverageRatio >= 0.55 ? "Watch" :
      "Elevated";

    const priority =
      index < 4 ? "Tier 1" :
      index < 8 ? "Tier 2" :
      "Tier 3";

    return {
      id: `${row.state}-${row.office}`.toLowerCase().replace(/\s+/g, "-"),
      race: `${row.state} ${row.office}`,
      state: row.state,
      office: row.office,
      candidate_count: candidateCount,
      verified_profiles: verifiedProfiles,
      website_count: websiteCount,
      contact_count: contactCount,
      last_profile_update: row.last_profile_update,
      win_probability: winProbability,
      momentum: Number(momentum),
      risk,
      priority
    };
  });

  return {
    results
  };
}
