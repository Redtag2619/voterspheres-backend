import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

const FEC_API_BASE_URL =
  process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1";

const FEC_API_KEY =
  process.env.FEC_API_KEY || process.env.OPENFEC_API_KEY || "";

const DEFAULT_CYCLE = Number(process.env.FEC_DEFAULT_CYCLE || 2026);

function text(value = "") {
  return String(value || "").trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeState(value = "") {
  return String(value || "").trim().toUpperCase();
}

function relationshipStrength(amount, count = 1) {
  const total = money(amount);
  const contributions = Number(count || 1);

  if (total >= 100000 || contributions >= 5) return "High";
  if (total >= 25000 || contributions >= 2) return "Medium";
  if (total >= 5000) return "Growing";
  return "New";
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
      committee_id TEXT,
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
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS committee_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS occupation TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS employer TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS city TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_state ON donors(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_candidate_id ON donors(candidate_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_source ON donors(source)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_committee_id ON donors(committee_id)`);
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
      ('Atlantic Leadership Fund', 'Atlantic Leadership Fund', 'PAC', 'GA', 250000, 'High', 'GA-SEN-1', 'Live Candidate', 'Georgia Senate Victory Committee', 'Atlanta', 'manual_live_seed', NOW()),
      ('Keystone Civic Network', 'Keystone Civic Network', 'Individual Network', 'PA', 175000, 'Medium', 'PA-SEN-1', 'Live Candidate', 'Pennsylvania Senate Program', 'Philadelphia', 'manual_live_seed', NOW()),
      ('Great Lakes Action Council', 'Great Lakes Action Council', 'PAC', 'MI', 120000, 'Growing', 'MI-HOUSE-1', 'Live Candidate', 'Great Lakes House Committee', 'Detroit', 'manual_live_seed', NOW())
  `);
}

function buildFecUrl({ state = "", search = "", cycle = DEFAULT_CYCLE, limit = 100 }) {
  const url = new URL(`${FEC_API_BASE_URL}/schedules/schedule_a/`);

  url.searchParams.set("api_key", FEC_API_KEY);
  url.searchParams.set("two_year_transaction_period", String(cycle));
  url.searchParams.set("cycle", String(cycle));
  url.searchParams.set("per_page", String(Math.min(Number(limit) || 100, 100)));
  url.searchParams.set("sort", "-contribution_receipt_amount");
  url.searchParams.set("sort_hide_null", "true");

  if (state) {
    url.searchParams.set("contributor_state", normalizeState(state));
  }

  if (search) {
    url.searchParams.set("contributor_name", text(search));
  }

  return url;
}

async function fetchFecContributions(query = {}) {
  if (!FEC_API_KEY) {
    return {
      ok: false,
      reason: "Missing FEC_API_KEY",
      rows: [],
    };
  }

  const url = buildFecUrl(query);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "VoterSpheres Donor Network",
    },
  });

  const raw = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      reason: `FEC request failed ${response.status}: ${raw.slice(0, 500)}`,
      rows: [],
    };
  }

  const payload = raw ? JSON.parse(raw) : {};
  return {
    ok: true,
    rows: Array.isArray(payload.results) ? payload.results : [],
    pagination: payload.pagination || null,
  };
}

function normalizeFecRows(rows = []) {
  const grouped = new Map();

  rows.forEach((row, index) => {
    const donorName = text(row.contributor_name || "Unknown Donor");
    const state = normalizeState(row.contributor_state || row.state || "");
    const committeeName = text(
      row.committee?.name ||
        row.committee_name ||
        row.recipient_committee_name ||
        "Unknown Committee"
    );
    const committeeId = text(
      row.committee_id ||
        row.recipient_committee_id ||
        row.committee?.committee_id ||
        ""
    );

    const key = `${donorName}|${state}|${committeeId || committeeName}`;
    const amount = money(row.contribution_receipt_amount || row.amount || 0);

    if (!grouped.has(key)) {
      grouped.set(key, {
        donor_name: donorName,
        name: donorName,
        donor_type: row.entity_type_desc || row.entity_type || "Individual / Organization",
        state,
        amount: 0,
        contribution_count: 0,
        relationship_strength: "Growing",
        candidate_id: text(row.candidate_id || ""),
        candidate_name: text(row.candidate_name || ""),
        committee_name: committeeName,
        committee_id: committeeId,
        occupation: text(row.contributor_occupation || ""),
        employer: text(row.contributor_employer || ""),
        city: text(row.contributor_city || ""),
        source: "fec_schedule_a",
        source_updated_at: new Date(),
        fallback_id: `fec-${index}`,
      });
    }

    const item = grouped.get(key);
    item.amount += amount;
    item.contribution_count += 1;
    item.relationship_strength = relationshipStrength(
      item.amount,
      item.contribution_count
    );
  });

  return Array.from(grouped.values()).sort((a, b) => b.amount - a.amount);
}

async function upsertFecDonors(rows = []) {
  if (!rows.length) return;

  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO donors (
          donor_name,
          name,
          donor_type,
          state,
          amount,
          relationship_strength,
          candidate_id,
          candidate_name,
          committee_name,
          committee_id,
          occupation,
          employer,
          city,
          source,
          source_updated_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, NOW(), NOW()
        )
      `,
      [
        row.donor_name,
        row.name,
        row.donor_type,
        row.state,
        row.amount,
        row.relationship_strength,
        row.candidate_id,
        row.candidate_name,
        row.committee_name,
        row.committee_id,
        row.occupation,
        row.employer,
        row.city,
        row.source,
      ]
    );
  }
}

async function refreshFecDonors(req) {
  const {
    state = "",
    search = "",
    cycle = DEFAULT_CYCLE,
    limit = 100,
  } = req.query;

  const fec = await fetchFecContributions({
    state,
    search,
    cycle,
    limit,
  });

  if (!fec.ok) return fec;

  const normalized = normalizeFecRows(fec.rows);
  await upsertFecDonors(normalized);

  return {
    ok: true,
    imported: normalized.length,
    pagination: fec.pagination,
  };
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "donors",
    fec_configured: Boolean(FEC_API_KEY),
  });
});

router.post("/refresh", async (req, res) => {
  try {
    await ensureDonorsTable();
    const result = await refreshFecDonors(req);
    res.json(result);
  } catch (error) {
    console.error("FEC donor refresh failed:", error);
    res.status(500).json({
      error: error.message || "Failed to refresh FEC donors",
    });
  }
});

router.get("/network/public", async (req, res) => {
  try {
    await seedDonorsIfEmpty();

    if (String(req.query.live || "1") !== "0") {
      await refreshFecDonors(req);
    }

    return handleDonorNetwork(req, res);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load donor network",
    });
  }
});

router.get("/network", async (req, res) => {
  try {
    await seedDonorsIfEmpty();

    if (String(req.query.live || "1") !== "0") {
      await refreshFecDonors(req);
    }

    return handleDonorNetwork(req, res);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load donor network",
    });
  }
});

async function handleDonorNetwork(req, res) {
  const {
    state = "",
    search = "",
    candidate_id = "",
    limit = 100,
  } = req.query;

  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 250));
  const term = text(search);
  const normalizedState = normalizeState(state);

  const values = [
    normalizedState,
    term,
    text(candidate_id),
    safeLimit,
  ];

  const whereSql = `
    WHERE
      ($1 = '' OR UPPER(COALESCE(state, '')) = $1)
      AND ($2 = '' OR (
        COALESCE(donor_name, name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(donor_type, '') ILIKE '%' || $2 || '%'
        OR COALESCE(relationship_strength, '') ILIKE '%' || $2 || '%'
        OR COALESCE(state, '') ILIKE '%' || $2 || '%'
        OR COALESCE(candidate_name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(committee_name, '') ILIKE '%' || $2 || '%'
        OR COALESCE(occupation, '') ILIKE '%' || $2 || '%'
        OR COALESCE(employer, '') ILIKE '%' || $2 || '%'
        OR COALESCE(city, '') ILIKE '%' || $2 || '%'
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
        committee_id,
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
      SELECT
        state,
        COALESCE(SUM(COALESCE(amount, 0)), 0)::numeric AS total
      FROM donors
      ${whereSql}
      GROUP BY state
      ORDER BY total DESC
      LIMIT 1
    `,
    values.slice(0, 3)
  );

  const stateBreakdownResult = await pool.query(
    `
      SELECT
        COALESCE(state, 'Unknown') AS state,
        COUNT(*)::int AS donor_count,
        COALESCE(SUM(COALESCE(amount, 0)), 0)::numeric AS total_amount,
        COALESCE(AVG(COALESCE(amount, 0)), 0)::numeric AS average_amount
      FROM donors
      ${whereSql}
      GROUP BY state
      ORDER BY total_amount DESC
      LIMIT 12
    `,
    values.slice(0, 3)
  );

  const committeeBreakdownResult = await pool.query(
    `
      SELECT
        committee_id,
        COALESCE(committee_name, 'Unknown Committee') AS committee_name,
        COALESCE(state, 'National') AS state,
        COUNT(*)::int AS donor_count,
        COALESCE(SUM(COALESCE(amount, 0)), 0)::numeric AS total_amount
      FROM donors
      ${whereSql}
      GROUP BY committee_id, committee_name, state
      ORDER BY total_amount DESC
      LIMIT 12
    `,
    values.slice(0, 3)
  );

  res.json({
    results: result.rows.map((row) => ({
      ...row,
      amount: Number(row.amount || 0),
    })),
    stateBreakdown: stateBreakdownResult.rows.map((row) => ({
      ...row,
      total_amount: Number(row.total_amount || 0),
      average_amount: Number(row.average_amount || 0),
    })),
    committeeBreakdown: committeeBreakdownResult.rows.map((row) => ({
      ...row,
      total_amount: Number(row.total_amount || 0),
    })),
    summary: {
      total_donors: summaryResult.rows[0]?.total_donors || 0,
      total_amount: Number(summaryResult.rows[0]?.total_amount || 0),
      top_state: stateResult.rows[0]?.state || "N/A",
      source: FEC_API_KEY ? "FEC Schedule A + cached donors" : "Cached donors only",
    },
    _demo: false,
  });
}

export default router;
