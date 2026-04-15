import pool from "../config/database.js";

function buildCandidateFilters(query = {}) {
  const conditions = [];
  const values = [];

  if (query.q) {
    values.push(`%${query.q}%`);
    conditions.push(`
      (
        COALESCE(c.full_name, '') ILIKE $${values.length}
        OR COALESCE(c.first_name, '') ILIKE $${values.length}
        OR COALESCE(c.last_name, '') ILIKE $${values.length}
        OR COALESCE(c.office, '') ILIKE $${values.length}
        OR COALESCE(c.state, '') ILIKE $${values.length}
        OR COALESCE(c.party, '') ILIKE $${values.length}
      )
    `);
  }

  if (query.state) {
    values.push(query.state);
    conditions.push(`COALESCE(c.state, '') = $${values.length}`);
  }

  if (query.office) {
    values.push(query.office);
    conditions.push(`COALESCE(c.office, '') = $${values.length}`);
  }

  if (query.party) {
    values.push(query.party);
    conditions.push(`COALESCE(c.party, '') = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { whereClause, values };
}

export async function fetchCandidates(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100);
  const offset = (page - 1) * limit;

  const { whereClause, values } = buildCandidateFilters(query);

  const listSql = `
    SELECT
      c.id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.state,
      c.office,
      c.party,
      COALESCE(c.incumbent, false) AS incumbent,
      c.website,
      COALESCE(c.status, 'active') AS status,
      COALESCE(c.election_name, '') AS election_name
    FROM candidates c
    ${whereClause}
    ORDER BY c.state NULLS LAST, c.office NULLS LAST, c.last_name NULLS LAST, c.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM candidates c
    ${whereClause}
  `;

  const listResult = await pool.query(listSql, [...values, limit, offset]);
  const countResult = await pool.query(countSql, values);

  return {
    total: countResult.rows[0]?.total || 0,
    results: listResult.rows || []
  };
}

export async function fetchCandidateById(id) {
  const candidateSql = `
    SELECT
      c.id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.state,
      c.office,
      c.party,
      COALESCE(c.incumbent, false) AS incumbent,
      c.website,
      COALESCE(c.status, 'active') AS status,
      COALESCE(c.election_name, '') AS election_name
    FROM candidates c
    WHERE c.id = $1
    LIMIT 1
  `;

  const profileSql = `
    SELECT
      cp.campaign_website,
      cp.official_website,
      cp.office_address,
      cp.campaign_address,
      cp.phone,
      cp.email,
      cp.chief_of_staff_name,
      cp.campaign_manager_name,
      cp.finance_director_name,
      cp.political_director_name,
      cp.press_contact_name,
      cp.press_contact_email,
      cp.source_label,
      cp.updated_at
    FROM candidate_profiles cp
    WHERE cp.candidate_id = $1
    LIMIT 1
  `;

  const candidateResult = await pool.query(candidateSql, [id]);

  if (!candidateResult.rows.length) {
    return null;
  }

  let profile = null;

  try {
    const profileResult = await pool.query(profileSql, [id]);
    profile = profileResult.rows[0] || null;
  } catch (error) {
    console.warn("candidate_profiles lookup skipped:", error.message);
  }

  return {
    candidate: candidateResult.rows[0],
    profile
  };
}

export async function fetchCandidateStates() {
  const sql = `
    SELECT DISTINCT c.state
    FROM candidates c
    WHERE c.state IS NOT NULL AND c.state <> ''
    ORDER BY c.state ASC
  `;
  const result = await pool.query(sql);
  return result.rows.map((row) => row.state);
}

export async function fetchCandidateOffices() {
  const sql = `
    SELECT DISTINCT c.office
    FROM candidates c
    WHERE c.office IS NOT NULL AND c.office <> ''
    ORDER BY c.office ASC
  `;
  const result = await pool.query(sql);
  return result.rows.map((row) => row.office);
}

export async function fetchCandidateParties() {
  const sql = `
    SELECT DISTINCT c.party
    FROM candidates c
    WHERE c.party IS NOT NULL AND c.party <> ''
    ORDER BY c.party ASC
  `;
  const result = await pool.query(sql);
  return result.rows.map((row) => row.party);
}
