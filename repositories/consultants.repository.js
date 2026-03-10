import { pool } from "../db/pool.js";

function buildConsultantWhere(filters) {
  const where = [];
  const values = [];

  if (filters.q) {
    values.push(`%${filters.q}%`);
    where.push(`name ILIKE $${values.length}`);
  }

  if (filters.state) {
    values.push(filters.state);
    where.push(`state = $${values.length}`);
  }

  return {
    whereSQL: where.length ? `WHERE ${where.join(" AND ")}` : "",
    values
  };
}

export async function countConsultants(filters) {
  const { whereSQL, values } = buildConsultantWhere(filters);

  const result = await pool.query(
    `SELECT COUNT(*) FROM consultants ${whereSQL}`,
    values
  );

  return Number(result.rows[0].count);
}

export async function findConsultants(filters) {
  const { whereSQL, values } = buildConsultantWhere(filters);

  const offset = (filters.page - 1) * filters.limit;
  values.push(filters.limit, offset);

  const result = await pool.query(
    `
    SELECT *
    FROM consultants
    ${whereSQL}
    ORDER BY name
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function findDistinctConsultantStates() {
  const result = await pool.query(`
    SELECT DISTINCT state AS name
    FROM consultants
    WHERE state IS NOT NULL AND state <> ''
    ORDER BY state
  `);

  return result.rows.map((row, index) => ({
    id: index + 1,
    name: row.name
  }));
}
