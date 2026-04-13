import { pool } from "../db/pool.js";

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  };
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
  return (
    row.name ||
    row.candidate_name ||
    row.candidate ||
    "Unknown Candidate"
  );
}

function normalizeReceipts(row) {
  return toNumber(
    row.receipts ??
      row.total_receipts ??
      row.receipts_total ??
      0
  );
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
  return district === undefined ? null : district;
}

function normalizeCoverageEndDate(row) {
  return (
    row.coverage_end_date ||
    row.coverage_to_date ||
    row.report_end_date ||
    null
  );
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
      "User-Agent": "VoterSpheres/1.0"
    }
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
      source_payload JSONB,
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

export async function fetchCandidateTotalsPage({ cycle, page, perPage }) {
  const payload = await fecGet("/candidates/totals/", {
    cycle,
    page,
    per_page: perPage,
    sort: "-receipts",
    sort_hide_null: "false"
  });

  return payload;
}

export async function fetchAllCandidateTotals({ cycle }) {
  const { perPage, maxPages } = getFecApiConfig();
  const allRows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchCandidateTotalsPage({
      cycle,
      page,
      perPage
    });

    const results = Array.isArray(payload?.results) ? payload.results : [];
    allRows.push(...results);

    const totalPages = Number(payload?.pagination?.pages || 0);

    if (!results.length) break;
    if (totalPages && page >= totalPages) break;
  }

  return allRows;
}

export function normalizeFundraisingRows(rows, cycle) {
  return rows
    .map((row) => {
      const candidateId = row.candidate_id || row.fec_candidate_id || null;
      if (!candidateId) return null;

      return {
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
        source_payload: row
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.receipts - a.receipts);
}

export async function replaceFundraisingLive(rows, cycle) {
  await ensureFundraisingLiveTable();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM fundraising_live
        WHERE election_year = $1
      `,
      [cycle]
    );

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
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
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
          JSON.stringify(row.source_payload)
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

export async function syncFundraisingFromFec({ cycle } = {}) {
  const { defaultCycle } = getFecApiConfig();
  const targetCycle = Number(cycle || defaultCycle);

  const rawRows = await fetchAllCandidateTotals({ cycle: targetCycle });
  const normalizedRows = normalizeFundraisingRows(rawRows, targetCycle);

  await replaceFundraisingLive(normalizedRows, targetCycle);

  return {
    ok: true,
    cycle: targetCycle,
    fetched: rawRows.length,
    stored: normalizedRows.length
  };
}
