import express from "express";
import axios from "axios";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRoles } from "../middleware/roles.middleware.js";
import { pool } from "../db/pool.js";

import {
  enrichCandidateProfile,
  enrichAllCandidateProfiles,
  updateCandidateProfileManual,
  updateCandidateProfileLocks,
  updateCandidateVerification
} from "../services/candidateContactEnrichment.service.js";

import {
  getCandidateIntelligenceSummary,
  dispatchCandidateIntelligenceAlerts
} from "../services/candidateIntelligence.service.js";

const router = express.Router();

/* --------------------------
   HELPERS
-------------------------- */

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeState(value = "") {
  const raw = String(value || "").trim();

  const map = {
    Georgia: "GA",
    Pennsylvania: "PA",
    Arizona: "AZ"
  };

  return map[raw] || raw.toUpperCase();
}

function normalizeOffice(value = "") {
  const raw = String(value || "").trim().toUpperCase();

  if (raw === "H") return "House";
  if (raw === "S") return "Senate";
  if (raw === "P") return "President";

  if (raw === "HOUSE") return "House";
  if (raw === "SENATE") return "Senate";
  if (raw === "PRESIDENT") return "President";
  if (raw === "GOVERNOR") return "Governor";

  return String(value || "").trim();
}

function normalizeParty(value = "") {
  const raw = String(value || "").trim();

  const upper = raw.toUpperCase();

  const map = {
    DEM: "Democratic",
    DEMOCRATIC: "Democratic",
    "DEMOCRATIC PARTY": "Democratic",
    DFL: "Democratic",
    REP: "Republican",
    GOP: "Republican",
    REPUBLICAN: "Republican",
    "REPUBLICAN PARTY": "Republican",
    IND: "Independent",
    INDEPENDENT: "Independent",
    LIB: "Libertarian",
    LIBERTARIAN: "Libertarian",
    "LIBERTARIAN PARTY": "Libertarian",
    GRE: "Green",
    GREEN: "Green",
    OTH: "Other",
    OTHER: "Other",
    UNK: "Unknown",
    UNKNOWN: "Unknown",
    NON: "Nonpartisan",
    NPA: "Nonpartisan"
  };

  return map[upper] || raw;
}

function splitCandidateName(fullName = "") {
  const cleaned = normalizeText(fullName);

  if (!cleaned) return { first_name: "", last_name: "" };

  const commaParts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);

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
   TABLE / INDEXES
-------------------------- */

async function ensureCandidatesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      external_id TEXT,
      source TEXT,
      full_name TEXT,
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

  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS full_name TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS first_name TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS last_name TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS office TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS district TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS party TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS incumbent_status TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS campaign_committee_id TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS campaign_committee_name TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS website TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS election_year INTEGER`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_candidates_source_external
    ON candidates (COALESCE(source, ''), COALESCE(external_id, ''))
    WHERE external_id IS NOT NULL
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_state ON candidates(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_office ON candidates(office)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_party ON candidates(party)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_full_name ON candidates(full_name)`);
}

/* --------------------------
   FEC INGEST
-------------------------- */

async function fetchOpenFecCandidates() {
  const apiKey = normalizeText(process.env.FEC_API_KEY);
  const cycle = Number(process.env.FEC_CYCLE || 2026);
  const maxPages = Math.max(1, Number(process.env.FEC_INGEST_LIMIT || 5));
  const baseUrl = String(
    process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1"
  ).replace(/\/+$/, "");

  if (!apiKey) throw new Error("Missing FEC_API_KEY");

  let page = 1;
  let totalPages = 1;
  const rows = [];

  while (page <= totalPages && page <= maxPages) {
    const res = await axios.get(`${baseUrl}/candidates/search/`, {
      params: {
        api_key: apiKey,
        cycle,
        page,
        per_page: 100
      },
      timeout: 30000
    });

    rows.push(...(res.data?.results || []));
    totalPages = Number(res.data?.pagination?.pages || 1) || 1;
    page += 1;
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
    const externalId = normalizeText(row.candidate_id || row.id);
    if (!externalId) continue;

    const fullName = normalizeText(row.name || row.candidate_name);
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
      first_name,
      last_name,
      normalizeState(row.state),
      normalizeOffice(row.office_full || row.office),
      row.district !== null && row.district !== undefined ? String(row.district) : "",
      normalizeParty(row.party_full || row.party || ""),
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

    const exists = await pool.query(
      `
        SELECT id
        FROM candidates
        WHERE COALESCE(source, '') = COALESCE($1, '')
          AND COALESCE(external_id, '') = COALESCE($2, '')
        LIMIT 1
      `,
      [source, externalId]
    );

    if (exists.rows.length) {
      await pool.query(
        `
          UPDATE candidates SET
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
          WHERE COALESCE(source, '') = COALESCE($2, '')
            AND COALESCE(external_id, '') = COALESCE($1, '')
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
    total: rows.length,
    inserted,
    updated
  };
}

/* --------------------------
   STATIC ROUTES FIRST
-------------------------- */

router.get("/states", requireAuth, async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      WHERE state IS NOT NULL AND state <> ''
      ORDER BY state ASC
    `);

    const values = [
      ...new Set(result.rows.map((row) => normalizeState(row.state)).filter(Boolean))
    ].sort();

    res.json({ states: values, results: values });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate states"
    });
  }
});

router.get("/offices", requireAuth, async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      SELECT DISTINCT office
      FROM candidates
      WHERE office IS NOT NULL AND office <> ''
      ORDER BY office ASC
    `);

    const values = [
      ...new Set(result.rows.map((row) => normalizeOffice(row.office)).filter(Boolean))
    ].sort();

    res.json({ offices: values, results: values });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate offices"
    });
  }
});

router.get("/parties", requireAuth, async (_req, res) => {
  try {
    await ensureCandidatesTable();

    const result = await pool.query(`
      SELECT DISTINCT party
      FROM candidates
      WHERE party IS NOT NULL AND party <> ''
      ORDER BY party ASC
    `);

    const values = [
      ...new Set(result.rows.map((row) => normalizeParty(row.party)).filter(Boolean))
    ].sort();

    res.json({ parties: values, results: values });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate parties"
    });
  }
});

router.get("/intelligence/scoring", requireAuth, async (req, res) => {
  try {
    const result = await getCandidateIntelligenceSummary(req.query || {});
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate intelligence scoring"
    });
  }
});

router.post("/intelligence/dispatch-alerts", requireAuth, async (req, res) => {
  try {
    const result = await dispatchCandidateIntelligenceAlerts(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to dispatch candidate intelligence alerts"
    });
  }
});

router.post("/refresh-profiles", requireAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.body?.limit || 100), 250));
    const result = await enrichAllCandidateProfiles(limit);

    res.status(200).json({
      ok: true,
      message: "Candidate profile refresh completed.",
      ...result
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to refresh candidate profiles"
    });
  }
});

router.post("/import", requireAuth, requireRoles("admin"), async (_req, res) => {
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

/* --------------------------
   LIST ROUTE
-------------------------- */

router.get("/", requireAuth, async (req, res) => {
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

    const search = normalizeText(q);
    const stateFilter = normalizeState(state);
    const officeFilter = normalizeOffice(office);
    const partyFilter = normalizeParty(party);

    const values = [
      search,
      stateFilter,
      officeFilter,
      partyFilter,
      safeLimit,
      offset
    ];

    const whereSql = `
      WHERE
        ($1 = '' OR (
          COALESCE(full_name, name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(first_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(last_name, '') ILIKE '%' || $1 || '%'
          OR COALESCE(state, state_code, '') ILIKE '%' || $1 || '%'
          OR COALESCE(office, '') ILIKE '%' || $1 || '%'
          OR COALESCE(party, '') ILIKE '%' || $1 || '%'
          OR COALESCE(campaign_committee_name, '') ILIKE '%' || $1 || '%'
        ))
        AND ($2 = '' OR UPPER(COALESCE(state, state_code, '')) = UPPER($2))
        AND ($3 = '' OR COALESCE(office, '') = $3)
        AND ($4 = '' OR (
          COALESCE(party, '') = $4
          OR UPPER(COALESCE(party, '')) = UPPER($4)
        ))
    `;

    const data = await pool.query(
      `
        SELECT *
        FROM candidates
        ${whereSql}
        ORDER BY
          COALESCE(state, state_code, 'ZZZ') ASC,
          COALESCE(office, 'ZZZ') ASC,
          COALESCE(last_name, full_name, name, 'ZZZ') ASC
        LIMIT $5 OFFSET $6
      `,
      values
    );

    const total = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM candidates
        ${whereSql}
      `,
      values.slice(0, 4)
    );

    res.status(200).json({
      total: total.rows[0]?.total || 0,
      page: safePage,
      limit: safeLimit,
      results: data.rows || [],
      _live: true
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidates"
    });
  }
});

/* --------------------------
   DYNAMIC ROUTES LAST
-------------------------- */

router.post("/:id/refresh-profile", requireAuth, async (req, res) => {
  try {
    const result = await enrichCandidateProfile(req.params.id);

    res.status(200).json(
      result || {
        error: "Candidate not found",
        id: req.params.id
      }
    );
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to refresh candidate profile"
    });
  }
});

router.post("/:id/enrich-profile", requireAuth, async (req, res) => {
  try {
    const result = await enrichCandidateProfile(req.params.id);

    res.status(200).json(
      result || {
        error: "Candidate not found",
        id: req.params.id
      }
    );
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to enrich profile"
    });
  }
});

router.post("/:id/manual-profile", requireAuth, async (req, res) => {
  try {
    const result = await updateCandidateProfileManual(req.params.id, req.body || {});
    res.status(200).json(result || { error: "Candidate not found" });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to update manual profile"
    });
  }
});

router.patch("/:id/profile-locks", requireAuth, async (req, res) => {
  try {
    const result = await updateCandidateProfileLocks(req.params.id, req.body || {});
    res.status(200).json(result || { error: "Candidate profile not found" });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to update candidate profile locks"
    });
  }
});

router.patch("/:id/verification", requireAuth, async (req, res) => {
  try {
    const result = await updateCandidateVerification(req.params.id, req.body || {});
    res.status(200).json(result || { error: "Candidate profile not found" });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to update candidate verification"
    });
  }
});

router.get("/:id/contacts", requireAuth, async (req, res) => {
  try {
    await ensureCandidatesTable();

    const value = normalizeText(req.params.id);

    const candidateResult = await pool.query(
      `
        SELECT *
        FROM candidates
        WHERE CAST(id AS TEXT) = $1
           OR COALESCE(external_id, '') = $1
           OR COALESCE(fec_candidate_id, '') = $1
        LIMIT 1
      `,
      [value]
    );

    const candidate = candidateResult.rows[0] || null;

    if (!candidate) {
      return res.status(200).json({
        candidate: null,
        profile: null,
        contacts: [],
        social: {},
        _missing: true
      });
    }

    const profileResult = await pool.query(
      `
        SELECT *
        FROM candidate_profiles
        WHERE candidate_id = $1
        LIMIT 1
      `,
      [candidate.id]
    );

    const profile = profileResult.rows[0] || null;

    res.status(200).json({
      candidate,
      profile,
      contacts: profile ? [profile] : [],
      social: {
        facebook: candidate.facebook_url || null,
        x: candidate.x_url || null,
        instagram: candidate.instagram_url || null,
        youtube: candidate.youtube_url || null,
        linkedin: candidate.linkedin_url || null
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate contacts"
    });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    await ensureCandidatesTable();

    const value = normalizeText(req.params.id);

    const result = await pool.query(
      `
        SELECT *
        FROM candidates
        WHERE CAST(id AS TEXT) = $1
           OR COALESCE(external_id, '') = $1
           OR COALESCE(fec_candidate_id, '') = $1
        LIMIT 1
      `,
      [value]
    );

    if (!result.rows.length) {
      return res.status(200).json({
        id: value,
        external_id: value,
        source: "fallback",
        full_name: "Candidate profile unavailable",
        first_name: "",
        last_name: "",
        state: "",
        office: "",
        district: "",
        party: "",
        incumbent_status: "",
        campaign_committee_id: "",
        campaign_committee_name: "",
        website: "",
        election_year: null,
        status: "unavailable",
        source_updated_at: null,
        last_imported_at: null,
        created_at: null,
        updated_at: null,
        _missing: true,
        message: "Candidate profile was not found in the live database."
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to load candidate"
    });
  }
});

export default router;
