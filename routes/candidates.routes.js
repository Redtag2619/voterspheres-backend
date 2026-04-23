import express from "express";
import axios from "axios";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

const router = express.Router();

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

  if (!cleaned) {
    return { first_name: "", last_name: "" };
  }

  const commaParts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);

  if (commaParts.length >= 2) {
    return {
      first_name: commaParts.slice(1).join(" "),
      last_name: commaParts[0]
    };
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return {
      first_name: parts[0],
      last_name: ""
    };
  }

  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1]
  };
}

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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidates_state
    ON candidates (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidates_office
    ON candidates (office)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidates_party
    ON candidates (party)
  `);
}

async function fetchOpenFecCandidates() {
  const apiKey = normalizeText(process.env.FEC_API_KEY || "");
  const cycle = Number(process.env.FEC_CYCLE || 2026);
  const maxPages = Math.max(1, Number(process.env.FEC_INGEST_LIMIT || 5));
  const perPage = 100;
  const baseUrl = String(
    process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1"
  ).replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("Missing FEC_API_KEY");
  }

  const allRows = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const response = await axios.get(`${baseUrl}/candidates/search/`, {
      params: {
        api_key: apiKey,
        cycle,
        page,
        per_page: perPage,
        sort_null_only: false
      },
      timeout: 30000
    });

    const payload = response?.data || {};
    const rows = Array.isArray(payload.results) ? payload.results : [];

    allRows.push(...rows);

    totalPages = Number(payload?.pagination?.pages || 1) || 1;
    page += 1;
  }

  return {
    cycle,
    rows: allRows
  };
}

async function importLiveCandidates() {
  await ensureCandidatesTable();

  const { cycle, rows } = await fetchOpenFecCandidates();
  const source = "openfec";

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const externalId = normalizeText(row.candidate_id || row.id || "");
    if (!externalId) continue;

    const fullName = normalizeText(row.name || row.candidate_name || "");
    if (!fullName) continue;

    const { first_name, last_name } = splitCandidateName(fullName);

    const principalCommittee =
      Array.isArray(row.principal_committees) && row.principal_committees.length
        ? row.principal_committees[0]
        : null;

    const payload = [
      externalId,
      source,
      fullName,
      normalizeText(first_name),
      normalizeText(last_name),
      normalizeState(row.state),
      normalizeText(row.office_full || normalizeOffice(row.office)),
      row.district !== null && row.district !== undefined ? String(row.district) : "",
      normalizeText(row.party_full || row.party || ""),
      normalizeText(
        row.incumbent_challenge_full ||
          row.incumbent_challenge ||
          row.candidate_status ||
          ""
      ),
      normalizeText(
        principalCommittee?.committee_id ||
          row.principal_campaign_committee_id ||
          ""
      ),
      normalizeText(
        principalCommittee?.name ||
          row.principal_campaign_committee_name ||
          ""
      ),
      normalizeText(row.website || ""),
      cycle,
      normalizeText(row.candidate_status || "active"),
      new Date()
    ];

    const existing = await pool.query(
      `
        SELECT id
        FROM candidates
        WHERE COALESCE(source, '') = COALESCE($1, '')
          AND COALESCE(external_id, '') = COALESCE($2, '')
        LIMIT 1
      `,
      [source, externalId]
    );

    if (existing.rows.length) {
      await pool.query(
        `
          UPDATE candidates
          SET
            full_name = $3,
            first_name = $4,
            last_name = $5,
            state = $6,
            office = $7,
            district = $8,
            party = $9,
            incumbent_status = $10,
            campaign_committee_id = $11,
            campaign_committee_name = $12,
            website = $13,
            election_year = $14,
            status = $15,
            source_updated_at = $16,
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
          INSERT INTO candidates (
            external_id,
            source,
            full_name,
            first_name,
            last_name,
            state,
            office,
            district,
            party,
            incumbent_status,
            campaign_committee_id,
            campaign_committee_name,
            website,
            election_year,
            status,
            source_updated_at,
            last_imported_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW(),NOW()
          )
        `,
        payload
      );
      inserted += 1;
    }
  }

  return {
    source,
    cycle,
    seen: rows.length,
    inserted,
    updated
  };
}

router.get("/states", async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      WHERE state IS NOT NULL
        AND state <> ''
      ORDER BY state ASC
    `);

    res.status(200).json(result.rows.map((row) => row.state).filter(Boolean));
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate states"
    });
  }
});

router.get("/offices", async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      SELECT DISTINCT office
      FROM candidates
      WHERE office IS NOT NULL
        AND office <> ''
      ORDER BY office ASC
    `);

    res.status(200).json(result.rows.map((row) => row.office).filter(Boolean));
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate offices"
    });
  }
});

router.get("/parties", async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      SELECT DISTINCT party
      FROM candidates
      WHERE party IS NOT NULL
        AND party <> ''
      ORDER BY party ASC
    `);

    res.status(200).json(result.rows.map((row) => row.party).filter(Boolean));
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate parties"
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    await ensureCandidatesTable();

    const value = normalizeText(req.params.id);

    const result = await pool.query(
      `
        SELECT
          id,
          external_id,
          source,
          full_name,
          first_name,
          last_name,
          state,
          office,
          district,
          party,
          incumbent_status,
          campaign_committee_id,
          campaign_committee_name,
          website,
          election_year,
          status,
          source_updated_at,
          last_imported_at,
          created_at,
          updated_at
        FROM candidates
        WHERE CAST(id AS TEXT) = $1
           OR COALESCE(external_id, '') = $1
        LIMIT 1
      `,
      [value]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Candidate not found"
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate"
    });
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureCandidatesTable();

    const {
      q = "",
      state = "",
      office = "",
      party = "",
      page = 1,
      limit = 20
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const offset = (safePage - 1) * safeLimit;

    const results = await pool.query(
      `
        SELECT
          id,
          external_id,
          source,
          full_name,
          first_name,
          last_name,
          state,
          office,
          district,
          party,
          incumbent_status,
          campaign_committee_id,
          campaign_committee_name,
          website,
          election_year,
          status,
          source_updated_at,
          last_imported_at,
          created_at,
          updated_at
        FROM candidates
        WHERE
          ($1 = '' OR (
            COALESCE(full_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(first_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(last_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(state, '') ILIKE '%' || $1 || '%'
            OR COALESCE(office, '') ILIKE '%' || $1 || '%'
            OR COALESCE(party, '') ILIKE '%' || $1 || '%'
            OR COALESCE(campaign_committee_name, '') ILIKE '%' || $1 || '%'
          ))
          AND ($2 = '' OR COALESCE(state, '') = $2)
          AND ($3 = '' OR COALESCE(office, '') = $3)
          AND ($4 = '' OR COALESCE(party, '') = $4)
        ORDER BY
          COALESCE(state, 'ZZZ') ASC,
          COALESCE(office, 'ZZZ') ASC,
          COALESCE(last_name, full_name, 'ZZZ') ASC
        LIMIT $5 OFFSET $6
      `,
      [
        normalizeText(q),
        normalizeState(state),
        normalizeText(office),
        normalizeText(party),
        safeLimit,
        offset
      ]
    );

    const total = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM candidates
        WHERE
          ($1 = '' OR (
            COALESCE(full_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(first_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(last_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(state, '') ILIKE '%' || $1 || '%'
            OR COALESCE(office, '') ILIKE '%' || $1 || '%'
            OR COALESCE(party, '') ILIKE '%' || $1 || '%'
            OR COALESCE(campaign_committee_name, '') ILIKE '%' || $1 || '%'
          ))
          AND ($2 = '' OR COALESCE(state, '') = $2)
          AND ($3 = '' OR COALESCE(office, '') = $3)
          AND ($4 = '' OR COALESCE(party, '') = $4)
      `,
      [
        normalizeText(q),
        normalizeState(state),
        normalizeText(office),
        normalizeText(party)
      ]
    );

    res.status(200).json({
      total: total.rows[0]?.total || 0,
      page: safePage,
      limit: safeLimit,
      results: results.rows
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidates"
    });
  }
});

router.post("/import", requireRoles("admin"), async (_req, res) => {
  try {
    const summary = await importLiveCandidates();

    res.status(200).json({
      success: true,
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to import live candidates"
    });
  }
});

export default router;
