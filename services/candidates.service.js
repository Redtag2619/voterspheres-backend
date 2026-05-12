import pool from "../config/database.js";

async function ensureCandidateProfilesColumns() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE candidate_profiles
      ADD COLUMN IF NOT EXISTS campaign_website TEXT,
      ADD COLUMN IF NOT EXISTS official_website TEXT,
      ADD COLUMN IF NOT EXISTS office_address TEXT,
      ADD COLUMN IF NOT EXISTS campaign_address TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS chief_of_staff_name TEXT,
      ADD COLUMN IF NOT EXISTS campaign_manager_name TEXT,
      ADD COLUMN IF NOT EXISTS finance_director_name TEXT,
      ADD COLUMN IF NOT EXISTS political_director_name TEXT,
      ADD COLUMN IF NOT EXISTS press_contact_name TEXT,
      ADD COLUMN IF NOT EXISTS press_contact_email TEXT,
      ADD COLUMN IF NOT EXISTS facebook_url TEXT,
      ADD COLUMN IF NOT EXISTS x_url TEXT,
      ADD COLUMN IF NOT EXISTS instagram_url TEXT,
      ADD COLUMN IF NOT EXISTS youtube_url TEXT,
      ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
      ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
      ADD COLUMN IF NOT EXISTS contact_source_url TEXT,
      ADD COLUMN IF NOT EXISTS source_label TEXT DEFAULT 'campaign_site_live',
      ADD COLUMN IF NOT EXISTS admin_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS contact_confidence NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scraped_pages JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS verified_by TEXT,
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS internal_notes TEXT,
      ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP
  `);
}

function normalizePage(value) {
  return Math.max(Number(value) || 1, 1);
}

function normalizeLimit(value) {
  return Math.min(Math.max(Number(value) || 24, 1), 100);
}

function buildWhere(query = {}) {
  const conditions = [];
  const values = [];

  if (query.q) {
    values.push(`%${String(query.q).trim()}%`);
    const i = values.length;

    conditions.push(`
      (
        COALESCE(c.full_name, c.name, '') ILIKE $${i}
        OR COALESCE(c.office, '') ILIKE $${i}
        OR COALESCE(c.state, c.state_code, '') ILIKE $${i}
        OR COALESCE(c.party, '') ILIKE $${i}
        OR COALESCE(c.election, '') ILIKE $${i}
        OR COALESCE(cp.email, c.contact_email, '') ILIKE $${i}
        OR COALESCE(cp.phone, c.phone, '') ILIKE $${i}
      )
    `);
  }

  if (query.state) {
    values.push(String(query.state).trim());
    const i = values.length;

    conditions.push(`
      (
        COALESCE(c.state, '') = $${i}
        OR COALESCE(c.state_code, '') = $${i}
      )
    `);
  }

  if (query.office) {
    values.push(String(query.office).trim());
    conditions.push(`COALESCE(c.office, '') = $${values.length}`);
  }

  if (query.party) {
    values.push(String(query.party).trim());
    conditions.push(`COALESCE(c.party, '') = $${values.length}`);
  }

  if (query.has_contact === "1" || query.has_contact === "true") {
    conditions.push(`
      (
        COALESCE(cp.email, c.contact_email, '') <> ''
        OR COALESCE(cp.phone, c.phone, '') <> ''
        OR COALESCE(cp.press_contact_email, c.press_email, '') <> ''
      )
    `);
  }

  if (query.missing_contact === "1" || query.missing_contact === "true") {
    conditions.push(`
      (
        COALESCE(cp.email, c.contact_email, '') = ''
        AND COALESCE(cp.phone, c.phone, '') = ''
        AND COALESCE(cp.press_contact_email, c.press_email, '') = ''
      )
    `);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

function candidateSelectSql() {
  return `
    c.id,
    COALESCE(c.full_name, c.name, 'Candidate') AS full_name,
    COALESCE(c.name, c.full_name, 'Candidate') AS name,
    NULL::text AS first_name,
    NULL::text AS last_name,

    COALESCE(c.state, c.state_code, '') AS state,
    c.state_code,
    COALESCE(c.office, '') AS office,
    COALESCE(c.district, '') AS district,
    COALESCE(c.party, '') AS party,
    COALESCE(c.incumbent, false) AS incumbent,
    COALESCE(c.campaign_status, c.status, 'active') AS status,
    COALESCE(c.election, c.election_year::text, '') AS election_name,
    c.election,
    c.election_year,

    COALESCE(cp.campaign_website, c.website, '') AS website,
    cp.campaign_website,
    cp.official_website,

    COALESCE(cp.email, c.contact_email, '') AS contact_email,
    COALESCE(cp.press_contact_email, c.press_email, '') AS press_email,
    COALESCE(cp.phone, c.phone, '') AS phone,

    c.address_line1,
    c.address_line2,
    c.city,
    c.postal_code,

    cp.office_address,
    cp.campaign_address,

    cp.chief_of_staff_name,
    cp.campaign_manager_name,
    cp.finance_director_name,
    cp.political_director_name,
    cp.press_contact_name,
    cp.press_contact_email,

    cp.facebook_url,
    cp.x_url,
    cp.instagram_url,
    cp.youtube_url,
    cp.linkedin_url,
    cp.tiktok_url,

    COALESCE(cp.source_label, c.contact_source, 'candidate_table') AS contact_source,
    COALESCE(cp.is_verified, c.contact_verified, false) AS contact_verified,
    cp.contact_confidence,
    cp.contact_source_url,
    cp.admin_locked,
    cp.locked_fields,
    cp.scraped_pages,
    cp.is_verified,
    cp.verified_by,
    cp.verified_at,
    cp.internal_notes,
    cp.last_scraped_at,
    COALESCE(cp.updated_at, c.last_contact_update, c.updated_at) AS last_contact_update,
    cp.updated_at AS profile_updated_at,

    CASE
      WHEN COALESCE(cp.email, c.contact_email, '') <> ''
        OR COALESCE(cp.phone, c.phone, '') <> ''
        OR COALESCE(cp.press_contact_email, c.press_email, '') <> ''
      THEN true ELSE false
    END AS has_contact,

    CASE
      WHEN COALESCE(cp.campaign_website, cp.official_website, c.website, '') <> ''
      THEN true ELSE false
    END AS has_website,

    CASE
      WHEN COALESCE(cp.facebook_url, cp.x_url, cp.instagram_url, cp.youtube_url, cp.linkedin_url, cp.tiktok_url, '') <> ''
      THEN true ELSE false
    END AS has_social
  `;
}

export async function fetchCandidates(query = {}) {
  await ensureCandidateProfilesColumns();

  const page = normalizePage(query.page);
  const limit = normalizeLimit(query.limit);
  const offset = (page - 1) * limit;

  const { whereClause, values } = buildWhere(query);

  const listSql = `
    SELECT
      ${candidateSelectSql()}
    FROM candidates c
    LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
    ${whereClause}
    ORDER BY
      COALESCE(c.state, c.state_code, '') ASC,
      COALESCE(c.office, '') ASC,
      COALESCE(c.full_name, c.name, '') ASC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM candidates c
    LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
    ${whereClause}
  `;

  const [listResult, countResult] = await Promise.all([
    pool.query(listSql, [...values, limit, offset]),
    pool.query(countSql, values),
  ]);

  return {
    page,
    limit,
    total: countResult.rows[0]?.total || 0,
    results: listResult.rows || [],
  };
}

export async function fetchCandidateById(id) {
  await ensureCandidateProfilesColumns();

  const candidateSql = `
    SELECT
      ${candidateSelectSql()}
    FROM candidates c
    LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
    WHERE c.id = $1
    LIMIT 1
  `;

  const candidateResult = await pool.query(candidateSql, [id]);

  if (!candidateResult.rows.length) {
    return null;
  }

  const candidate = candidateResult.rows[0];

  const fallbackAddress =
    [
      candidate.address_line1,
      candidate.address_line2,
      candidate.city,
      candidate.state_code || candidate.state,
      candidate.postal_code,
    ]
      .filter(Boolean)
      .join(", ") || null;

  const profile = {
    campaign_website: candidate.campaign_website || candidate.website || null,
    official_website: candidate.official_website || null,
    office_address: candidate.office_address || fallbackAddress,
    campaign_address: candidate.campaign_address || fallbackAddress,
    phone: candidate.phone || null,
    email: candidate.contact_email || null,
    chief_of_staff_name: candidate.chief_of_staff_name || null,
    campaign_manager_name: candidate.campaign_manager_name || null,
    finance_director_name: candidate.finance_director_name || null,
    political_director_name: candidate.political_director_name || null,
    press_contact_name: candidate.press_contact_name || null,
    press_contact_email: candidate.press_contact_email || candidate.press_email || null,
    facebook_url: candidate.facebook_url || null,
    x_url: candidate.x_url || null,
    instagram_url: candidate.instagram_url || null,
    youtube_url: candidate.youtube_url || null,
    linkedin_url: candidate.linkedin_url || null,
    tiktok_url: candidate.tiktok_url || null,
    contact_source_url: candidate.contact_source_url || null,
    source_label: candidate.contact_source || "candidate_table",
    admin_locked: Boolean(candidate.admin_locked),
    locked_fields: candidate.locked_fields || {},
    contact_confidence: Number(candidate.contact_confidence || 0),
    scraped_pages: candidate.scraped_pages || [],
    is_verified: Boolean(candidate.is_verified || candidate.contact_verified),
    verified_by: candidate.verified_by || null,
    verified_at: candidate.verified_at || null,
    internal_notes: candidate.internal_notes || null,
    last_scraped_at: candidate.last_scraped_at || null,
    updated_at: candidate.profile_updated_at || candidate.last_contact_update || null,
  };

  return {
    candidate,
    profile,
  };
}

export async function fetchCandidateContacts(id) {
  const detail = await fetchCandidateById(id);

  if (!detail) return null;

  return {
    candidate_id: detail.candidate.id,
    full_name: detail.candidate.full_name,
    email: detail.profile.email,
    press_email: detail.profile.press_contact_email,
    phone: detail.profile.phone,
    website: detail.profile.campaign_website || detail.candidate.website,
    official_website: detail.profile.official_website,
    campaign_address: detail.profile.campaign_address,
    office_address: detail.profile.office_address,
    facebook_url: detail.profile.facebook_url,
    x_url: detail.profile.x_url,
    instagram_url: detail.profile.instagram_url,
    youtube_url: detail.profile.youtube_url,
    linkedin_url: detail.profile.linkedin_url,
    tiktok_url: detail.profile.tiktok_url,
    contact_confidence: detail.profile.contact_confidence,
    contact_verified: detail.profile.is_verified,
    source_label: detail.profile.source_label,
    contact_source_url: detail.profile.contact_source_url,
    last_scraped_at: detail.profile.last_scraped_at,
  };
}

export async function fetchCandidateStates() {
  const result = await pool.query(`
    SELECT DISTINCT COALESCE(state, state_code) AS value
    FROM candidates
    WHERE COALESCE(state, state_code) IS NOT NULL
      AND COALESCE(state, state_code) <> ''
    ORDER BY value ASC
  `);

  return result.rows.map((row) => row.value);
}

export async function fetchCandidateOffices() {
  const result = await pool.query(`
    SELECT DISTINCT office AS value
    FROM candidates
    WHERE office IS NOT NULL
      AND office <> ''
    ORDER BY value ASC
  `);

  return result.rows.map((row) => row.value);
}

export async function fetchCandidateParties() {
  const result = await pool.query(`
    SELECT DISTINCT party AS value
    FROM candidates
    WHERE party IS NOT NULL
      AND party <> ''
    ORDER BY value ASC
  `);

  return result.rows.map((row) => row.value);
}

export async function getCandidateContactCoverage(filters = {}) {
  await ensureCandidateProfilesColumns();

  const params = [];
  const where = [];

  if (filters.state) {
    params.push(String(filters.state));
    where.push(`COALESCE(c.state, c.state_code, '') = $${params.length}`);
  }

  if (filters.office) {
    params.push(String(filters.office));
    where.push(`COALESCE(c.office, '') = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.campaign_website, cp.official_website, c.website, '') <> ''
        )::int AS with_website,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.email, c.contact_email, cp.press_contact_email, c.press_email, '') <> ''
        )::int AS with_email,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.phone, c.phone, '') <> ''
        )::int AS with_phone,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.campaign_address, cp.office_address, c.address_line1, '') <> ''
        )::int AS with_address,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.facebook_url, cp.x_url, cp.instagram_url, cp.youtube_url, cp.linkedin_url, cp.tiktok_url, '') <> ''
        )::int AS with_social,
        COUNT(*) FILTER (
          WHERE cp.is_verified = true OR c.contact_verified = true
        )::int AS verified,
        ROUND(AVG(COALESCE(cp.contact_confidence, 0))::numeric, 2) AS avg_confidence
      FROM candidates c
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${whereSql}
    `,
    params
  );

  return result.rows[0] || {
    total: 0,
    with_website: 0,
    with_email: 0,
    with_phone: 0,
    with_address: 0,
    with_social: 0,
    verified: 0,
    avg_confidence: 0,
  };
}
