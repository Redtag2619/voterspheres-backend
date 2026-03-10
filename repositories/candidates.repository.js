import { pool } from "../db/pool.js";

function buildCandidateWhere(filters) {
  const where = [];
  const values = [];

  if (filters.q) {
    values.push(`%${filters.q}%`);
    where.push(`c.name ILIKE $${values.length}`);
  }

  if (filters.state) {
    values.push(filters.state);
    where.push(`c.state = $${values.length}`);
  }

  if (filters.office) {
    values.push(filters.office);
    where.push(`c.election = $${values.length}`);
  }

  if (filters.party) {
    values.push(filters.party);
    where.push(`c.party = $${values.length}`);
  }

  return {
    whereSQL: where.length ? `WHERE ${where.join(" AND ")}` : "",
    values
  };
}

export async function countCandidates(filters) {
  const { whereSQL, values } = buildCandidateWhere(filters);

  const result = await pool.query(
    `SELECT COUNT(*) FROM candidates c ${whereSQL}`,
    values
  );

  return Number(result.rows[0].count);
}

export async function findCandidates(filters) {
  const { whereSQL, values } = buildCandidateWhere(filters);

  const offset = (filters.page - 1) * filters.limit;
  values.push(filters.limit, offset);

  const result = await pool.query(
    `
    SELECT
      c.id,
      c.name,
      c.slug,
      c.party,
      c.bio,
      c.photo,
      c.election,
      c.election_date,
      c.updated_at,
      c.state
    FROM candidates c
    ${whereSQL}
    ORDER BY c.name
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function findDistinctCandidateStates() {
  const result = await pool.query(`
    SELECT DISTINCT state AS name
    FROM candidates
    WHERE state IS NOT NULL AND state <> ''
    ORDER BY state
  `);

  return result.rows.map((row, index) => ({
    id: index + 1,
    name: row.name
  }));
}

export async function findDistinctCandidateOffices() {
  const result = await pool.query(`
    SELECT DISTINCT election AS name
    FROM candidates
    WHERE election IS NOT NULL AND election <> ''
    ORDER BY election
  `);

  return result.rows.map((row, index) => ({
    id: index + 1,
    name: row.name
  }));
}

export async function findDistinctCandidateParties() {
  const result = await pool.query(`
    SELECT DISTINCT party AS name
    FROM candidates
    WHERE party IS NOT NULL AND party <> ''
    ORDER BY party
  `);

  return result.rows.map((row, index) => ({
    id: index + 1,
    name: row.name
  }));
}
