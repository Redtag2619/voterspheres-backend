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
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = $1
      ) as exists
    `,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.exists);
}

async function getTableColumns(tableName) {
  const result = await pool.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position asc
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
        select
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
          coalesce(incumbent, false) as incumbent
        from candidates
        where ($1 = '' or (
          coalesce(full_name, '') ilike '%' || $1 || '%'
          or coalesce(first_name, '') ilike '%' || $1 || '%'
          or coalesce(last_name, '') ilike '%' || $1 || '%'
          or coalesce(election_name, '') ilike '%' || $1 || '%'
        ))
          and ($2 = '' or coalesce(state, '') = $2)
          and ($3 = '' or coalesce(office, '') = $3)
          and ($4 = '' or coalesce(party, '') = $4)
        order by coalesce(last_name, full_name, 'zzz') asc
        limit $5 offset $6
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
  } catch {
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
        select count(*)::int as total
        from candidates
        where ($1 = '' or (
          coalesce(full_name, '') ilike '%' || $1 || '%'
          or coalesce(first_name, '') ilike '%' || $1 || '%'
          or coalesce(last_name, '') ilike '%' || $1 || '%'
          or coalesce(election_name, '') ilike '%' || $1 || '%'
        ))
          and ($2 = '' or coalesce(state, '') = $2)
          and ($3 = '' or coalesce(office, '') = $3)
          and ($4 = '' or coalesce(party, '') = $4)
      `,
      [filters.q, filters.state, filters.office, filters.party]
    );

    return Number(result.rows?.[0]?.total || 0);
  } catch {
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
        select
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
          coalesce(incumbent, false) as incumbent
        from candidates
        where id = $1
        limit 1
      `,
      [id]
    );

    return result.rows?.[0] || null;
  } catch {
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
      "updated_at"
    ].filter((column) => columns.has(column));

    if (!desiredColumns.length) {
      return fallbackProfile(candidateId);
    }

    const result = await pool.query(
      `
        select ${desiredColumns.join(", ")}
        from candidate_profiles
        where candidate_id = $1
        limit 1
      `,
      [candidateId]
    );

    return result.rows?.[0] || fallbackProfile(candidateId);
  } catch {
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
        select distinct state
        from candidates
        where state is not null and state <> ''
        order by state asc
      `
    );

    return (result.rows || []).map((row) => row.state);
  } catch {
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
        select distinct office
        from candidates
        where office is not null and office <> ''
        order by office asc
      `
    );

    return (result.rows || []).map((row) => row.office);
  } catch {
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
        select distinct party
        from candidates
        where party is not null and party <> ''
        order by party asc
      `
    );

    return (result.rows || []).map((row) => row.party);
  } catch {
    return [...new Set(fallbackCandidates().map((item) => item.party))].sort();
  }
}
