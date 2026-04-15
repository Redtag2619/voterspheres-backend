import pool from "../config/database.js";

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function getColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

function has(columns, name) {
  return columns.has(name);
}

function pick(columns, names = []) {
  for (const name of names) {
    if (has(columns, name)) return name;
  }
  return null;
}

function textColumnExpr(alias, columns, names = [], fallback = "''") {
  const col = pick(columns, names);
  if (!col) return fallback;
  return `COALESCE(${alias}.${quoteIdent(col)}::text, '')`;
}

function boolColumnExpr(alias, columns, names = [], fallback = "false") {
  const col = pick(columns, names);
  if (!col) return fallback;
  return `COALESCE(${alias}.${quoteIdent(col)}, false)`;
}

function nameExpr(alias, columns) {
  if (has(columns, "full_name")) return `COALESCE(${alias}."full_name"::text, '')`;
  if (has(columns, "name")) return `COALESCE(${alias}."name"::text, '')`;

  const first = has(columns, "first_name")
    ? `COALESCE(${alias}."first_name"::text, '')`
    : `''`;
  const last = has(columns, "last_name")
    ? `COALESCE(${alias}."last_name"::text, '')`
    : `''`;

  return `TRIM(CONCAT(${first}, ' ', ${last}))`;
}

function buildCandidateProjection(columns) {
  return {
    id: has(columns, "id") ? `c."id"` : `NULL`,
    full_name: `${nameExpr("c", columns)} AS full_name`,
    first_name: `${textColumnExpr("c", columns, ["first_name"])} AS first_name`,
    last_name: `${textColumnExpr("c", columns, ["last_name"])} AS last_name`,
    state: `${textColumnExpr("c", columns, ["state", "state_code"])} AS state`,
    office: `${textColumnExpr("c", columns, ["office", "office_name"])} AS office`,
    party: `${textColumnExpr("c", columns, ["party", "party_name"])} AS party`,
    incumbent: `${boolColumnExpr("c", columns, ["incumbent"])} AS incumbent`,
    website: `${textColumnExpr("c", columns, ["website", "campaign_website", "url"])} AS website`,
    status: `${textColumnExpr("c", columns, ["status"], "'active'")} AS status`,
    election_name: `${textColumnExpr("c", columns, ["election_name", "title", "race_name"])} AS election_name`
  };
}

function buildWhere(columns, query = {}) {
  const parts = [];
  const values = [];

  const fullName = nameExpr("c", columns);
  const state = textColumnExpr("c", columns, ["state", "state_code"]);
  const office = textColumnExpr("c", columns, ["office", "office_name"]);
  const party = textColumnExpr("c", columns, ["party", "party_name"]);
  const website = textColumnExpr("c", columns, ["website", "campaign_website", "url"]);
  const electionName = textColumnExpr("c", columns, ["election_name", "title", "race_name"]);

  if (query.q) {
    values.push(`%${String(query.q).trim()}%`);
    const i = values.length;

    parts.push(`
      (
        ${fullName} ILIKE $${i}
        OR ${state} ILIKE $${i}
        OR ${office} ILIKE $${i}
        OR ${party} ILIKE $${i}
        OR ${website} ILIKE $${i}
        OR ${electionName} ILIKE $${i}
      )
    `);
  }

  if (query.state) {
    values.push(String(query.state).trim());
    parts.push(`${state} = $${values.length}`);
  }

  if (query.office) {
    values.push(String(query.office).trim());
    parts.push(`${office} = $${values.length}`);
  }

  if (query.party) {
    values.push(String(query.party).trim());
    parts.push(`${party} = $${values.length}`);
  }

  return {
    whereClause: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    values
  };
}

export async function fetchCandidates(query = {}) {
  const columns = await getColumns("candidates");

  if (!columns.size) {
    return { total: 0, results: [] };
  }

  const projection = buildCandidateProjection(columns);
  const { whereClause, values } = buildWhere(columns, query);

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100);
  const offset = (page - 1) * limit;

  const stateOrder = textColumnExpr("c", columns, ["state", "state_code"]);
  const officeOrder = textColumnExpr("c", columns, ["office", "office_name"]);
  const nameOrder = nameExpr("c", columns);

  const sql = `
    SELECT
      ${projection.id} AS id,
      ${projection.full_name},
      ${projection.first_name},
      ${projection.last_name},
      ${projection.state},
      ${projection.office},
      ${projection.party},
      ${projection.incumbent},
      ${projection.website},
      ${projection.status},
      ${projection.election_name}
    FROM candidates c
    ${whereClause}
    ORDER BY ${stateOrder} ASC, ${officeOrder} ASC, ${nameOrder} ASC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM candidates c
    ${whereClause}
  `;

  const [listResult, countResult] = await Promise.all([
    pool.query(sql, [...values, limit, offset]),
    pool.query(countSql, values)
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    results: listResult.rows || []
  };
}

export async function fetchCandidateById(id) {
  const candidateColumns = await getColumns("candidates");

  if (!candidateColumns.size || !has(candidateColumns, "id")) {
    return null;
  }

  const projection = buildCandidateProjection(candidateColumns);

  const candidateSql = `
    SELECT
      ${projection.id} AS id,
      ${projection.full_name},
      ${projection.first_name},
      ${projection.last_name},
      ${projection.state},
      ${projection.office},
      ${projection.party},
      ${projection.incumbent},
      ${projection.website},
      ${projection.status},
      ${projection.election_name}
    FROM candidates c
    WHERE c."id" = $1
    LIMIT 1
  `;

  const candidateResult = await pool.query(candidateSql, [id]);

  if (!candidateResult.rows.length) {
    return null;
  }

  const candidate = candidateResult.rows[0];
  const profileColumns = await getColumns("candidate_profiles");

  let profile = null;

  if (profileColumns.size && has(profileColumns, "candidate_id")) {
    const field = (name) =>
      has(profileColumns, name) ? `cp.${quoteIdent(name)}` : `NULL`;

    const profileSql = `
      SELECT
        ${field("campaign_website")} AS campaign_website,
        ${field("official_website")} AS official_website,
        ${field("office_address")} AS office_address,
        ${field("campaign_address")} AS campaign_address,
        ${field("phone")} AS phone,
        ${field("email")} AS email,
        ${field("chief_of_staff_name")} AS chief_of_staff_name,
        ${field("campaign_manager_name")} AS campaign_manager_name,
        ${field("finance_director_name")} AS finance_director_name,
        ${field("political_director_name")} AS political_director_name,
        ${field("press_contact_name")} AS press_contact_name,
        ${field("press_contact_email")} AS press_contact_email,
        ${field("source_label")} AS source_label,
        ${field("updated_at")} AS updated_at,
        ${field("admin_locked")} AS admin_locked,
        ${field("locked_fields")} AS locked_fields
      FROM candidate_profiles cp
      WHERE cp."candidate_id" = $1
      LIMIT 1
    `;

    try {
      const profileResult = await pool.query(profileSql, [id]);
      profile = profileResult.rows[0] || null;
    } catch (error) {
      console.warn("candidate profile read skipped:", error.message);
    }
  }

  return {
    candidate,
    profile
  };
}

export async function fetchCandidateStates() {
  const columns = await getColumns("candidates");
  const col = pick(columns, ["state", "state_code"]);
  if (!col) return [];

  const sql = `
    SELECT DISTINCT c.${quoteIdent(col)}::text AS value
    FROM candidates c
    WHERE c.${quoteIdent(col)} IS NOT NULL
      AND c.${quoteIdent(col)}::text <> ''
    ORDER BY value ASC
  `;

  const result = await pool.query(sql);
  return result.rows.map((row) => row.value);
}

export async function fetchCandidateOffices() {
  const columns = await getColumns("candidates");
  const col = pick(columns, ["office", "office_name"]);
  if (!col) return [];

  const sql = `
    SELECT DISTINCT c.${quoteIdent(col)}::text AS value
    FROM candidates c
    WHERE c.${quoteIdent(col)} IS NOT NULL
      AND c.${quoteIdent(col)}::text <> ''
    ORDER BY value ASC
  `;

  const result = await pool.query(sql);
  return result.rows.map((row) => row.value);
}

export async function fetchCandidateParties() {
  const columns = await getColumns("candidates");
  const col = pick(columns, ["party", "party_name"]);
  if (!col) return [];

  const sql = `
    SELECT DISTINCT c.${quoteIdent(col)}::text AS value
    FROM candidates c
    WHERE c.${quoteIdent(col)} IS NOT NULL
      AND c.${quoteIdent(col)}::text <> ''
    ORDER BY value ASC
  `;

  const result = await pool.query(sql);
  return result.rows.map((row) => row.value);
}
