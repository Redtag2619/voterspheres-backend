import pool from "../config/database.js";

const FEC_API_KEY = process.env.FEC_API_KEY;
const FEC_BASE_URL = process.env.FEC_BASE_URL || "https://api.open.fec.gov/v1";
const FEC_CYCLES = (process.env.FEC_CYCLES || "2026,2024")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter(Boolean);

const PER_PAGE = Math.min(Math.max(Number(process.env.FEC_PER_PAGE || 100), 1), 100);
const ACTIVE_ONLY = String(process.env.FEC_ACTIVE_ONLY || "true") === "true";
const DRY_RUN = String(process.env.FEC_DRY_RUN || "false") === "true";

if (!FEC_API_KEY) {
  console.error("Missing FEC_API_KEY in environment");
  process.exit(1);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).replace(/\s+/g, " ").trim();
  return str ? str : null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeOffice(value) {
  const office = clean(value);
  if (!office) return null;

  const map = {
    H: "House",
    S: "Senate",
    P: "President"
  };

  return map[office] || office;
}

function normalizeParty(record) {
  return firstNonEmpty(
    record.party_full,
    record.party,
    record.party_abbreviation
  );
}

function normalizeDistrict(record) {
  const district = firstNonEmpty(record.district, record.district_number);
  if (!district) return "Statewide";
  if (String(district) === "00") return "Statewide";
  return String(district);
}

function normalizeStatus(record) {
  if (record.is_active_candidate === true) return "active";
  if (record.is_active_candidate === false) return "inactive";
  return firstNonEmpty(record.candidate_status, record.status, "active");
}

function normalizeIncumbent(record) {
  const raw = firstNonEmpty(
    record.incumbent_challenge_full,
    record.incumbent_challenge
  );

  if (!raw) return false;

  const value = String(raw).toLowerCase();
  return value.includes("incumbent") || value === "i";
}

function normalizeElectionLabel(record, cycle) {
  return firstNonEmpty(
    record.election_name,
    record.race_name,
    record.office_full && record.state
      ? `${cycle} ${record.state} ${record.office_full}`
      : null,
    record.office && record.state
      ? `${cycle} ${record.state} ${normalizeOffice(record.office)}`
      : null,
    `${cycle} Federal Election`
  );
}

function normalizeCandidate(record, cycle) {
  const fullName = firstNonEmpty(record.name, record.candidate_name, record.full_name);
  const office = firstNonEmpty(record.office_full, normalizeOffice(record.office));
  const state = firstNonEmpty(record.state, record.state_full);
  const stateCode = clean(record.state);
  const district = normalizeDistrict(record);
  const electionType = firstNonEmpty(record.election_type_full, record.election_type, "general");
  const campaignStatus = normalizeStatus(record);
  const slugBase = [
    fullName,
    state || stateCode,
    office,
    cycle,
    record.candidate_id
  ]
    .filter(Boolean)
    .join("-");

  return {
    fec_candidate_id: clean(record.candidate_id),
    full_name: fullName,
    name: fullName,
    slug: slugify(slugBase),
    party: normalizeParty(record),
    office,
    district,
    state,
    state_code: stateCode,
    election: normalizeElectionLabel(record, cycle),
    election_date: null,
    election_year: Number(cycle) || null,
    election_type: electionType,
    campaign_status: campaignStatus,
    website: null,
    incumbent: normalizeIncumbent(record),
    bio: null,
    photo: null,
    photo_url: null,
    contact_email: null,
    press_email: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    postal_code: null,
    facebook_url: null,
    x_url: null,
    instagram_url: null,
    youtube_url: null,
    linkedin_url: null,
    contact_source: "fec_import",
    contact_verified: false,
    last_contact_update: null
  };
}

async function ensureSchema() {
  await pool.query(`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS fec_candidate_id TEXT
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_fec_candidate_id
    ON candidates(fec_candidate_id)
  `);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "VoterSpheres/1.0 (+https://voterspheres.org)",
      Accept: "application/json"
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      `FEC request failed ${response.status}: ${data?.message || text || "Unknown error"}`
    );
  }

  return data;
}

function buildCandidatesUrl({ cycle, page }) {
  const url = new URL(`${FEC_BASE_URL.replace(/\/$/, "")}/candidates/`);
  url.searchParams.set("api_key", FEC_API_KEY);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("sort", "name");
  url.searchParams.append("cycle", String(cycle));

  if (ACTIVE_ONLY) {
    url.searchParams.set("is_active_candidate", "true");
  }

  return url.toString();
}

async function fetchCycleCandidates(cycle) {
  const all = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = buildCandidatesUrl({ cycle, page });
    console.log(`Fetching FEC cycle ${cycle}, page ${page}...`);

    const payload = await fetchJson(url);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const pagination = payload?.pagination || {};

    totalPages = Number(pagination.pages || 1);

    for (const row of results) {
      all.push(normalizeCandidate(row, cycle));
    }

    if (!results.length) break;
    page += 1;
  }

  return all;
}

async function upsertCandidate(candidate) {
  const sql = `
    INSERT INTO candidates (
      fec_candidate_id,
      full_name,
      name,
      slug,
      party,
      office,
      district,
      state,
      state_code,
      election,
      election_date,
      election_year,
      election_type,
      campaign_status,
      website,
      incumbent,
      bio,
      photo,
      photo_url,
      contact_email,
      press_email,
      phone,
      address_line1,
      address_line2,
      city,
      postal_code,
      facebook_url,
      x_url,
      instagram_url,
      youtube_url,
      linkedin_url,
      contact_source,
      contact_verified,
      last_contact_update,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW()
    )
    ON CONFLICT (fec_candidate_id)
    DO UPDATE SET
      full_name = COALESCE(EXCLUDED.full_name, candidates.full_name),
      name = COALESCE(EXCLUDED.name, candidates.name),
      slug = COALESCE(EXCLUDED.slug, candidates.slug),
      party = COALESCE(EXCLUDED.party, candidates.party),
      office = COALESCE(EXCLUDED.office, candidates.office),
      district = COALESCE(EXCLUDED.district, candidates.district),
      state = COALESCE(EXCLUDED.state, candidates.state),
      state_code = COALESCE(EXCLUDED.state_code, candidates.state_code),
      election = COALESCE(EXCLUDED.election, candidates.election),
      election_year = COALESCE(EXCLUDED.election_year, candidates.election_year),
      election_type = COALESCE(EXCLUDED.election_type, candidates.election_type),
      campaign_status = COALESCE(EXCLUDED.campaign_status, candidates.campaign_status),
      incumbent = COALESCE(EXCLUDED.incumbent, candidates.incumbent),
      contact_source = 'fec_import',
      updated_at = NOW()
    RETURNING id, fec_candidate_id, full_name
  `;

  const values = [
    candidate.fec_candidate_id,
    candidate.full_name,
    candidate.name,
    candidate.slug,
    candidate.party,
    candidate.office,
    candidate.district,
    candidate.state,
    candidate.state_code,
    candidate.election,
    candidate.election_date,
    candidate.election_year,
    candidate.election_type,
    candidate.campaign_status,
    candidate.website,
    candidate.incumbent,
    candidate.bio,
    candidate.photo,
    candidate.photo_url,
    candidate.contact_email,
    candidate.press_email,
    candidate.phone,
    candidate.address_line1,
    candidate.address_line2,
    candidate.city,
    candidate.postal_code,
    candidate.facebook_url,
    candidate.x_url,
    candidate.instagram_url,
    candidate.youtube_url,
    candidate.linkedin_url,
    candidate.contact_source,
    candidate.contact_verified,
    candidate.last_contact_update
  ];

  const result = await pool.query(sql, values);
  return result.rows[0];
}

function dedupeByFecId(candidates) {
  const map = new Map();

  for (const candidate of candidates) {
    if (!candidate.fec_candidate_id) continue;

    const existing = map.get(candidate.fec_candidate_id);
    if (!existing) {
      map.set(candidate.fec_candidate_id, candidate);
      continue;
    }

    const existingYear = Number(existing.election_year || 0);
    const currentYear = Number(candidate.election_year || 0);

    if (currentYear >= existingYear) {
      map.set(candidate.fec_candidate_id, candidate);
    }
  }

  return [...map.values()];
}

async function main() {
  console.log("Starting FEC candidate import...");
  console.log(`Cycles: ${FEC_CYCLES.join(", ")}`);
  console.log(`Per page: ${PER_PAGE}`);
  console.log(`Active only: ${ACTIVE_ONLY}`);
  console.log(`Dry run: ${DRY_RUN}`);

  await ensureSchema();

  const imported = [];
  for (const cycle of FEC_CYCLES) {
    const cycleCandidates = await fetchCycleCandidates(cycle);
    console.log(`Fetched ${cycleCandidates.length} candidate rows for cycle ${cycle}`);
    imported.push(...cycleCandidates);
  }

  const deduped = dedupeByFecId(imported);
  console.log(`Deduped to ${deduped.length} unique FEC candidates`);

  if (DRY_RUN) {
    console.log("Dry run complete. Sample:");
    console.log(JSON.stringify(deduped.slice(0, 10), null, 2));
    process.exit(0);
  }

  let inserted = 0;
  let failed = 0;

  for (const candidate of deduped) {
    try {
      await upsertCandidate(candidate);
      inserted += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `Failed upserting ${candidate.fec_candidate_id || candidate.full_name}:`,
        error.message
      );
    }
  }

  console.log("FEC candidate import complete.");
  console.log(`Imported/updated: ${inserted}`);
  console.log(`Failed: ${failed}`);

  await pool.end();
}

main().catch(async (error) => {
  console.error("Fatal import error:", error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
