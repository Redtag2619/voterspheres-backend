import express from "express";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

const router = express.Router();

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  return String(value || "").trim().toUpperCase();
}

async function ensureVendorTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      external_id TEXT,
      source TEXT,
      vendor_name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'active',
      state TEXT,
      city TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      services TEXT,
      notes TEXT,
      source_updated_at TIMESTAMP,
      last_imported_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_vendors_source_external
    ON vendors (COALESCE(source, ''), COALESCE(external_id, ''))
    WHERE external_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vendors_state
    ON vendors (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vendors_category
    ON vendors (category)
  `);
}

async function importLiveVendors() {
  await ensureVendorTable();

  // Replace this array later with real source fetch results.
  // For now it gives you a stable live-import structure.
  const liveSourceRows = [
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
      notes: "Imported by live vendor pipeline",
      source_updated_at: new Date().toISOString()
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
      notes: "Imported by live vendor pipeline",
      source_updated_at: new Date().toISOString()
    }
  ];

  let inserted = 0;
  let updated = 0;

  for (const row of liveSourceRows) {
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

    const payload = [
      row.external_id,
      row.source,
      normalizeText(row.vendor_name),
      normalizeText(row.category),
      normalizeText(row.status || "active"),
      normalizeState(row.state),
      normalizeText(row.city),
      normalizeText(row.website),
      normalizeText(row.email),
      normalizeText(row.phone),
      normalizeText(row.services),
      normalizeText(row.notes),
      row.source_updated_at ? new Date(row.source_updated_at) : null
    ];

    if (existing.rows.length) {
      await pool.query(
        `
          UPDATE vendors
          SET
            vendor_name = $3,
            category = $4,
            status = $5,
            state = $6,
            city = $7,
            website = $8,
            email = $9,
            phone = $10,
            services = $11,
            notes = $12,
            source_updated_at = $13,
            last_imported_at = NOW(),
            updated_at = NOW()
          WHERE COALESCE(source, '') = COALESCE($1, '')
            AND COALESCE(external_id, '') = COALESCE($2, '')
        `,
        payload
      );
      updated += 1;
    } else {
      await pool.query(
        `
          INSERT INTO vendors (
            external_id,
            source,
            vendor_name,
            category,
            status,
            state,
            city,
            website,
            email,
            phone,
            services,
            notes,
            source_updated_at,
            last_imported_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW(),NOW()
          )
        `,
        payload
      );
      inserted += 1;
    }
  }

  return {
    source: "manual_live_seed",
    seen: liveSourceRows.length,
    inserted,
    updated
  };
}

router.get("/states", async (_req, res) => {
  try {
    await ensureVendorTable();

    const result = await pool.query(`
      SELECT DISTINCT state
      FROM vendors
      WHERE state IS NOT NULL
        AND state <> ''
      ORDER BY state ASC
    `);

    res.status(200).json({
      states: result.rows.map((row) => row.state).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load vendor states"
    });
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureVendorTable();

    const {
      q = "",
      state = "",
      category = "",
      page = 1,
      limit = 12
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
    const offset = (safePage - 1) * safeLimit;

    const result = await pool.query(
      `
        SELECT
          id,
          external_id,
          source,
          vendor_name,
          category,
          status,
          state,
          city,
          website,
          email,
          phone,
          services,
          notes,
          source_updated_at,
          last_imported_at,
          created_at,
          updated_at
        FROM vendors
        WHERE
          ($1 = '' OR (
            COALESCE(vendor_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(category, '') ILIKE '%' || $1 || '%'
            OR COALESCE(state, '') ILIKE '%' || $1 || '%'
            OR COALESCE(city, '') ILIKE '%' || $1 || '%'
            OR COALESCE(services, '') ILIKE '%' || $1 || '%'
          ))
          AND ($2 = '' OR COALESCE(state, '') = $2)
          AND ($3 = '' OR COALESCE(category, '') = $3)
        ORDER BY COALESCE(vendor_name, 'zzz') ASC
        LIMIT $4 OFFSET $5
      `,
      [
        normalizeText(q),
        normalizeState(state),
        normalizeText(category),
        safeLimit,
        offset
      ]
    );

    const totalResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM vendors
        WHERE
          ($1 = '' OR (
            COALESCE(vendor_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(category, '') ILIKE '%' || $1 || '%'
            OR COALESCE(state, '') ILIKE '%' || $1 || '%'
            OR COALESCE(city, '') ILIKE '%' || $1 || '%'
            OR COALESCE(services, '') ILIKE '%' || $1 || '%'
          ))
          AND ($2 = '' OR COALESCE(state, '') = $2)
          AND ($3 = '' OR COALESCE(category, '') = $3)
      `,
      [
        normalizeText(q),
        normalizeState(state),
        normalizeText(category)
      ]
    );

    res.status(200).json({
      total: totalResult.rows[0]?.total || 0,
      page: safePage,
      limit: safeLimit,
      results: result.rows
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load vendors"
    });
  }
});

router.post("/import", requireRoles("admin"), async (_req, res) => {
  try {
    const summary = await importLiveVendors();

    res.status(200).json({
      success: true,
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to import live vendors"
    });
  }
});

export default router;
