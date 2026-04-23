import { pool } from "../db/pool.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  return String(value || "").trim().toUpperCase();
}

function severityFromPriority(priority = "") {
  const value = String(priority || "").toLowerCase();
  if (value === "tier 1") return "High";
  if (value === "tier 2") return "Medium";
  return "Low";
}

function riskFromVendors(vendorCount = 0) {
  if (vendorCount <= 0) return "Elevated";
  if (vendorCount <= 2) return "Watch";
  return "Monitor";
}

async function ensureExecutiveFeedEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS executive_feed_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'Medium',
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      state TEXT,
      office TEXT,
      risk TEXT DEFAULT 'Monitor',
      candidate_name TEXT,
      candidate_id TEXT,
      vendor_id INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_executive_feed_events_created_at
      ON executive_feed_events (created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_executive_feed_events_state
      ON executive_feed_events (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_executive_feed_events_office
      ON executive_feed_events (office)
  `);
}

async function importLiveCandidatesFromOpenFec() {
  const cycle = Number(process.env.FEC_CYCLE || 2026);
  const source = "openfec";

  const result = await pool.query(
    `
      WITH latest_candidates AS (
        SELECT
          external_id,
          full_name,
          state,
          office,
          party,
          last_imported_at,
          row_number() OVER (
            PARTITION BY COALESCE(external_id, '')
            ORDER BY COALESCE(last_imported_at, updated_at, created_at) DESC NULLS LAST
          ) AS rn
        FROM candidates
        WHERE COALESCE(source, '') = $1
          AND COALESCE(election_year, $2) = $2
      )
      SELECT COUNT(*)::int AS count
      FROM latest_candidates
      WHERE rn = 1
    `,
    [source, cycle]
  );

  return {
    source,
    cycle,
    seen: Number(result.rows?.[0]?.count || 0),
    inserted: 0,
    updated: Number(result.rows?.[0]?.count || 0)
  };
}

async function importLiveVendorsFromTable() {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM vendors
  `);

  return {
    source: "vendors",
    seen: Number(result.rows?.[0]?.count || 0),
    inserted: 0,
    updated: Number(result.rows?.[0]?.count || 0)
  };
}

async function refreshFundraisingSnapshot() {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count,
           MAX(source_updated_at) AS last_synced_at
    FROM fundraising_live
  `);

 
