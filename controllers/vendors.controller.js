import { pool } from "../db/pool.js";

function text(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  const raw = text(value);
  return raw.length === 2 ? raw.toUpperCase() : raw;
}

function normalizeLimit(value, fallback = 12) {
  return Math.max(1, Math.min(Number(value) || fallback, 250));
}

function normalizePage(value) {
  return Math.max(1, Number(value) || 1);
}

async function ensureVendorColumns() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      external_id TEXT,
      source TEXT,
      vendor_name TEXT,
      name TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      state TEXT,
      city TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      services TEXT,
      notes TEXT,
      campaign_name TEXT,
      candidate_name TEXT,
      firm_name TEXT,
      office TEXT,
      contract_value NUMERIC DEFAULT 0,
      source_updated_at TIMESTAMP,
      last_imported_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS category TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS city TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS website TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS services TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS campaign_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS candidate_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS firm_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS office TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contract_value NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_state ON vendors(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status)`);
}

function buildVendorWhere(query = {}) {
  const values = [];
  const conditions = [];

  const search = text(query.search || query.q);
  const state = normalizeState(query.state);
  const category = text(query.category);
  const status = text(query.status);

  if (search) {
    values.push(search);
    conditions.push(`
      (
        COALESCE(vendor_name, name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(category, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(state, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(city, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(services, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(campaign_name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(candidate_name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(firm_name, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  if (state) {
    values.push(state);
    conditions.push(`UPPER(COALESCE(state, '')) = UPPER($${values.length})`);
  }

  if (category) {
    values.push(category);
    conditions.push(`COALESCE(category, '') = $${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`COALESCE(status, '') = $${values.length}`);
  }

  return {
    values,
    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  };
}

function mapVendor(row) {
  const contractValue = Number(row.contract_value || 0);
  const status = row.status || "active";

  let risk = "Monitor";
  if (String(status).toLowerCase().includes("risk")) risk = "Elevated";
  else if (String(status).toLowerCase() !== "active") risk = "Watch";

  return {
    id: row.id,
    external_id: row.external_id,
    source: row.source,
    vendor_name: row.vendor_name || row.name || "Unnamed Vendor",
    name: row.name || row.vendor_name || "Unnamed Vendor",
    category: row.category || "General",
    status,
    state: row.state,
    city: row.city,
    website: row.website,
    email: row.email,
    phone: row.phone,
    services: row.services,
    notes: row.notes,
    campaign_name: row.campaign_name,
    candidate_name: row.candidate_name,
    firm_name: row.firm_name,
    office: row.office,
    contract_value: contractValue,
    risk,
    source_updated_at: row.source_updated_at,
    last_imported_at: row.last_imported_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function getVendors(req, res, next) {
  try {
    await ensureVendorColumns();

    const page = normalizePage(req.query.page);
    const limit = normalizeLimit(req.query.limit, 12);
    const offset = (page - 1) * limit;

    const { values, whereSql } = buildVendorWhere(req.query);

    const totalResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM vendors
        ${whereSql}
      `,
      values
    );

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_vendors,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_vendors,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) <> 'active')::int AS watch_vendors,
          COUNT(DISTINCT NULLIF(state, ''))::int AS states_covered,
          COUNT(DISTINCT NULLIF(category, ''))::int AS categories_covered,
          COALESCE(SUM(COALESCE(contract_value, 0)), 0)::numeric AS total_contract_value
        FROM vendors
        ${whereSql}
      `,
      values
    );

    const pageValues = [...values, limit, offset];

    const result = await pool.query(
      `
        SELECT
          id,
          external_id,
          source,
          vendor_name,
          name,
          category,
          status,
          state,
          city,
          website,
          email,
          phone,
          services,
          notes,
          campaign_name,
          candidate_name,
          firm_name,
          office,
          COALESCE(contract_value, 0)::numeric AS contract_value,
          source_updated_at,
          last_imported_at,
          created_at,
          updated_at
        FROM vendors
        ${whereSql}
        ORDER BY
          CASE WHEN LOWER(COALESCE(status, '')) = 'active' THEN 0 ELSE 1 END,
          COALESCE(vendor_name, name, 'zzz') ASC
        LIMIT $${pageValues.length - 1}
        OFFSET $${pageValues.length}
      `,
      pageValues
    );

    res.json({
      total: totalResult.rows[0]?.total || 0,
      page,
      limit,
      summary: summaryResult.rows[0] || {
        total_vendors: 0,
        active_vendors: 0,
        watch_vendors: 0,
        states_covered: 0,
        categories_covered: 0,
        total_contract_value: 0
      },
      results: (result.rows || []).map(mapVendor),
      _live: true
    });
  } catch (err) {
    next(err);
  }
}

export async function getVendorStates(_req, res, next) {
  try {
    await ensureVendorColumns();

    const result = await pool.query(`
      SELECT DISTINCT state
      FROM vendors
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    const states = result.rows.map((row, index) => ({
      id: index + 1,
      name: row.state,
      value: row.state
    }));

    res.json({
      states: states.map((row) => row.value),
      results: states
    });
  } catch (err) {
    next(err);
  }
}

export async function getVendorCategories(_req, res, next) {
  try {
    await ensureVendorColumns();

    const result = await pool.query(`
      SELECT DISTINCT category
      FROM vendors
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category ASC
    `);

    res.json({
      results: result.rows.map((row) => row.category).filter(Boolean)
    });
  } catch (err) {
    next(err);
  }
}

export async function getVendorStatuses(_req, res, next) {
  try {
    await ensureVendorColumns();

    const result = await pool.query(`
      SELECT DISTINCT status
      FROM vendors
      WHERE status IS NOT NULL AND status <> ''
      ORDER BY status ASC
    `);

    res.json({
      results: result.rows.map((row) => row.status).filter(Boolean)
    });
  } catch (err) {
    next(err);
  }
}
