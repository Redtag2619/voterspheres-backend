import express from "express";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

const router = express.Router();

function text(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  return text(value).toUpperCase();
}

async function ensureVendorTable() {
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
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS campaign_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS candidate_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS firm_name TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS office TEXT`);
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contract_value NUMERIC DEFAULT 0`);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_vendors_source_external
    ON vendors (COALESCE(source, ''), COALESCE(external_id, ''))
    WHERE external_id IS NOT NULL
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_state ON vendors (state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors (category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors (status)`);
}

async function importLiveVendors() {
  await ensureVendorTable();

  const now = new Date();

  const liveRows = [
    {
      external_id: "vendor-precision-mail-group",
      source: "manual_live_seed",
      vendor_name: "Precision Mail Group",
      category: "Direct Mail",
      status: "active",
      state: "GA",
      city: "Atlanta",
      website: "https://precisionmailgroup.example",
      email: "ops@precisionmailgroup.example",
      phone: "404-555-0101",
      services: "Printing, Direct Mail, Postal Logistics",
      campaign_name: "Georgia Senate Victory",
      candidate_name: "Live Candidate",
      firm_name: "Red Tag Strategies",
      office: "Senate",
      contract_value: 185000,
      notes: "Imported by live vendor pipeline",
      source_updated_at: now
    },
    {
      external_id: "vendor-capitol-digital-media",
      source: "manual_live_seed",
      vendor_name: "Capitol Digital Media",
      category: "Digital",
      status: "active",
      state: "PA",
      city: "Philadelphia",
      website: "https://capitoldigitalmedia.example",
      email: "hello@capitoldigitalmedia.example",
      phone: "215-555-0102",
      services: "Digital Ads, Creative, Analytics",
      campaign_name: "Pennsylvania Senate Program",
      candidate_name: "Live Candidate",
      firm_name: "VoterSpheres Network",
      office: "Senate",
      contract_value: 220000,
      notes: "Imported by live vendor pipeline",
      source_updated_at: now
    }
  ];

  let inserted = 0;
  let updated = 0;

  for (const row of liveRows) {
    const existing = await pool.query(
      `
        SELECT id
        FROM vendors
        WHERE COALESCE(source, '') = COALESCE($1, '')
          AND COALESCE(external_id, '') = COALESCE($2, '')
        LIMIT 1
      `,
      [row.source, row.external_id]
    );

    const values = [
      row.external_id,
      row.source,
      row.vendor_name,
      row.vendor_name,
      row.category,
      row.status,
      normalizeState(row.state),
      row.city,
      row.website,
      row.email,
      row.phone,
      row.services,
      row.notes,
      row.campaign_name,
      row.candidate_name,
      row.firm_name,
      row.office,
      Number(row.contract_value || 0),
      row.source_updated_at
    ];

    if (existing.rows.length) {
      await pool.query(
        `
          UPDATE vendors
          SET
            vendor_name = $3,
            name = $4,
            category = $5,
            status = $6,
            state = $7,
            city = $8,
            website = $9,
            email = $10,
            phone = $11,
            services = $12,
            notes = $13,
            campaign_name = $14,
            candidate_name = $15,
            firm_name = $16,
            office = $17,
            contract_value = $18,
            source_updated_at = $19,
            last_imported_at = NOW(),
            updated_at = NOW()
          WHERE COALESCE(source, '') = COALESCE($1, '')
            AND COALESCE(external_id, '') = COALESCE($2, '')
        `,
        values
      );
      updated += 1;
    } else {
      await pool.query(
        `
          INSERT INTO vendors (
            external_id, source, vendor_name, name, category, status, state, city,
            website, email, phone, services, notes, campaign_name, candidate_name,
            firm_name, office, contract_value, source_updated_at,
            last_imported_at, created_at, updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
            NOW(),NOW(),NOW()
          )
        `,
        values
      );
      inserted += 1;
    }
  }

  return { source: "manual_live_seed", seen: liveRows.length, inserted, updated };
}

router.get("/states", async (_req, res) => {
  try {
    await ensureVendorTable();

    const { rows } = await pool.query(`
      SELECT DISTINCT state
      FROM vendors
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    res.json({
      states: rows.map((row) => row.state).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendor states" });
  }
});

router.get("/dropdowns/categories", async (_req, res) => {
  try {
    await ensureVendorTable();

    const { rows } = await pool.query(`
      SELECT DISTINCT category
      FROM vendors
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category ASC
    `);

    res.json({
      results: rows.map((row) => row.category).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendor categories" });
  }
});

router.get("/dropdowns/statuses", async (_req, res) => {
  try {
    await ensureVendorTable();

    const { rows } = await pool.query(`
      SELECT DISTINCT status
      FROM vendors
      WHERE status IS NOT NULL AND status <> ''
      ORDER BY status ASC
    `);

    res.json({
      results: rows.map((row) => row.status).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendor statuses" });
  }
});


router.get("/dropdowns/categories", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT category
      FROM vendors
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category ASC
    `);

    res.status(200).json({
      results: result.rows.map((row) => row.category).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load vendor categories"
    });
  }
});

router.get("/dropdowns/statuses", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT status
      FROM vendors
      WHERE status IS NOT NULL AND status <> ''
      ORDER BY status ASC
    `);

    res.status(200).json({
      results: result.rows.map((row) => row.status).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load vendor statuses"
    });
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureVendorTable();

    const {
      q = "",
      search = "",
      state = "",
      category = "",
      status = "",
      page = 1,
      limit = 100
    } = req.query;

    const term = text(search || q);
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
    const offset = (safePage - 1) * safeLimit;

    const values = [
      term,
      normalizeState(state),
      text(category),
      text(status),
      safeLimit,
      offset
    ];

    const whereSql = `
      WHERE
        ($1 = '' OR (
          COALESCE(vendor_name, name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(category, '') ILIKE '%' || $1 || '%'
          OR COALESCE(state, '') ILIKE '%' || $1 || '%'
          OR COALESCE(city, '') ILIKE '%' || $1 || '%'
          OR COALESCE(services, '') ILIKE '%' || $1 || '%'
          OR COALESCE(campaign_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(candidate_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(firm_name, '') ILIKE '%' || $1 || '%'
        ))
        AND ($2 = '' OR UPPER(COALESCE(state, '')) = $2)
        AND ($3 = '' OR COALESCE(category, '') = $3)
        AND ($4 = '' OR COALESCE(status, '') = $4)
    `;

    const { rows } = await pool.query(
      `
        SELECT
          id,
          external_id,
          source,
          COALESCE(vendor_name, name, 'Unnamed Vendor') AS vendor_name,
          COALESCE(name, vendor_name, 'Unnamed Vendor') AS name,
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
          updated_at,
          CASE
            WHEN LOWER(COALESCE(status, '')) = 'active' THEN 'Monitor'
            ELSE 'Watch'
          END AS risk
        FROM vendors
        ${whereSql}
        ORDER BY COALESCE(vendor_name, name, 'zzz') ASC
        LIMIT $5 OFFSET $6
      `,
      values
    );

    const totalResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM vendors
        ${whereSql}
      `,
      values.slice(0, 4)
    );

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_vendors,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_vendors,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) <> 'active')::int AS prospect_vendors,
          COALESCE(SUM(COALESCE(contract_value, 0)), 0)::numeric AS total_contract_value
        FROM vendors
        ${whereSql}
      `,
      values.slice(0, 4)
    );

    res.json({
      total: totalResult.rows[0]?.total || 0,
      page: safePage,
      limit: safeLimit,
      summary: summaryResult.rows[0] || {
        total_vendors: 0,
        active_vendors: 0,
        prospect_vendors: 0,
        total_contract_value: 0
      },
      results: rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendors" });
  }
});

router.post("/import", requireRoles("admin"), async (_req, res) => {
  try {
    const summary = await importLiveVendors();
    res.json({ success: true, ...summary });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to import live vendors" });
  }
});

export default router;

