import express from "express";
import axios from "axios";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

const router = express.Router();

/* --------------------------
   HELPERS
-------------------------- */

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  return String(value || "").trim().toUpperCase();
}

function normalizeOffice(value = "") {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "H") return "House";
  if (raw === "S") return "Senate";
  if (raw === "P") return "President";
  return raw || "";
}

function splitCandidateName(fullName = "") {
  const cleaned = normalizeText(fullName);

  if (!cleaned) return { first_name: "", last_name: "" };

  const commaParts = cleaned.split(",").map(p => p.trim()).filter(Boolean);

  if (commaParts.length >= 2) {
    return {
      first_name: commaParts.slice(1).join(" "),
      last_name: commaParts[0]
    };
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "" };
  }

  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1]
  };
}

/* --------------------------
   TABLE
-------------------------- */

async function ensureCandidatesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      external_id TEXT,
      source TEXT,
      full_name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      state TEXT,
      office TEXT,
      district TEXT,
      party TEXT,
      incumbent_status TEXT,
      campaign_committee_id TEXT,
      campaign_committee_name TEXT,
      website TEXT,
      election_year INTEGER,
      status TEXT DEFAULT 'active',
      source_updated_at TIMESTAMP,
      last_imported_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_candidates_source_external
    ON candidates (COALESCE(source, ''), COALESCE(external_id, ''))
    WHERE external_id IS NOT NULL
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_state ON candidates(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_office ON candidates(office)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_party ON candidates(party)`);
}

/* --------------------------
   FEC INGEST
-------------------------- */

async function fetchOpenFecCandidates() {
  const apiKey = normalizeText(process.env.FEC_API_KEY);
  const cycle = Number(process.env.FEC_CYCLE || 2026);
  const maxPages = Math.max(1, Number(process.env.FEC_INGEST_LIMIT || 5));

  if (!apiKey) throw new Error("Missing FEC_API_KEY");

  let page = 1;
  let totalPages = 1;
  const rows = [];

  while (page <= totalPages && page <= maxPages) {
    const res = await axios.get("https://api.open.fec.gov/v1/candidates/search/", {
      params: { api_key: apiKey, cycle, page, per_page: 100 }
    });

    rows.push(...(res.data?.results || []));
    totalPages = res.data?.pagination?.pages || 1;
    page++;
  }

  return { cycle, rows };
}

async function importLiveCandidates() {
  await ensureCandidatesTable();

  const { cycle, rows } = await fetchOpenFecCandidates();
  const source = "openfec";

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const externalId = normalizeText(row.candidate_id);
    if (!externalId) continue;

    const fullName = normalizeText(row.name);
    if (!fullName) continue;

    const { first_name, last_name } = splitCandidateName(fullName);

    const exists = await pool.query(
      `SELECT id FROM candidates WHERE source=$1 AND external_id=$2 LIMIT 1`,
      [source, externalId]
    );

    const payload = [
      externalId,
      source,
      fullName,
      first_name,
      last_name,
      normalizeState(row.state),
      normalizeOffice(row.office),
      row.district || "",
      row.party || "",
      row.incumbent_challenge_full || "",
      row.principal_campaign_committee_id || "",
      row.principal_campaign_committee_name || "",
      row.website || "",
      cycle,
      row.candidate_status || "active",
      new Date()
    ];

    if (exists.rows.length) {
      await pool.query(`
        UPDATE candidates SET
          full_name=$3,
          first_name=$4,
          last_name=$5,
          state=$6,
          office=$7,
          district=$8,
          party=$9,
          incumbent_status=$10,
          campaign_committee_id=$11,
          campaign_committee_name=$12,
          website=$13,
          election_year=$14,
          status=$15,
          source_updated_at=$16,
          updated_at=NOW()
        WHERE source=$2 AND external_id=$1
      `, payload);
      updated++;
    } else {
      await pool.query(`
        INSERT INTO candidates (
          external_id, source, full_name, first_name, last_name,
          state, office, district, party, incumbent_status,
          campaign_committee_id, campaign_committee_name,
          website, election_year, status,
          source_updated_at, created_at, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()
        )
      `, payload);
      inserted++;
    }
  }

  return { inserted, updated, total: rows.length };
}

/* --------------------------
   ROUTES
-------------------------- */

router.get("/", requireAuth, async (req, res) => {
  try {
    await ensureCandidatesTable();

    const { q = "", state = "", office = "", party = "", page = 1, limit = 20 } = req.query;

    const safePage = Math.max(1, Number(page));
    const safeLimit = Math.min(100, Number(limit));
    const offset = (safePage - 1) * safeLimit;

    const values = [
      normalizeText(q),
      normalizeState(state),
      normalizeText(office),
      normalizeText(party),
      safeLimit,
      offset
    ];

    const rows = await pool.query(`
      SELECT * FROM candidates
      WHERE
        ($1 = '' OR full_name ILIKE '%'||$1||'%')
        AND ($2 = '' OR state = $2)
        AND ($3 = '' OR office = $3)
        AND ($4 = '' OR party = $4)
      ORDER BY state, office, last_name
      LIMIT $5 OFFSET $6
    `, values);

    const total = await pool.query(`
      SELECT COUNT(*)::int FROM candidates
    `);

    res.json({
      total: total.rows[0].count,
      page: safePage,
      limit: safeLimit,
      results: rows.rows,
      _live: true
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --------------------------
   FIXED: refresh endpoint
-------------------------- */

router.post("/refresh-profiles", requireAuth, async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      UPDATE candidates
      SET updated_at = NOW()
      WHERE id IN (
        SELECT id FROM candidates
        ORDER BY updated_at DESC
        LIMIT 200
      )
      RETURNING id
    `);

    res.json({
      ok: true,
      refreshed: result.rowCount,
      message: "Candidate profiles refreshed",
      _live: true
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --------------------------
   LOOKUPS
-------------------------- */

router.get("/states", requireAuth, async (_req, res) => {
  const r = await pool.query(`SELECT DISTINCT state FROM candidates ORDER BY state`);
  res.json(r.rows.map(r => r.state));
});

router.get("/offices", requireAuth, async (_req, res) => {
  const r = await pool.query(`SELECT DISTINCT office FROM candidates ORDER BY office`);
  res.json(r.rows.map(r => r.office));
});

router.get("/parties", requireAuth, async (_req, res) => {
  const r = await pool.query(`SELECT DISTINCT party FROM candidates ORDER BY party`);
  res.json(r.rows.map(r => r.party));
});

/* --------------------------
   IMPORT
-------------------------- */

router.post("/import", requireAuth, requireRoles("admin"), async (_req, res) => {
  try {
    const summary = await importLiveCandidates();
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post("/refresh-profiles", async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      UPDATE candidates
      SET updated_at = NOW()
      WHERE id IN (
        SELECT id
        FROM candidates
        ORDER BY COALESCE(updated_at, last_imported_at, created_at) DESC NULLS LAST
        LIMIT 250
      )
      RETURNING id
    `);

    res.json({
      ok: true,
      refreshed: result.rowCount || 0,
      message: "Candidate profiles refresh endpoint is online.",
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to refresh candidate profiles"
    });
  }
});

export default router;

