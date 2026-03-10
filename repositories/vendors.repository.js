import { pool } from "../db/pool.js";

function buildVendorWhere(filters) {
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

export async function countVendors(filters) {
  const { whereSQL, values } = buildVendorWhere(filters);

  const result = await pool.query(
    `SELECT COUNT(*) FROM vendors ${whereSQL}`,
    values
  );

  return Number(result.rows[0].count);
}

export async function findVendors(filters) {
  const { whereSQL, values } = buildVendorWhere(filters);

  const offset = (filters.page - 1) * filters.limit;
  values.push(filters.limit, offset);

  const result = await pool.query(
    `
    SELECT *
    FROM vendors
    ${whereSQL}
    ORDER BY name
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function findDistinctVendorStates() {
  const result = await pool.query(`
    SELECT DISTINCT state AS name
    FROM vendors
    WHERE state IS NOT NULL AND state <> ''
    ORDER BY state
  `);

  return result.rows.map((row, index) => ({
    id: index + 1,
    name: row.name
  }));
}
