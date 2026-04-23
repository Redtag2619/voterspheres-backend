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

  const spaceParts = cleaned.split(/\s+/).filter(Boolean);
  if (spaceParts.length === 1) {
    return { first_name: spaceParts[0], last_name: "" };
  }

  return {
    first_name: spaceParts.slice(0, -1).join(" "),
    last_name: spaceParts.slice(-1).join("")
  };
}

async function fetchOpenFecCandidates({
  cycle,
  apiKey,
  maxPages = 5,
  perPage = 100
}) {
  const baseUrl = String(
    process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1"
  ).replace(/\/+$/, "");

  const rows = [];
  let page = 1;
  let pages = 1;

  while (page <= pages && page <= maxPages) {
    const response = await axios.get(`${baseUrl}/candidates/search/`, {
      params: {
        api_key: apiKey,
        cycle,
        per_page: perPage,
        page,
        sort_null_only: false
      },
      timeout: 30000
    });

    const payload = response?.data || {};
    const results = Array.isArray(payload.results) ? payload.results : [];

    rows.push(...results);

    const paginationPages =
      Number(payload?.pagination?.pages || 1) || 1;

    pages = paginationPages;
    page += 1;
  }

  return rows;
}

async function importLiveCandidates() {
  await ensureCandidatesTable();

  const cycle = Number(process.env.FEC_CYCLE || 2026);
  const apiKey = normalizeText(process.env.FEC_API_KEY || "");
  const source = "openfec";

  if (!apiKey) {
    throw new Error("Missing FEC_API_KEY");
  }

  const sourceRows = await fetchOpenFecCandidates({
    cycle,
    apiKey,
    maxPages: 5,
    perPage: 100
  });

  let inserted = 0;
  let updated = 0;

  for (const row of sourceRows) {
    const candidateId = normalizeText(row.candidate_id || row.id || "");
    if (!candidateId) continue;

    const fullName = normalizeText(row.name || row.candidate_name || "");
    const nameParts = splitCandidateName(fullName);

    const office =
      normalizeText(row.office_full) || normalizeOffice(row.office);

    const district =
      row.district !== null && row.district !== undefined
        ? String(row.district)
        : "";

    const committee =
      Array.isArray(row.principal_committees) && row.principal_committees.length
        ? row.principal_committees[0]
        : null;

    const committeeId = normalizeText(
      committee?.committee_id ||
        row.principal_campaign_committee_id ||
        ""
    );

    const committeeName = normalizeText(
      committee?.name ||
        row.principal_campaign_committee_name ||
        ""
    );

    const payload = [
      candidateId,
      source,
      fullName,
      normalizeText(nameParts.first_name),
      normalizeText(nameParts.last_name),
      normalizeState(row.state),
      office,
      normalizeText(district),
      normalizeText(row.party_full || row.party || ""),
      normalizeText(
        row.incumbent_challenge_full ||
          row.incumbent_challenge ||
          row.candidate_status ||
          ""
      ),
      committeeId,
      committeeName,
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
      [source, candidateId]
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
    seen: sourceRows.length,
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

    res.status(200).json({
      states: result.rows.map((row) => row.state).filter(Boolean)
    });
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

    res.status(200).json({
      offices: result.rows.map((row) => row.office).filter(Boolean)
    });
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

    res.status(200).json({
      parties: result.rows.map((row) => row.party).filter(Boolean)
    });
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

    const listResult = await pool.query(
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

    const totalResult = await pool.query(
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
      total: totalResult.rows[0]?.total || 0,
      page: safePage,
      limit: safeLimit,
      results: listResult.rows
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
