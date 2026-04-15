import { pool } from "../db/pool.js";

function fallbackCandidates() {
  return [
    {
      id: 1,
      full_name: "Jane Thompson",
      first_name: "Jane",
      last_name: "Thompson",
      state: "Georgia",
      office: "Senate",
      party: "Democratic",
      website: "https://example.com",
      election_name: "2026 Georgia Senate",
      status: "active",
      incumbent: false
    },
    {
      id: 2,
      full_name: "Robert Gaines",
      first_name: "Robert",
      last_name: "Gaines",
      state: "Pennsylvania",
      office: "Governor",
      party: "Republican",
      website: "https://example.com",
      election_name: "2026 Pennsylvania Governor",
      status: "active",
      incumbent: true
    },
    {
      id: 3,
      full_name: "Alicia Brooks",
      first_name: "Alicia",
      last_name: "Brooks",
      state: "Arizona",
      office: "Senate",
      party: "Independent",
      website: "https://example.com",
      election_name: "2026 Arizona Senate",
      status: "watch",
      incumbent: false
    }
  ];
}

function fallbackProfile(candidateId) {
  return {
    candidate_id: Number(candidateId) || 1,
    campaign_website: "https://example.com",
    official_website: "",
    office_address: "101 Capitol Ave",
    campaign_address: "450 Campaign Blvd",
    phone: "(555) 555-0100",
    email: "info@example.com",
    chief_of_staff_name: "Marcus Hill",
    campaign_manager_name: "Ava Reynolds",
    finance_director_name: "Daniel Price",
    political_director_name: "Sonia Ellis",
    press_contact_name: "Taylor Brooks",
    press_contact_email: "press@example.com",
    source_label: "manual_enrichment",
    updated_at: null
  };
}

async function tableExists(tableName) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.exists);
}

async function getTableColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position ASC
    `,
    [tableName]
  );

  return new Set((result.rows || []).map((row) => row.column_name));
}

function candidateMatchesFilters(candidate, filters) {
  const q = String(filters.q || "").toLowerCase();
  const state = String(filters.state || "");
  const office = String(filters.office || "");
  const party = String(filters.party || "");

  const nameBlob = [
    candidate.full_name,
    candidate.first_name,
    candidate.last_name,
    candidate.election_name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (q && !nameBlob.includes(q)) return false;
  if (state && candidate.state !== state) return false;
  if (office && candidate.office !== office) return false;
  if (party && candidate.party !== party) return false;

  return true;
}

function paginate(items, page, limit) {
  const offset = (page - 1) * limit;
  return items.slice(offset, offset + limit);
}

export async function findCandidates(filters) {
  try {
    const exists = await tableExists("candidates");

    if (!exists) {
      return paginate(
        fallbackCandidates().filter((item) => candidateMatchesFilters(item, filters)),
        filters.page,
        filters.limit
      );
    }

    const result = await pool.query(
      `
        SELECT
          id,
          full_name,
          first_name,
          last_name,
          state,
          office,
          party,
          website,
          election_name,
          status,
          COALESCE(incumbent, false) AS incumbent
        FROM candidates
        WHERE ($1 = '' OR (
          COALESCE(full_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(first_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(last_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(election_name, '') ILIKE '%' || $1 || '%'
        ))
          AND ($2 = '' OR COALESCE(state, '') = $2)
          AND ($3 = '' OR COALESCE(office, '') = $3)
          AND ($4 = '' OR COALESCE(party, '') = $4)
        ORDER BY COALESCE(last_name, full_name, 'zzz') ASC
        LIMIT $5 OFFSET $6
      `,
      [
        filters.q,
        filters.state,
        filters.office,
        filters.party,
        filters.limit,
        (filters.page - 1) * filters.limit
      ]
    );

    return result.rows || [];
  } catch (error) {
    console.error("findCandidates fallback:", error.message);

    return paginate(
      fallbackCandidates().filter((item) => candidateMatchesFilters(item, filters)),
      filters.page,
      filters.limit
    );
  }
}

export async function countCandidates(filters) {
  try {
    const exists = await tableExists("candidates");

    if (!exists) {
      return fallbackCandidates().filter((item) => candidateMatchesFilters(item, filters)).length;
    }

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM candidates
        WHERE ($1 = '' OR (
          COALESCE(full_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(first_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(last_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(election_name, '') ILIKE '%' || $1 || '%'
        ))
          AND ($2 = '' OR COALESCE(state, '') = $2)
          AND ($3 = '' OR COALESCE(office, '') = $3)
          AND ($4 = '' OR COALESCE(party, '') = $4)
      `,
      [filters.q, filters.state, filters.office, filters.party]
    );

    return Number(result.rows?.[0]?.total || 0);
  } catch (error) {
    console.error("countCandidates fallback:", error.message);

    return fallbackCandidates().filter((item) => candidateMatchesFilters(item, filters)).length;
  }
}

export async function findCandidateById(id) {
  try {
    const exists = await tableExists("candidates");

    if (!exists) {
      return fallbackCandidates().find((item) => String(item.id) === String(id)) || null;
    }

    const result = await pool.query(
      `
        SELECT
          id,
          full_name,
          first_name,
          last_name,
          state,
          office,
          party,
          website,
          election_name,
          status,
          COALESCE(incumbent, false) AS incumbent
        FROM candidates
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows?.[0] || null;
  } catch (error) {
    console.error("findCandidateById fallback:", error.message);

    return fallbackCandidates().find((item) => String(item.id) === String(id)) || null;
  }
}

export async function findCandidateProfileById(candidateId) {
  try {
    const exists = await tableExists("candidate_profiles");

    if (!exists) {
      return fallbackProfile(candidateId);
    }

    const columns = await getTableColumns("candidate_profiles");

    const desiredColumns = [
      "candidate_id",
      "campaign_website",
      "official_website",
      "office_address",
      "campaign_address",
      "phone",
      "email",
      "chief_of_staff_name",
      "campaign_manager_name",
      "finance_director_name",
      "political_director_name",
      "press_contact_name",
      "press_contact_email",
      "source_label",
      "notes",
      "updated_at"
    ].filter((column) => columns.has(column));

    if (!desiredColumns.length) {
      return fallbackProfile(candidateId);
    }

    const result = await pool.query(
      `
        SELECT ${desiredColumns.join(", ")}
        FROM candidate_profiles
        WHERE candidate_id = $1
        LIMIT 1
      `,
      [candidateId]
    );

    return result.rows?.[0] || fallbackProfile(candidateId);
  } catch (error) {
    console.error("findCandidateProfileById fallback:", error.message);
    return fallbackProfile(candidateId);
  }
}

export async function findDistinctCandidateStates() {
  try {
    const exists = await tableExists("candidates");

    if (!exists) {
      return [...new Set(fallbackCandidates().map((item) => item.state))].sort();
    }

    const result = await pool.query(
      `
        SELECT DISTINCT state
        FROM candidates
        WHERE state IS NOT NULL
          AND state <> ''
        ORDER BY state ASC
      `
    );

    return (result.rows || []).map((row) => row.state);
  } catch (error) {
    console.error("findDistinctCandidateStates fallback:", error.message);
    return [...new Set(fallbackCandidates().map((item) => item.state))].sort();
  }
}

export async function findDistinctCandidateOffices() {
  try {
    const exists = await tableExists("candidates");

    if (!exists) {
      return [...new Set(fallbackCandidates().map((item) => item.office))].sort();
    }

    const result = await pool.query(
      `
        SELECT DISTINCT office
        FROM candidates
        WHERE office IS NOT NULL
          AND office <> ''
        ORDER BY office ASC
      `
    );

    return (result.rows || []).map((row) => row.office);
  } catch (error) {
    console.error("findDistinctCandidateOffices fallback:", error.message);
    return [...new Set(fallbackCandidates().map((item) => item.office))].sort();
  }
}

export async function findDistinctCandidateParties() {
  try {
    const exists = await tableExists("candidates");

    if (!exists) {
      return [...new Set(fallbackCandidates().map((item) => item.party))].sort();
    }

    const result = await pool.query(
      `
        SELECT DISTINCT party
        FROM candidates
        WHERE party IS NOT NULL
          AND party <> ''
        ORDER BY party ASC
      `
    );

    return (result.rows || []).map((row) => row.party);
  } catch (error) {
    console.error("findDistinctCandidateParties fallback:", error.message);
    return [...new Set(fallbackCandidates().map((item) => item.party))].sort();
  }
}
