import pool from "../config/database.js";

let schemaCache = {
  candidates: null,
  candidate_profiles: null
};

async function getTableColumns(tableName) {
  if (schemaCache[tableName]) return schemaCache[tableName];

  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  const columns = new Set(result.rows.map((row) => row.column_name));
  schemaCache[tableName] = columns;
  return columns;
}

function has(columns, name) {
  return columns.has(name);
}

function qcol(name) {
  return `"${name}"`;
}

function pickFirstExisting(columns, names = []) {
  for (const name of names) {
    if (has(columns, name)) return name;
  }
  return null;
}

function textExpr(columns, names = [], fallback = "''") {
  const col = pickFirstExisting(columns, names);
  return col ? `COALESCE(c.${qcol(col)}::text, '')` : fallback;
}

function boolExpr(columns, names = [], fallback = "false") {
  const col = pickFirstExisting(columns, names);
  return col ? `COALESCE(c.${qcol(col)}, false)` : fallback;
}

function buildFullNameExpr(columns) {
  if (has(columns, "full_name")) return `COALESCE(c."full_name"::text, '')`;
  if (has(columns, "name")) return `COALESCE(c."name"::text, '')`;

  const first = has(columns, "first_name")
    ? `COALESCE(c."first_name"::text, '')`
    : `''`;
  const last = has(columns, "last_name")
    ? `COALESCE(c."last_name"::text, '')`
    : `''`;

  return `TRIM(CONCAT(${first}, ' ', ${last}))`;
}

function buildCandidateSelect(columns) {
  const idCol = pickFirstExisting(columns, ["id"]) || "id";

  return {
    id: `c.${qcol(idCol)} AS id`,
    full_name: `${buildFullNameExpr(columns)} AS full_name`,
    first_name: `${textExpr(columns, ["first_name"])} AS first_name`,
    last_name: `${textExpr(columns, ["last_name"])} AS last_name`,
    state: `${textExpr(columns, ["state", "state_code"])} AS state`,
    office: `${textExpr(columns, ["office", "office_name"])} AS office`,
    party: `${textExpr(columns, ["party", "party_name"])} AS party`,
    incumbent: `${boolExpr(columns, ["incumbent"])} AS incumbent`,
    website: `${textExpr(columns, ["website", "campaign_website", "url"])} AS website`,
    status: `${textExpr(columns, ["status"], "'active'")} AS status`,
    election_name: `${textExpr(columns, ["election_name", "title", "race_name"])} AS election_name`
  };
}

function buildSearchConditions(columns, query = {}) {
  const conditions = [];
  const values = [];

  const fullNameExpr = buildFullNameExpr(columns);
  const stateExpr = textExpr(columns, ["state", "state_code"]);
  const officeExpr = textExpr(columns, ["office", "office_name"]);
  const partyExpr = textExpr(columns, ["party", "party_name"]);
  const websiteExpr = textExpr(columns, ["website", "campaign_website", "url"]);
  const electionExpr = textExpr(columns, ["election_name", "title", "race_name"]);

  if (query.q) {
    values.push(`%${String(query.q).trim()}%`);
    const idx = values.length;

    conditions.push(`
      (
        ${fullNameExpr} ILIKE $${idx}
        OR ${stateExpr} ILIKE $${idx}
        OR ${officeExpr} ILIKE $${idx}
        OR ${partyExpr} ILIKE $${idx}
        OR ${websiteExpr} ILIKE $${idx}
        OR ${electionExpr} ILIKE $${idx}
      )
    `);
  }

  if (query.state) {
    values.push(String(query.state).trim());
    conditions.push(`${stateExpr} = $${values.length}`);
  }

  if (query.office) {
    values.push(String(query.office).trim());
    conditions.push(`${officeExpr} = $${values.length}`);
  }

  if (query.party) {
    values.push(String(query.party).trim());
    conditions.push(`${partyExpr} = $${values.length}`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

export async function fetchCandidates(query = {}) {
  const columns = await getTableColumns("candidates");

  if (!columns.size) {
    throw new Error('Table "candidates" was not found in public schema');
  }

  const select = buildCandidateSelect(columns);
  const { whereClause, values } = buildSearchConditions(columns, query);

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100);
  const offset = (page - 1) * limit;

  const stateOrderExpr = textExpr(columns, ["state", "state_code"]);
  const officeOrderExpr = textExpr(columns, ["office", "office_name"]);
  const lastNameOrderExpr = textExpr(columns, ["last_name", "name", "full_name"]);

  const sql = `
    SELECT
      ${select.id},
      ${select.full_name},
      ${select.first_name},
      ${select.last_name},
      ${select.state},
      ${select.office},
      ${select.party},
      ${select.incumbent},
      ${select.website},
      ${select.status},
      ${select.election_name}
    FROM candidates c
    ${whereClause}
    ORDER BY
      ${stateOrderExpr} ASC,
      ${officeOrderExpr} ASC,
      ${lastNameOrderExpr} ASC,
      id DESC
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
  const candidateColumns = await getTableColumns("candidates");

  if (!candidateColumns.size) {
    throw new Error('Table "candidates" was not found in public schema');
  }

  const select = buildCandidateSelect(candidateColumns);

  const candidateSql = `
    SELECT
      ${select.id},
      ${select.full_name},
      ${select.first_name},
      ${select.last_name},
      ${select.state},
      ${select.office},
      ${select.party},
      ${select.incumbent},
      ${select.website},
      ${select.status},
      ${select.election_name}
    FROM candidates c
    WHERE c."id" = $1
    LIMIT 1
  `;

  const candidateResult = await pool.query(candidateSql, [id]);

  if (!candidateResult.rows.length) {
    return null;
  }

  const candidate = candidateResult.rows[0];
  const profileColumns = await getTableColumns("candidate_profiles");

  let profile = null;

  if (profileColumns.size) {
    const profileField = (name) =>
      has(profileColumns, name) ? `cp.${qcol(name)}` : `NULL`;

    const profileSql = `
      SELECT
        ${profileField("campaign_website")} AS campaign_website,
        ${profileField("official_website")} AS official_website,
        ${profileField("office_address")} AS office_address,
        ${profileField("campaign_address")} AS campaign_address,
        ${profileField("phone")} AS phone,
        ${profileField("email")} AS email,
        ${profileField("chief_of_staff_name")} AS chief_of_staff_name,
        ${profileField("campaign_manager_name")} AS campaign_manager_name,
        ${profileField("finance_director_name")} AS finance_director_name,
        ${profileField("political_director_name")} AS political_director_name,
        ${profileField("press_contact_name")} AS press_contact_name,
        ${profileField("press_contact_email")} AS press_contact_email,
        ${profileField("source_label")} AS source_label,
        ${profileField("updated_at")} AS updated_at
      FROM candidate_profiles cp
      WHERE cp."candidate_id" = $1
      LIMIT 1
    `;

    try {
      const profileResult = await pool.query(profileSql, [id]);
      profile = profileResult.rows[0] || null;
    } catch (error) {
      console.warn("candidate_profiles read skipped:", error.message);
      profile = null;
    }
  }

  return {
    candidate,
    profile
  };
}

export async function fetchCandidateStates() {
  const columns = await getTableColumns("candidates");
  const stateCol = pickFirstExisting(columns, ["state", "state_code"]);

  if (!stateCol) return [];

  const sql = `
    SELECT DISTINCT c.${qcol(stateCol)}::text AS value
    FROM candidates c
    WHERE c.${qcol(stateCol)} IS NOT NULL
      AND c.${qcol(stateCol)}::text <> ''
    ORDER BY value ASC
  `;

  const result = await pool.query(sql);
  return result.rows.map((row) => row.value);
}

export async function fetchCandidateOffices() {
  const columns = await getTableColumns("candidates");
  const officeCol = pickFirstExisting(columns, ["office", "office_name"]);

  if (!officeCol) return [];

  const sql = `
    SELECT DISTINCT c.${qcol(officeCol)}::text AS value
    FROM candidates c
    WHERE c.${qcol(officeCol)} IS NOT NULL
      AND c.${qcol(officeCol)}::text <> ''
    ORDER BY value ASC
  `;

  const result = await pool.query(sql);
  return result.rows.map((row) => row.value);
}

export async function fetchCandidateParties() {
  const columns = await getTableColumns("candidates");
  const partyCol = pickFirstExisting(columns, ["party", "party_name"]);

  if (!partyCol) return [];

  const sql = `
    SELECT DISTINCT c.${qcol(partyCol)}::text AS value
    FROM candidates c
    WHERE c.${qcol(partyCol)} IS NOT NULL
      AND c.${qcol(partyCol)}::text <> ''
    ORDER BY value ASC
  `;

  const result = await pool.query(sql);
  return result.rows.map((row) => row.value);
}
