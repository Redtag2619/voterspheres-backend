import { pool } from "../db/pool.js";
import { ensureCrmTables } from "./crm.repository.js";

function buildVendorWhereClause(filters = {}) {
  const conditions = [];
  const values = [];
  let index = 1;

  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`
      (
        v.vendor_name ILIKE $${index}
        OR v.category ILIKE $${index}
        OR COALESCE(v.notes, '') ILIKE $${index}
        OR COALESCE(c.campaign_name, '') ILIKE $${index}
        OR COALESCE(c.candidate_name, '') ILIKE $${index}
        OR COALESCE(f.name, '') ILIKE $${index}
      )
    `);
    index += 1;
  }

  if (filters.category) {
    values.push(filters.category);
    conditions.push(`LOWER(COALESCE(v.category, '')) = LOWER($${index})`);
    index += 1;
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`LOWER(COALESCE(v.status, '')) = LOWER($${index})`);
    index += 1;
  }

  if (filters.state) {
    values.push(filters.state);
    conditions.push(`LOWER(COALESCE(c.state, '')) = LOWER($${index})`);
    index += 1;
  }

  if (filters.campaign_id) {
    values.push(Number(filters.campaign_id));
    conditions.push(`v.campaign_id = $${index}`);
    index += 1;
  }

  if (filters.firm_id) {
    values.push(Number(filters.firm_id));
    conditions.push(`c.firm_id = $${index}`);
    index += 1;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return { whereClause, values };
}

export async function getVendorDirectory(filters = {}) {
  await ensureCrmTables();

  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.min(100, Math.max(1, Number(filters.limit || 25)));
  const offset = (page - 1) * limit;

  const { whereClause, values } = buildVendorWhereClause(filters);

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM campaign_vendors v
    INNER JOIN campaigns c ON c.id = v.campaign_id
    LEFT JOIN firms f ON f.id = c.firm_id
    ${whereClause}
  `;

  const dataQuery = `
    SELECT
      v.id,
      v.campaign_id,
      v.vendor_name,
      v.category,
      v.status,
      v.contract_value,
      v.notes,
      v.created_at,
      v.updated_at,
      c.id AS campaign_id,
      c.campaign_name,
      c.candidate_name,
      c.state,
      c.office,
      c.party,
      c.firm_id,
      f.name AS firm_name
    FROM campaign_vendors v
    INNER JOIN campaigns c ON c.id = v.campaign_id
    LEFT JOIN firms f ON f.id = c.firm_id
    ${whereClause}
    ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const [countResult, rowsResult] = await Promise.all([
    pool.query(countQuery, values),
    pool.query(dataQuery, [...values, limit, offset])
  ]);

  return {
    page,
    limit,
    total: countResult.rows[0]?.total || 0,
    results: rowsResult.rows.map((row) => ({
      ...row,
      contract_value: Number(row.contract_value || 0)
    }))
  };
}

export async function getVendorCategoryOptions() {
  await ensureCrmTables();

  const result = await pool.query(`
    SELECT DISTINCT category
    FROM campaign_vendors
    WHERE category IS NOT NULL
      AND TRIM(category) <> ''
    ORDER BY category ASC
  `);

  return result.rows.map((row) => row.category);
}

export async function getVendorStatusOptions() {
  await ensureCrmTables();

  const result = await pool.query(`
    SELECT DISTINCT status
    FROM campaign_vendors
    WHERE status IS NOT NULL
      AND TRIM(status) <> ''
    ORDER BY status ASC
  `);

  return result.rows.map((row) => row.status);
}

export async function getVendorDirectorySummary(filters = {}) {
  await ensureCrmTables();

  const { whereClause, values } = buildVendorWhereClause(filters);

  const result = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_vendors,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(v.status, '')) = 'active')::int AS active_vendors,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(v.status, '')) = 'prospect')::int AS prospect_vendors,
      COALESCE(SUM(v.contract_value), 0)::numeric AS total_contract_value
    FROM campaign_vendors v
    INNER JOIN campaigns c ON c.id = v.campaign_id
    LEFT JOIN firms f ON f.id = c.firm_id
    ${whereClause}
    `,
    values
  );

  const row = result.rows[0] || {};

  return {
    total_vendors: Number(row.total_vendors || 0),
    active_vendors: Number(row.active_vendors || 0),
    prospect_vendors: Number(row.prospect_vendors || 0),
    total_contract_value: Number(row.total_contract_value || 0)
  };
}
