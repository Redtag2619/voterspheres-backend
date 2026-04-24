import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

function text(value = "") {
  return String(value || "").trim();
}

async function ensureConsultantsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultants (
      id SERIAL PRIMARY KEY,
      name TEXT,
      firm_name TEXT,
      category TEXT,
      state TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'active',
      services TEXT,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS firm_name TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS category TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS website TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS services TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE consultants ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_state ON consultants(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_category ON consultants(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_status ON consultants(status)`);
}

async function seedConsultantsIfEmpty() {
  await ensureConsultantsTable();

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM consultants`);
  if (Number(countResult.rows[0]?.total || 0) > 0) return;

  await pool.query(`
    INSERT INTO consultants (
      name, firm_name, category, state, website, email, phone, status, services, source, source_updated_at
    )
    VALUES
      ('Red Tag Strategies', 'Red Tag Strategies', 'General Consulting', 'Louisiana', 'https://redtagstrategies.com', 'info@redtagstrategies.com', '', 'active', 'Political mail, campaign operations, USPS escalation', 'manual_live_seed', NOW()),
      ('Capitol Campaign Group', 'Capitol Campaign Group', 'Media + Strategy', 'Georgia', 'https://example.com', 'hello@example.com', '', 'active', 'Strategy, media, message development', 'manual_live_seed', NOW()),
      ('Keystone Field Partners', 'Keystone Field Partners', 'Field Operations', 'Pennsylvania', 'https://example.com', 'hello@example.com', '', 'active', 'Field operations and voter contact', 'manual_live_seed', NOW())
  `);
}

router.get("/states", async (_req, res) => {
  try {
    await seedConsultantsIfEmpty();

    const { rows } = await pool.query(`
      SELECT DISTINCT state
      FROM consultants
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    res.json({
      states: rows.map((row) => row.state).filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load consultant states" });
  }
});

router.get("/", async (req, res) => {
  try {
    await seedConsultantsIfEmpty();

    const {
      state = "",
      search = "",
      category = "",
      status = "",
      limit = 100
    } = req.query;

    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 250));

    const values = [
      text(state),
      text(search),
      text(category),
      text(status),
      safeLimit
    ];

    const whereSql = `
      WHERE
        ($1 = '' OR COALESCE(state, '') = $1)
        AND ($2 = '' OR (
          COALESCE(name, '') ILIKE '%' || $2 || '%'
          OR COALESCE(firm_name, '') ILIKE '%' || $2 || '%'
          OR COALESCE(category, '') ILIKE '%' || $2 || '%'
          OR COALESCE(state, '') ILIKE '%' || $2 || '%'
          OR COALESCE(services, '') ILIKE '%' || $2 || '%'
        ))
        AND ($3 = '' OR COALESCE(category, '') = $3)
        AND ($4 = '' OR COALESCE(status, '') = $4)
    `;

    const { rows } = await pool.query(
      `
        SELECT
          id,
          COALESCE(name, firm_name, 'Unnamed Consultant') AS name,
          firm_name,
          COALESCE(category, 'General Consulting') AS category,
          state,
          website,
          email,
          phone,
          COALESCE(status, 'active') AS status,
          services,
          notes,
          source,
          source_updated_at,
          created_at,
          updated_at
        FROM consultants
        ${whereSql}
        ORDER BY COALESCE(name, firm_name, 'zzz') ASC
        LIMIT $5
      `,
      values
    );

    res.json({
      results: rows,
      summary: {
        total_consultants: rows.length,
        active_consultants: rows.filter((row) => String(row.status || "").toLowerCase() === "active").length,
        states: new Set(rows.map((row) => row.state).filter(Boolean)).size,
        categories: new Set(rows.map((row) => row.category).filter(Boolean)).size
      },
      _demo: false
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load consultants" });
  }
});

export default router;
