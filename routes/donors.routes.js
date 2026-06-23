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
      website_url TEXT,
      linkedin_url TEXT,
      x_url TEXT,
      facebook_url TEXT,
      phone TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      postal_code TEXT,
      contact_source TEXT DEFAULT 'fec_disclosure',
      contact_verified BOOLEAN DEFAULT false,
      contribution_count INTEGER DEFAULT 1,
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
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS website_url TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS linkedin_url TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS x_url TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS facebook_url TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address_line1 TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address_line2 TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS postal_code TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS contact_source TEXT DEFAULT 'fec_disclosure'`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS contact_verified BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS contribution_count INTEGER DEFAULT 1`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_state ON donors(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_candidate_id ON donors(candidate_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_source ON donors(source)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_committee_id ON donors(committee_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_contact_verified ON donors(contact_verified)`);
}

async function seedDonorsIfEmpty() {
  await ensureDonorsTable();

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM donors`);
  if (Number(countResult.rows[0]?.total || 0) > 0) return;

  await pool.query(`
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
      city,
      source,
      source_updated_at,
      contact_source,
      contact_verified,
      contribution_count
    )
    VALUES
      ('Atlantic Leadership Fund', 'Atlantic Leadership Fund', 'PAC', 'GA', 250000, 'High', 'GA-SEN-1', 'Live Candidate', 'Georgia Senate Victory Committee', 'Atlanta', 'manual_live_seed', NOW(), 'manual_seed', false, 1),
      ('Keystone Civic Network', 'Keystone Civic Network', 'Individual Network', 'PA', 175000, 'Medium', 'PA-SEN-1', 'Live Candidate', 'Pennsylvania Senate Program', 'Philadelphia', 'manual_live_seed', NOW(), 'manual_seed', false, 1),
      ('Great Lakes Action Council', 'Great Lakes Action Council', 'PAC', 'MI', 120000, 'Growing', 'MI-HOUSE-1', 'Live Candidate', 'Great Lakes House Committee', 'Detroit', 'manual_live_seed', NOW(), 'manual_seed', false, 1)
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

    const key = `${donorName}|${state}`;
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

        website_url: "",
        linkedin_url: "",
        x_url: "",
        facebook_url: "",
        phone: "",
        address_line1: text(row.contributor_street_1 || ""),
        address_line2: text(row.contributor_street_2 || ""),
        postal_code: text(row.contributor_zip || ""),
        contact_source: "fec_disclosure",
        contact_verified: false,

        fallback_id: `fec-${index}`,
      });
    }

    const item = grouped.get(key);
    item.amount += amount;
    item.contribution_count += 1;
    item.relationship_strength = relationshipStrength(item.amount, item.contribution_count);

    if (!item.committee_name && committeeName) item.committee_name = committeeName;
    if (!item.committee_id && committeeId) item.committee_id = committeeId;
    if (!item.occupation && row.contributor_occupation) item.occupation = text(row.contributor_occupation);
    if (!item.employer && row.contributor_employer) item.employer = text(row.contributor_employer);
    if (!item.city && row.contributor_city) item.city = text(row.contributor_city);
    if (!item.postal_code && row.contributor_zip) item.postal_code = text(row.contributor_zip);
    if (!item.address_line1 && row.contributor_street_1) item.address_line1 = text(row.contributor_street_1);
    if (!item.address_line2 && row.contributor_street_2) item.address_line2 = text(row.contributor_street_2);
  });

  return Array.from(grouped.values()).sort((a, b) => b.amount - a.amount);
}

async function refreshFecDonors(req) {
  const result = await fetchFecContributions(req.query || {});

  if (!result.ok) {
    return result;
  }

  const donors = normalizeFecRows(result.rows);

  const states = [
    ...new Set(
      donors
        .map((d) => d.state)
        .filter(Boolean)
    ),
  ];

  if (states.length) {
    await pool.query(
      `
      DELETE FROM donors
      WHERE source = 'fec_schedule_a'
      AND state = ANY($1)
    `,
      [states]
    );
  }

  for (const donor of donors) {
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
        website_url,
        linkedin_url,
        x_url,
        facebook_url,
        phone,
        address_line1,
        address_line2,
        postal_code,
        contact_source,
        contact_verified,
        contribution_count,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,NOW(),
        $15,$16,$17,$18,$19,$20,$21,$22,
        $23,$24,$25,NOW()
      )
    `,
      [
        donor.donor_name,
        donor.name,
        donor.donor_type,
        donor.state,
        donor.amount,
        donor.relationship_strength,
        donor.candidate_id,
        donor.candidate_name,
        donor.committee_name,
        donor.committee_id,
        donor.occupation,
        donor.employer,
        donor.city,
        donor.source,
        donor.website_url,
        donor.linkedin_url,
        donor.x_url,
        donor.facebook_url,
        donor.phone,
        donor.address_line1,
        donor.address_line2,
        donor.postal_code,
        donor.contact_source,
        donor.contact_verified,
        donor.contribution_count,
      ]
    );
  }

  return {
    ok: true,
    imported: donors.length,
  };
}

router.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "donors",
    source: "fec",
  });
});

router.post("/refresh", async (req, res) => {
  try {
    await ensureDonorsTable();

    const result = await refreshFecDonors(req);

    res.json(result);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message || "Failed donor refresh",
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
    limit = 250,
  } = req.query;

  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 250, 500)
  );

  const values = [
    text(state),
    text(search),
    text(candidate_id),
    safeLimit,
  ];

  const whereSql = `
    WHERE
      ($1 = '' OR COALESCE(state,'') = $1)

      AND (
        $2 = ''
        OR COALESCE(donor_name,'') ILIKE '%' || $2 || '%'
        OR COALESCE(donor_type,'') ILIKE '%' || $2 || '%'
        OR COALESCE(state,'') ILIKE '%' || $2 || '%'
        OR COALESCE(candidate_name,'') ILIKE '%' || $2 || '%'
        OR COALESCE(committee_name,'') ILIKE '%' || $2 || '%'
        OR COALESCE(occupation,'') ILIKE '%' || $2 || '%'
        OR COALESCE(employer,'') ILIKE '%' || $2 || '%'
        OR COALESCE(city,'') ILIKE '%' || $2 || '%'
        OR COALESCE(postal_code,'') ILIKE '%' || $2 || '%'
      )

      AND (
        $3 = ''
        OR COALESCE(candidate_id,'') = $3
      )
  `;

  const result = await pool.query(
    `
    SELECT
      id,
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

      website_url,
      linkedin_url,
      x_url,
      facebook_url,
      phone,
      address_line1,
      address_line2,
      postal_code,

      contact_source,
      contact_verified,
      contribution_count

    FROM donors
    ${whereSql}
    ORDER BY amount DESC
    LIMIT $4
  `,
    values
  );

  const summaryResult = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_donors,
      COALESCE(SUM(amount),0)::numeric AS total_amount
    FROM donors
    ${whereSql}
  `,
    values.slice(0, 3)
  );

  const stateBreakdownResult = await pool.query(
    `
    SELECT
      state,
      COUNT(*)::int AS donor_count,
      COALESCE(SUM(amount),0)::numeric AS total_amount
    FROM donors
    ${whereSql}
    GROUP BY state
    ORDER BY total_amount DESC
    LIMIT 50
  `,
    values.slice(0, 3)
  );

  const committeeBreakdownResult = await pool.query(
    `
    SELECT
      committee_id,
      committee_name,
      COUNT(*)::int AS donor_count,
      COALESCE(SUM(amount),0)::numeric AS total_amount
    FROM donors
    ${whereSql}
    GROUP BY committee_id, committee_name
    ORDER BY total_amount DESC
    LIMIT 25
  `,
    values.slice(0, 3)
  );

  res.json({
    results: result.rows.map((row) => ({
      ...row,
      amount: Number(row.amount || 0),
      contribution_count: Number(
        row.contribution_count || 1
      ),
    })),

    summary: {
      total_donors:
        Number(
          summaryResult.rows?.[0]?.total_donors || 0
        ),
      total_amount:
        Number(
          summaryResult.rows?.[0]?.total_amount || 0
        ),
    },

    stateBreakdown: stateBreakdownResult.rows.map(
      (row) => ({
        ...row,
        total_amount: Number(
          row.total_amount || 0
        ),
      })
    ),

    committeeBreakdown:
      committeeBreakdownResult.rows.map((row) => ({
        ...row,
        total_amount: Number(
          row.total_amount || 0
        ),
      })),

    _demo: false,
  });
}

export default router;
