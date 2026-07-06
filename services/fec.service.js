import pool from "../config/database.js";

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).replace(/\s+/g, " ").trim();
  return next || null;
}

function normalizeOffice(value) {
  const v = String(value || "").toLowerCase().trim();
  if (v === "h" || v === "house") return "House";
  if (v === "s" || v === "senate") return "Senate";
  if (v === "p" || v === "president" || v === "presidential") return "President";
  return value || "Unknown";
}

function normalizeParty(value) {
  return String(value || "").trim() || "N/A";
}

function normalizeName(row) {
  return row.name || row.candidate_name || row.candidate || "Unknown Candidate";
}

function normalizeReceipts(row) {
  return toNumber(row.receipts ?? row.total_receipts ?? row.receipts_total ?? 0);
}

function normalizeCashOnHand(row) {
  return toNumber(
    row.cash_on_hand ??
      row.cash_on_hand_end_period ??
      row.total_cash_on_hand ??
      0
  );
}

function normalizeState(row) {
  return row.state || row.candidate_state || "N/A";
}

function normalizeDistrict(row) {
  const district = row.district ?? row.seat_number ?? null;
  if (district === undefined || district === null || district === "") return "Statewide";
  if (String(district) === "00") return "Statewide";
  return String(district);
}

function normalizeCoverageEndDate(row) {
  return row.coverage_end_date || row.coverage_to_date || row.report_end_date || null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function normalizeIncumbent(row) {
  const raw = String(row.incumbent_challenge_full || row.incumbent_challenge || "")
    .toLowerCase()
    .trim();

  return raw.includes("incumbent") || raw === "i";
}

function buildElectionLabel(row, cycle) {
  const state = normalizeState(row);
  const office = normalizeOffice(row.office_full || row.office || row.office_type);
  return `${cycle} ${state} ${office}`;
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getFecApiConfig() {
  return {
    apiKey: getEnv("FEC_API_KEY"),
    baseUrl: getEnv("FEC_API_BASE_URL", "https://api.open.fec.gov/v1"),
    defaultCycle: Number(getEnv("FEC_DEFAULT_CYCLE", "2026")),
    perPage: Math.min(Number(getEnv("FEC_SYNC_PER_PAGE", "100")), 100),
    maxPages: Math.max(Number(getEnv("FEC_SYNC_MAX_PAGES", "10")), 1),
    pacSyncLimit: Math.max(Number(getEnv("FEC_PAC_SYNC_LIMIT", "75")), 0),
    pacPerCandidateLimit: Math.max(Number(getEnv("FEC_PAC_PER_CANDIDATE_LIMIT", "25")), 1),
  };
}

async function fecGet(path, params = {}) {
  const { apiKey, baseUrl } = getFecApiConfig();

  if (!apiKey) {
    throw createHttpError("Missing FEC_API_KEY", 500);
  }

  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
  url.searchParams.set("api_key", apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "VoterSpheres/1.0",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw createHttpError(
      `FEC API request failed (${response.status}): ${text || response.statusText}`,
      502
    );
  }

  return response.json();
}

function buildCandidateRecord(row, cycle) {
  const fullName = normalizeName(row);
  const office = normalizeOffice(row.office_full || row.office || row.office_type);
  const stateCode = row.state || row.candidate_state || null;
  const state = normalizeState(row);
  const district = normalizeDistrict(row);
  const fecCandidateId = String(row.candidate_id || row.fec_candidate_id || "").trim();

  return {
    fec_candidate_id: fecCandidateId || null,
    full_name: fullName,
    name: fullName,
    slug: slugify(`${fullName}-${stateCode || state}-${office}-${cycle}-${fecCandidateId}`),
    party: normalizeParty(row.party_full || row.party),
    office,
    district,
    state,
    state_code: stateCode,
    election: buildElectionLabel(row, cycle),
    election_date: null,
    election_year: Number(cycle),
    election_type: "general",
    campaign_status: "active",
    website: null,
    incumbent: normalizeIncumbent(row),
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
    contact_source: "fec_sync",
    contact_verified: false,
    last_contact_update: null,
  };
}

function normalizePacContribution(row = {}) {
  const amount = toNumber(
    row.contribution_receipt_amount ??
      row.amount ??
      row.receipt_amount ??
      row.transaction_amount ??
      0
  );

  const committeeId =
    clean(row.contributor_committee_id) ||
    clean(row.committee_id) ||
    clean(row.contributor_id) ||
    null;

  const committeeName =
    clean(row.contributor_name) ||
    clean(row.committee_name) ||
    clean(row.name) ||
    "Unknown PAC / Committee";

  const committeeType =
    clean(row.contributor_type) ||
    clean(row.contributor_type_desc) ||
    clean(row.entity_type_desc) ||
    clean(row.committee_type) ||
    "Committee";

  const committeeParty =
    clean(row.contributor_committee_party) ||
    clean(row.committee_party) ||
    clean(row.party) ||
    "N/A";

  return {
    committee_id: committeeId || slugify(committeeName),
    committee_name: committeeName,
    committee_type: committeeType,
    committee_party: committeeParty,
    amount,
    city: clean(row.contributor_city) || clean(row.city) || "",
    state: clean(row.contributor_state) || clean(row.state) || "",
    fec_url: committeeId ? `https://www.fec.gov/data/committee/${committeeId}/` : "",
  };
}

function isPacContribution(row = {}) {
  const contributorCommitteeId = clean(row.contributor_committee_id);
  const entityType = String(row.entity_type_desc || row.contributor_type || row.contributor_type_desc || "")
    .toLowerCase();

  return Boolean(
    contributorCommitteeId ||
      entityType.includes("committee") ||
      entityType.includes("pac") ||
      entityType.includes("organization") ||
      entityType.includes("party")
  );
}

function aggregatePacContributions(rows = [], limit = 25) {
  const map = new Map();

  for (const raw of rows) {
    if (!isPacContribution(raw)) continue;

    const pac = normalizePacContribution(raw);
    if (!pac.committee_name || pac.committee_name === "Unknown PAC / Committee") continue;
    if (pac.amount <= 0) continue;

    const key = pac.committee_id || pac.committee_name;

    if (!map.has(key)) {
      map.set(key, pac);
    } else {
      const current = map.get(key);
      current.amount += pac.amount;
      map.set(key, current);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

async function fetchPacContributionsForCandidate({ candidateId, cycle, limit = 25 }) {
  if (!candidateId) return [];

  try {
    const payload = await fecGet("/schedules/schedule_a/", {
      candidate_id: candidateId,
      two_year_transaction_period: cycle,
      per_page: 100,
      sort: "-contribution_receipt_amount",
      sort_hide_null: "false",
    });

    const rows = Array.isArray(payload?.results) ? payload.results : [];
    return aggregatePacContributions(rows, limit);
  } catch (error) {
    console.warn(`[FEC] PAC contribution sync skipped for ${candidateId}:`, error.message);
    return [];
  }
}

export async function ensureFundraisingLiveTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fundraising_live (
      candidate_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT,
      office TEXT,
      district TEXT,
      party TEXT,
      receipts NUMERIC NOT NULL DEFAULT 0,
      cash_on_hand NUMERIC NOT NULL DEFAULT 0,
      coverage_end_date DATE,
      election_year INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'FEC',
      source_updated_at TIMESTAMP,
      source_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_live_receipts
    ON fundraising_live (receipts DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_live_cash_on_hand
    ON fundraising_live (cash_on_hand DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_live_state
    ON fundraising_live (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_live_office
    ON fundraising_live (office)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_live_election_year
    ON fundraising_live (election_year)
  `);
}

export async function ensureCandidatesSyncSchema() {
  await pool.query(`
    ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS fec_candidate_id TEXT,
    ADD COLUMN IF NOT EXISTS full_name TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS slug TEXT,
    ADD COLUMN IF NOT EXISTS party TEXT,
    ADD COLUMN IF NOT EXISTS office TEXT,
    ADD COLUMN IF NOT EXISTS district TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS state_code TEXT,
    ADD COLUMN IF NOT EXISTS election TEXT,
    ADD COLUMN IF NOT EXISTS election_date DATE,
    ADD COLUMN IF NOT EXISTS election_year INTEGER,
    ADD COLUMN IF NOT EXISTS election_type TEXT,
    ADD COLUMN IF NOT EXISTS campaign_status TEXT,
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS incumbent BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS photo TEXT,
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    ADD COLUMN IF NOT EXISTS press_email TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS address_line1 TEXT,
    ADD COLUMN IF NOT EXISTS address_line2 TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS postal_code TEXT,
    ADD COLUMN IF NOT EXISTS facebook_url TEXT,
    ADD COLUMN IF NOT EXISTS x_url TEXT,
    ADD COLUMN IF NOT EXISTS instagram_url TEXT,
    ADD COLUMN IF NOT EXISTS youtube_url TEXT,
    ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
    ADD COLUMN IF NOT EXISTS contact_source TEXT,
    ADD COLUMN IF NOT EXISTS contact_verified BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS last_contact_update TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_fec_candidate_id
    ON candidates (fec_candidate_id)
    WHERE fec_candidate_id IS NOT NULL
  `);
}

export async function ensureCandidateProfilesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE candidate_profiles
      ADD COLUMN IF NOT EXISTS campaign_website TEXT,
      ADD COLUMN IF NOT EXISTS official_website TEXT,
      ADD COLUMN IF NOT EXISTS office_address TEXT,
      ADD COLUMN IF NOT EXISTS campaign_address TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS chief_of_staff_name TEXT,
      ADD COLUMN IF NOT EXISTS campaign_manager_name TEXT,
      ADD COLUMN IF NOT EXISTS finance_director_name TEXT,
      ADD COLUMN IF NOT EXISTS political_director_name TEXT,
      ADD COLUMN IF NOT EXISTS press_contact_name TEXT,
      ADD COLUMN IF NOT EXISTS press_contact_email TEXT,
      ADD COLUMN IF NOT EXISTS facebook_url TEXT,
      ADD COLUMN IF NOT EXISTS x_url TEXT,
      ADD COLUMN IF NOT EXISTS instagram_url TEXT,
      ADD COLUMN IF NOT EXISTS youtube_url TEXT,
      ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
      ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
      ADD COLUMN IF NOT EXISTS contact_source_url TEXT,
      ADD COLUMN IF NOT EXISTS source_label TEXT DEFAULT 'campaign_site_live',
      ADD COLUMN IF NOT EXISTS admin_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS contact_confidence NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scraped_pages JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS verified_by TEXT,
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS internal_notes TEXT,
      ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP
  `);
}

export async function fetchCandidateTotalsPage({ cycle, page, perPage }) {
  return fecGet("/candidates/totals/", {
    cycle,
    page,
    per_page: perPage,
    sort: "-receipts",
    sort_hide_null: "false",
  });
}

export async function fetchAllCandidateTotals({ cycle }) {
  const { perPage, maxPages } = getFecApiConfig();
  const allRows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchCandidateTotalsPage({ cycle, page, perPage });
    const results = Array.isArray(payload?.results) ? payload.results : [];
    allRows.push(...results);

    const totalPages = Number(payload?.pagination?.pages || 0);
    if (!results.length) break;
    if (totalPages && page >= totalPages) break;
  }

  return allRows;
}

export async function normalizeFundraisingRows(rows, cycle, options = {}) {
  const { pacSyncLimit, pacPerCandidateLimit } = getFecApiConfig();
  const effectivePacSyncLimit = Math.max(
    0,
    Number(options.pacSyncLimit ?? pacSyncLimit)
  );

  const normalized = [];

  for (const row of rows) {
    const candidateId = row.candidate_id || row.fec_candidate_id || null;
    if (!candidateId) continue;

    const pacContributions =
      normalized.length < effectivePacSyncLimit
        ? await fetchPacContributionsForCandidate({
            candidateId,
            cycle,
            limit: pacPerCandidateLimit,
          })
        : [];

    const payload = {
      ...row,
      pac_contributions: pacContributions,
      pac_contributions_total: pacContributions.reduce(
        (sum, pac) => sum + toNumber(pac.amount),
        0
      ),
      last_imported: new Date().toISOString(),
      cycle: Number(cycle),
    };

    normalized.push({
      candidate_id: String(candidateId),
      name: normalizeName(row),
      state: normalizeState(row),
      office: normalizeOffice(row.office_full || row.office || row.office_type),
      district: normalizeDistrict(row),
      party: normalizeParty(row.party_full || row.party),
      receipts: normalizeReceipts(row),
      cash_on_hand: normalizeCashOnHand(row),
      coverage_end_date: normalizeCoverageEndDate(row),
      election_year: Number(cycle),
      source: "FEC",
      source_updated_at: new Date().toISOString(),
      source_payload: payload,
    });
  }

  return normalized.sort((a, b) => b.receipts - a.receipts);
}

export async function replaceFundraisingLive(rows, cycle) {
  await ensureFundraisingLiveTable();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM fundraising_live WHERE election_year = $1`, [
      cycle,
    ]);

    for (const row of rows) {
      await client.query(
        `
          INSERT INTO fundraising_live (
            candidate_id,
            name,
            state,
            office,
            district,
            party,
            receipts,
            cash_on_hand,
            coverage_end_date,
            election_year,
            source,
            source_updated_at,
            source_payload,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NOW(),NOW()
          )
          ON CONFLICT (candidate_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            state = EXCLUDED.state,
            office = EXCLUDED.office,
            district = EXCLUDED.district,
            party = EXCLUDED.party,
            receipts = EXCLUDED.receipts,
            cash_on_hand = EXCLUDED.cash_on_hand,
            coverage_end_date = EXCLUDED.coverage_end_date,
            election_year = EXCLUDED.election_year,
            source = EXCLUDED.source,
            source_updated_at = EXCLUDED.source_updated_at,
            source_payload = EXCLUDED.source_payload,
            updated_at = NOW()
        `,
        [
          row.candidate_id,
          row.name,
          row.state,
          row.office,
          row.district,
          row.party,
          row.receipts,
          row.cash_on_hand,
          row.coverage_end_date,
          row.election_year,
          row.source,
          row.source_updated_at,
          JSON.stringify(row.source_payload || {}),
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertCandidatesFromFec(rows, cycle) {
  await ensureCandidatesSyncSchema();

  let stored = 0;

  for (const row of rows) {
    const candidate = buildCandidateRecord(row.source_payload || row, cycle);
    if (!candidate.fec_candidate_id) continue;

    await pool.query(
      `
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
          updated_at,
          created_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW(),NOW()
        )
        ON CONFLICT (fec_candidate_id)
        WHERE fec_candidate_id IS NOT NULL
        DO UPDATE SET
          full_name = EXCLUDED.full_name,
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          party = EXCLUDED.party,
          office = EXCLUDED.office,
          district = EXCLUDED.district,
          state = EXCLUDED.state,
          state_code = EXCLUDED.state_code,
          election = EXCLUDED.election,
          election_year = EXCLUDED.election_year,
          election_type = EXCLUDED.election_type,
          campaign_status = EXCLUDED.campaign_status,
          incumbent = EXCLUDED.incumbent,
          contact_source = EXCLUDED.contact_source,
          updated_at = NOW()
      `,
      [
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
        candidate.last_contact_update,
      ]
    );

    stored += 1;
  }

  return stored;
}

export async function syncFecCommitteeContactsForCandidates(options = {}) {
  await ensureCandidateProfilesSchema();

  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 5000);
  const offset = Math.max(Number(options.offset || 0), 0);
  const cycle = Number(options.cycle || getFecApiConfig().defaultCycle);

  const result = await pool.query(
    `
      SELECT
        c.id,
        c.fec_candidate_id,
        c.full_name,
        c.name,
        c.election_year
      FROM candidates c
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      WHERE c.fec_candidate_id IS NOT NULL
        AND (
          cp.candidate_id IS NULL
          OR COALESCE(cp.email, c.contact_email, '') = ''
          OR COALESCE(cp.phone, c.phone, '') = ''
          OR COALESCE(cp.campaign_website, c.website, '') = ''
        )
      ORDER BY c.id ASC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  return {
    ok: true,
    cycle,
    checked: result.rows.length,
    updated: 0,
    missed: result.rows.length,
    failures: [],
    offset,
    limit,
    message: "Candidate contact sync placeholder completed. Fundraising and PAC sync are active.",
  };
}

export async function syncFundraisingFromFec({
  cycle,
  syncContacts = true,
  contactLimit = 500,
  contactOffset = 0,
  pacSyncLimit,
} = {}) {
  const { defaultCycle } = getFecApiConfig();
  const targetCycle = Number(cycle || defaultCycle);

  const rawRows = await fetchAllCandidateTotals({ cycle: targetCycle });
  const normalizedRows = await normalizeFundraisingRows(rawRows, targetCycle, {
    pacSyncLimit,
  });

  await replaceFundraisingLive(normalizedRows, targetCycle);

  const candidateStored = await upsertCandidatesFromFec(normalizedRows, targetCycle);

  const contactResult = syncContacts
    ? await syncFecCommitteeContactsForCandidates({
        cycle: targetCycle,
        limit: contactLimit,
        offset: contactOffset,
      })
    : null;

  return {
    ok: true,
    cycle: targetCycle,
    fetched: rawRows.length,
    fundraising_stored: normalizedRows.length,
    candidates_stored: candidateStored,
    pac_synced_candidates: normalizedRows.filter(
      (row) => Array.isArray(row.source_payload?.pac_contributions)
        && row.source_payload.pac_contributions.length
    ).length,
    contact_sync: contactResult,
  };
}
