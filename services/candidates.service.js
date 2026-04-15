import pool from "../config/database.js";

export async function fetchCandidates(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100);
  const offset = (page - 1) * limit;

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

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const listSql = `
    SELECT
      c.id,
      COALESCE(c.full_name, c.name, 'Candidate') AS full_name,
      NULL::text AS first_name,
      NULL::text AS last_name,
      COALESCE(c.state, c.state_code, '') AS state,
      COALESCE(c.office, '') AS office,
      COALESCE(c.party, '') AS party,
      COALESCE(c.incumbent, false) AS incumbent,
      COALESCE(c.website, '') AS website,
      COALESCE(c.campaign_status, 'active') AS status,
      COALESCE(c.election, '') AS election_name
    FROM candidates c
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
    ${whereClause}
  `;

  const [listResult, countResult] = await Promise.all([
    pool.query(listSql, [...values, limit, offset]),
    pool.query(countSql, values)
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    results: listResult.rows || []
  };
}

export async function fetchCandidateById(id) {
  const candidateSql = `
    SELECT
      c.id,
      COALESCE(c.full_name, c.name, 'Candidate') AS full_name,
      NULL::text AS first_name,
      NULL::text AS last_name,
      COALESCE(c.state, c.state_code, '') AS state,
      COALESCE(c.office, '') AS office,
      COALESCE(c.party, '') AS party,
      COALESCE(c.incumbent, false) AS incumbent,
      COALESCE(c.website, '') AS website,
      COALESCE(c.campaign_status, 'active') AS status,
      COALESCE(c.election, '') AS election_name,
      c.contact_email,
      c.press_email,
      c.phone,
      c.address_line1,
      c.address_line2,
      c.city,
      c.state_code,
      c.postal_code,
      c.contact_source,
      c.contact_verified,
      c.last_contact_update
    FROM candidates c
    WHERE c.id = $1
    LIMIT 1
  `;

  const candidateResult = await pool.query(candidateSql, [id]);

  if (!candidateResult.rows.length) {
    return null;
  }

  const candidate = candidateResult.rows[0];

  let profile = null;

  try {
    const profileSql = `
      SELECT
        campaign_website,
        official_website,
        office_address,
        campaign_address,
        phone,
        email,
        chief_of_staff_name,
        campaign_manager_name,
        finance_director_name,
        political_director_name,
        press_contact_name,
        press_contact_email,
        source_label,
        admin_locked,
        locked_fields,
        updated_at
      FROM candidate_profiles
      WHERE candidate_id = $1
      LIMIT 1
    `;

    const profileResult = await pool.query(profileSql, [id]);
    profile = profileResult.rows[0] || null;
  } catch (error) {
    profile = null;
  }

  if (!profile) {
    profile = {
      campaign_website: candidate.website || null,
      official_website: null,
      office_address: [
        candidate.address_line1,
        candidate.address_line2,
        candidate.city,
        candidate.state_code,
        candidate.postal_code
      ]
        .filter(Boolean)
        .join(", ") || null,
      campaign_address: [
        candidate.address_line1,
        candidate.address_line2,
        candidate.city,
        candidate.state_code,
        candidate.postal_code
      ]
        .filter(Boolean)
        .join(", ") || null,
      phone: candidate.phone || null,
      email: candidate.contact_email || null,
      chief_of_staff_name: null,
      campaign_manager_name: null,
      finance_director_name: null,
      political_director_name: null,
      press_contact_name: null,
      press_contact_email: candidate.press_email || null,
      source_label: candidate.contact_source || "candidate_table",
      admin_locked: false,
      locked_fields: {},
      updated_at: candidate.last_contact_update || null
    };
  }

  return {
    candidate,
    profile
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
