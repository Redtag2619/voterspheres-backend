import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

function text(value = "") {
  return String(value || "").trim();
}

async function ensureDonorsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donors (
      id SERIAL PRIMARY KEY,
      donor_name TEXT,
      name TEXT,
      donor_type TEXT,
      state TEXT,
      amount NUMERIC DEFAULT 0,
      relationship_strength TEXT DEFAULT 'Growing',
      candidate_id TEXT,
      candidate_name TEXT,
      committee_name TEXT,
      occupation TEXT,
      employer TEXT,
      city TEXT,
      source TEXT DEFAULT 'manual',
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS donor_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS donor_type TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS relationship_strength TEXT DEFAULT 'Growing'`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS candidate_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS candidate_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS committee_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS occupation TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS employer TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS city TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_state ON donors(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_candidate_id ON donors(candidate_id)`);
}

async function seedDonorsIfEmpty() {
  await ensureDonorsTable();

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM donors`);
  if (Number(countResult.rows[0]?.total || 0) > 0) return;

  await pool.query(`
    INSERT INTO donors (
      donor_name, name, donor_type, state, amount, relationship_strength,
      candidate_id, candidate_name, committee_name, city, source, source_updated_at
    )
    VALUES
      ('Atlantic Leadership Fund', 'Atlantic Leadership Fund', 'PAC', 'Georgia', 250000, 'High', 'GA-SEN-1', 'Live Candidate', 'Georgia Senate Victory Committee', 'Atlanta', 'manual_live_seed', NOW()),
      ('Keystone Civic Network', 'Keystone Civic Network', 'Individual Network', 'Pennsylvania', 175000, 'Medium', 'PA-SEN-1', 'Live Candidate', 'Pennsylvania Senate Program', 'Philadelphia', 'manual_live_seed', NOW()),
      ('Great Lakes Action Council', 'Great Lakes Action Council', 'PAC', 'Michigan', 120000, 'Growing', 'MI-HOUSE-1', 'Live Candidate', 'Great Lakes House Committee', 'Detroit', 'manual_live_seed', NOW())
  `);
}

router.get("/network/public", async (req, res) => {
  try {
    await seedDonorsIfEmpty();
    return handleDonorNetwork(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load donor network" });
  }
});

router.get("/network", async (req, res) => {
  try {
    await seedDonorsIfEmpty();
    return handleDonorNetwork(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load donor network" });
  }
});

async function handleDonorNetwork(req, res) {
  const {
    state = "",
    search = "",
    candidate_id = "",
    limit = 100
  } = req.query;

  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 250));
  const term = text(search);

  const values = [
    text(state),
    term,
    text(candidate_id),
    safeLimit
  ];

  const whereSql = `
    WHERE
      ($1 = '' OR COALESCE(state, '') = $1)
      AND ($2 = '' OR (
        COALESCE(donor_name, name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(donor_type, '') ILIKE '%' || $2 || '%'
        OR COALESCE(relationship_strength, '') ILIKE '%' || $2 || '%'
        OR COALESCE(state, '') ILIKE '%' || $2 || '%'
        OR COALESCE(candidate_name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(committee_name, '') ILIKE '%' || $2 || '%'
      ))
      AND ($3 = '' OR COALESCE(candidate_id, '') = $3)
  `;

  const result = await pool.query(
    `
      SELECT
        id,
        COALESCE(donor_name, name, 'Unknown Donor') AS donor_name,
        COALESCE(name, donor_name, 'Unknown Donor') AS name,
        COALESCE(donor_type, 'Donor') AS donor_type,
        state,
        COALESCE(amount, 0)::numeric AS amount,
        COALESCE(relationship_strength, 'Growing') AS relationship_strength,
        candidate_id,
        candidate_name,
        committee_name,
        occupation,
        employer,
        city,
        source,
        source_updated_at,
        created_at,
        updated_at
      FROM donors
      ${whereSql}
      ORDER BY COALESCE(amount, 0) DESC, donor_name ASC
      LIMIT $4
    `,
    values
  );

  const summaryResult = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total_donors,
        COALESCE(SUM(COALESCE(amount, 0)), 0)::numeric AS total_amount
      FROM donors
      ${whereSql}
    `,
    values.slice(0, 3)
  );

  const stateResult = await pool.query(
    `
      SELECT state, COALESCE(SUM(COALESCE(amount, 0)), 0)::numeric AS total
      FROM donors
      ${whereSql}
      GROUP BY state
      ORDER BY total DESC
      LIMIT 1
    `,
    values.slice(0, 3)
  );

  res.json({
    results: result.rows,
    summary: {
      total_donors: summaryResult.rows[0]?.total_donors || 0,
      total_amount: Number(summaryResult.rows[0]?.total_amount || 0),
      top_state: stateResult.rows[0]?.state || "N/A"
    },
    _demo: false
  });
}

export default router;
