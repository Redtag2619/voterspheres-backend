import pool from "../config/database.js";

const DEFAULT_LIMIT = 100;

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeLimit(value) {
  return Math.min(Math.max(Number(value || DEFAULT_LIMIT), 1), 500);
}

function opportunityBand(score) {
  const value = Number(score || 0);
  if (value >= 80) return "urgent";
  if (value >= 60) return "high";
  if (value >= 40) return "medium";
  return "low";
}

function recommendedPitch(row = {}) {
  const missing = [];

  if (!row.has_email) missing.push("contact acquisition");
  if (!row.has_phone) missing.push("direct outreach");
  if (!row.has_social) missing.push("digital presence");
  if (!row.has_website) missing.push("campaign website");
  if (!row.has_address) missing.push("operations footprint");
  if (!row.has_press_contact) missing.push("press/comms");
  if (!row.has_staff) missing.push("campaign staffing");

  if (!missing.length) {
    return "Campaign appears contact-ready. Pitch advanced voter targeting, fundraising intelligence, vendor optimization, and rapid-response operations.";
  }

  return `Pitch ${missing.slice(0, 3).join(", ")} support plus VoterSpheres operational intelligence.`;
}

function opportunityReasons(row = {}) {
  const reasons = [];

  if (!row.has_website) reasons.push("Missing or weak campaign website");
  if (!row.has_email) reasons.push("Missing public campaign email");
  if (!row.has_phone) reasons.push("Missing campaign phone");
  if (!row.has_social) reasons.push("No social channels discovered");
  if (!row.has_address) reasons.push("No campaign or office address");
  if (!row.has_press_contact) reasons.push("No press contact found");
  if (!row.has_staff) reasons.push("No staff contacts detected");

  const confidence = Number(row.contact_confidence || 0);
  if (confidence < 0.45) reasons.push("Low contact confidence");

  if (
    row.state &&
    ["PA", "GA", "AZ", "MI", "WI", "NV", "NC", "OH", "FL", "TX"].includes(
      String(row.state).toUpperCase()
    )
  ) {
    reasons.push("Priority battleground or high-value state");
  }

  return reasons;
}

function consultantServices(row = {}) {
  const services = [];

  if (!row.has_website || !row.has_social) services.push("Digital strategy");
  if (!row.has_email || !row.has_phone || !row.has_address) {
    services.push("Campaign operations");
  }
  if (!row.has_press_contact) services.push("Communications / press");
  if (!row.has_staff) services.push("Staffing and campaign management");

  services.push("Fundraising intelligence");
  services.push("Vendor network matching");

  return [...new Set(services)].slice(0, 6);
}

async function ensureOpportunityTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_opportunity_scores (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      opportunity_score NUMERIC NOT NULL DEFAULT 0,
      opportunity_band TEXT NOT NULL DEFAULT 'low',
      reasons JSONB DEFAULT '[]'::jsonb,
      recommended_services JSONB DEFAULT '[]'::jsonb,
      recommended_pitch TEXT,
      source_snapshot JSONB DEFAULT '{}'::jsonb,
      scored_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS consultant_opportunity_scores_score_idx
      ON consultant_opportunity_scores(opportunity_score DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS consultant_opportunity_scores_band_idx
      ON consultant_opportunity_scores(opportunity_band)
  `);
}

function buildOpportunityScore(row = {}) {
  let score = 0;

  if (!row.has_website) score += 18;
  if (!row.has_email) score += 15;
  if (!row.has_phone) score += 12;
  if (!row.has_social) score += 16;
  if (!row.has_address) score += 8;
  if (!row.has_press_contact) score += 9;
  if (!row.has_staff) score += 10;

  const confidence = Number(row.contact_confidence || 0);
  if (confidence < 0.25) score += 12;
  else if (confidence < 0.45) score += 8;
  else if (confidence < 0.65) score += 4;

  const state = clean(row.state).toUpperCase();
  if (["PA", "GA", "AZ", "MI", "WI", "NV", "NC"].includes(state)) score += 10;
  else if (["OH", "FL", "TX", "VA", "CO", "NH", "ME", "MN"].includes(state)) score += 6;

  const office = clean(row.office).toLowerCase();
  if (office.includes("senate") || office.includes("governor")) score += 8;
  else if (office.includes("house") || office.includes("congress")) score += 6;
  else if (office.includes("state") || office.includes("mayor") || office.includes("county")) score += 4;

  if (row.incumbent === false || row.incumbent === "false") score += 4;

  return Math.min(100, Math.round(score));
}

async function candidateOpportunityRows(filters = {}) {
  const params = [];
  const where = [];

  if (filters.state) {
    params.push(clean(filters.state).toUpperCase());
    where.push(`UPPER(COALESCE(c.state, c.state_code, '')) = $${params.length}`);
  }

  if (filters.office) {
    params.push(`%${clean(filters.office)}%`);
    where.push(`COALESCE(c.office, '') ILIKE $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${clean(filters.q)}%`);
    where.push(`
      (
        COALESCE(c.full_name, c.name, '') ILIKE $${params.length}
        OR COALESCE(c.office, '') ILIKE $${params.length}
        OR COALESCE(c.state, c.state_code, '') ILIKE $${params.length}
        OR COALESCE(c.party, '') ILIKE $${params.length}
      )
    `);
  }

  const limit = normalizeLimit(filters.limit);
  params.push(limit);
  const limitParam = params.length;

  const result = await pool.query(
    `
      SELECT
        c.id AS candidate_id,
        COALESCE(c.full_name, c.name, 'Candidate') AS candidate_name,
        COALESCE(c.state, c.state_code, '') AS state,
        COALESCE(c.office, '') AS office,
        COALESCE(c.district, '') AS district,
        COALESCE(c.party, '') AS party,
        COALESCE(c.incumbent, false) AS incumbent,
        COALESCE(cp.campaign_website, cp.official_website, c.website, '') <> '' AS has_website,
        COALESCE(cp.email, c.contact_email, '') <> '' AS has_email,
        COALESCE(cp.phone, c.phone, '') <> '' AS has_phone,
        COALESCE(cp.campaign_address, cp.office_address, c.address_line1, '') <> '' AS has_address,
        COALESCE(cp.press_contact_email, c.press_email, '') <> '' AS has_press_contact,
        COALESCE(
          cp.chief_of_staff_name,
          cp.campaign_manager_name,
          cp.finance_director_name,
          cp.political_director_name,
          cp.press_contact_name,
          ''
        ) <> '' AS has_staff,
        COALESCE(
          cp.facebook_url,
          cp.x_url,
          cp.instagram_url,
          cp.youtube_url,
          cp.linkedin_url,
          cp.tiktok_url,
          ''
        ) <> '' AS has_social,
        COALESCE(cp.contact_confidence, 0) AS contact_confidence,
        COALESCE(cp.is_verified, c.contact_verified, false) AS contact_verified,
        cp.last_scraped_at,
        COALESCE(cp.source_label, c.contact_source, 'candidate_table') AS source_label,
        COALESCE(cp.campaign_website, cp.official_website, c.website, '') AS website,
        COALESCE(cp.email, c.contact_email, '') AS email,
        COALESCE(cp.phone, c.phone, '') AS phone
      FROM candidates c
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.id ASC
      LIMIT $${limitParam}
    `,
    params
  );

  return result.rows || [];
}

export async function scoreConsultantOpportunities(filters = {}) {
  await ensureOpportunityTables();

  const rows = await candidateOpportunityRows(filters);
  const scored = [];

  for (const row of rows) {
    const opportunity_score = buildOpportunityScore(row);
    const opportunity_band = opportunityBand(opportunity_score);
    const reasons = opportunityReasons(row);
    const recommended_services = consultantServices(row);
    const recommended_pitch = recommendedPitch(row);

    const source_snapshot = {
      has_website: row.has_website,
      has_email: row.has_email,
      has_phone: row.has_phone,
      has_address: row.has_address,
      has_press_contact: row.has_press_contact,
      has_staff: row.has_staff,
      has_social: row.has_social,
      contact_confidence: Number(row.contact_confidence || 0),
      contact_verified: Boolean(row.contact_verified),
      source_label: row.source_label || null,
      last_scraped_at: row.last_scraped_at || null,
    };

    const saved = await pool.query(
      `
        INSERT INTO consultant_opportunity_scores (
          candidate_id,
          opportunity_score,
          opportunity_band,
          reasons,
          recommended_services,
          recommended_pitch,
          source_snapshot,
          scored_at,
          updated_at,
          created_at
        )
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,NOW(),NOW(),NOW())
        ON CONFLICT (candidate_id)
        DO UPDATE SET
          opportunity_score = EXCLUDED.opportunity_score,
          opportunity_band = EXCLUDED.opportunity_band,
          reasons = EXCLUDED.reasons,
          recommended_services = EXCLUDED.recommended_services,
          recommended_pitch = EXCLUDED.recommended_pitch,
          source_snapshot = EXCLUDED.source_snapshot,
          scored_at = NOW(),
          updated_at = NOW()
        RETURNING *
      `,
      [
        row.candidate_id,
        opportunity_score,
        opportunity_band,
        JSON.stringify(reasons),
        JSON.stringify(recommended_services),
        recommended_pitch,
        JSON.stringify(source_snapshot),
      ]
    );

    scored.push({
      ...row,
      ...saved.rows[0],
      reasons,
      recommended_services,
      recommended_pitch,
      source_snapshot,
    });
  }

  return scored;
}

export async function getConsultantOpportunitySummary(filters = {}) {
  await ensureOpportunityTables();

  const params = [];
  const where = [];

  if (filters.state) {
    params.push(clean(filters.state).toUpperCase());
    where.push(`UPPER(COALESCE(c.state, c.state_code, '')) = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'urgent')::int AS urgent_count,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'high')::int AS high_count,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'medium')::int AS medium_count,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'low')::int AS low_count,
        ROUND(AVG(cos.opportunity_score)::numeric, 1) AS avg_score,
        MAX(cos.scored_at) AS last_scored_at
      FROM consultant_opportunity_scores cos
      JOIN candidates c ON c.id = cos.candidate_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
    params
  );

  return result.rows[0] || {};
}

export async function listConsultantOpportunities(filters = {}) {
  await ensureOpportunityTables();

  if (filters.refresh === true || filters.refresh === "true" || filters.rescore === true) {
    await scoreConsultantOpportunities(filters);
  }

  const params = [];
  const where = [];

  if (filters.band && filters.band !== "all") {
    params.push(clean(filters.band));
    where.push(`cos.opportunity_band = $${params.length}`);
  }

  if (filters.state) {
    params.push(clean(filters.state).toUpperCase());
    where.push(`UPPER(COALESCE(c.state, c.state_code, '')) = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${clean(filters.q)}%`);
    where.push(`
      (
        COALESCE(c.full_name, c.name, '') ILIKE $${params.length}
        OR COALESCE(c.office, '') ILIKE $${params.length}
        OR COALESCE(c.state, c.state_code, '') ILIKE $${params.length}
        OR COALESCE(c.party, '') ILIKE $${params.length}
      )
    `);
  }

  const limit = normalizeLimit(filters.limit);
  params.push(limit);
  const limitParam = params.length;

  const result = await pool.query(
    `
      SELECT
        cos.*,
        COALESCE(c.full_name, c.name, 'Candidate') AS candidate_name,
        COALESCE(c.state, c.state_code, '') AS state,
        COALESCE(c.office, '') AS office,
        COALESCE(c.district, '') AS district,
        COALESCE(c.party, '') AS party,
        COALESCE(c.incumbent, false) AS incumbent,
        COALESCE(cp.campaign_website, cp.official_website, c.website, '') AS website,
        COALESCE(cp.email, c.contact_email, '') AS email,
        COALESCE(cp.phone, c.phone, '') AS phone,
        cp.facebook_url,
        cp.x_url,
        cp.instagram_url,
        cp.youtube_url,
        cp.linkedin_url,
        cp.tiktok_url,
        cp.contact_confidence,
        cp.last_scraped_at
      FROM consultant_opportunity_scores cos
      JOIN candidates c ON c.id = cos.candidate_id
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY cos.opportunity_score DESC, cos.scored_at DESC
      LIMIT $${limitParam}
    `,
    params
  );

  const summary = await getConsultantOpportunitySummary(filters);

  return {
    results: result.rows || [],
    summary,
  };
}

export async function getConsultantOpportunityDetail(candidateId) {
  await ensureOpportunityTables();

  const result = await pool.query(
    `
      SELECT
        cos.*,
        COALESCE(c.full_name, c.name, 'Candidate') AS candidate_name,
        COALESCE(c.state, c.state_code, '') AS state,
        COALESCE(c.office, '') AS office,
        COALESCE(c.district, '') AS district,
        COALESCE(c.party, '') AS party,
        COALESCE(cp.campaign_website, cp.official_website, c.website, '') AS website,
        COALESCE(cp.email, c.contact_email, '') AS email,
        COALESCE(cp.phone, c.phone, '') AS phone,
        cp.contact_confidence,
        cp.last_scraped_at
      FROM consultant_opportunity_scores cos
      JOIN candidates c ON c.id = cos.candidate_id
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      WHERE cos.candidate_id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  return result.rows[0] || null;
}

export async function getCampaignOpportunityHeatmap(filters = {}) {
  await ensureOpportunityTables();

  if (filters.refresh === true || filters.refresh === "true") {
    await scoreConsultantOpportunities({
      limit: filters.limit || 500,
      state: filters.state || null,
    });
  }

  const params = [];
  const where = [];

  if (filters.state) {
    params.push(clean(filters.state).toUpperCase());
    where.push(`UPPER(COALESCE(c.state, c.state_code, '')) = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const stateResult = await pool.query(
    `
      SELECT
        COALESCE(c.state, c.state_code, 'NA') AS state,
        COUNT(*)::int AS total_campaigns,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'urgent')::int AS urgent_count,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'high')::int AS high_count,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'medium')::int AS medium_count,
        COUNT(*) FILTER (WHERE cos.opportunity_band = 'low')::int AS low_count,
        ROUND(AVG(cos.opportunity_score)::numeric, 1) AS avg_score,
        MAX(cos.opportunity_score)::int AS top_score,
        MAX(cos.scored_at) AS last_scored_at
      FROM consultant_opportunity_scores cos
      JOIN candidates c ON c.id = cos.candidate_id
      ${whereSql}
      GROUP BY COALESCE(c.state, c.state_code, 'NA')
      ORDER BY avg_score DESC NULLS LAST, urgent_count DESC, high_count DESC
    `,
    params
  );

  const topResult = await pool.query(
    `
      SELECT
        cos.*,
        COALESCE(c.full_name, c.name, 'Candidate') AS candidate_name,
        COALESCE(c.state, c.state_code, 'NA') AS state,
        COALESCE(c.office, '') AS office,
        COALESCE(c.party, '') AS party,
        COALESCE(cp.campaign_website, cp.official_website, c.website, '') AS website,
        COALESCE(cp.email, c.contact_email, '') AS email,
        COALESCE(cp.phone, c.phone, '') AS phone,
        cp.contact_confidence,
        cp.last_scraped_at
      FROM consultant_opportunity_scores cos
      JOIN candidates c ON c.id = cos.candidate_id
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${whereSql}
      ORDER BY cos.opportunity_score DESC, cos.scored_at DESC
      LIMIT 25
    `,
    params
  );

  const states = stateResult.rows.map((row) => {
    const avgScore = Number(row.avg_score || 0);

    return {
      ...row,
      avg_score: avgScore,
      heat_level:
        avgScore >= 80
          ? "urgent"
          : avgScore >= 60
            ? "high"
            : avgScore >= 40
              ? "medium"
              : "low",
    };
  });

  const summary = {
    states: states.length,
    total_campaigns: states.reduce(
      (sum, row) => sum + Number(row.total_campaigns || 0),
      0
    ),
    urgent_count: states.reduce(
      (sum, row) => sum + Number(row.urgent_count || 0),
      0
    ),
    high_count: states.reduce(
      (sum, row) => sum + Number(row.high_count || 0),
      0
    ),
    avg_score: states.length
      ? Number(
          (
            states.reduce((sum, row) => sum + Number(row.avg_score || 0), 0) /
            states.length
          ).toFixed(1)
        )
      : 0,
    last_scored_at:
      states
        .map((row) => row.last_scored_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
  };

  return {
    summary,
    states,
    top_opportunities: topResult.rows || [],
  };
}
