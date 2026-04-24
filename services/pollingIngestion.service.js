import axios from "axios"; 
import { pool } from "../db/pool.js";

function text(value = "") {
  return String(value || "").trim(); 
}

function stateName(value = "") {
  const raw = text(value).toUpperCase();

  const map = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
  };

  return map[raw] || value || "";
}

function buildSubject(row) {
  const candidate = text(row.candidate || row.full_name);
  if (candidate) return candidate.replaceAll(",", "");
  return [row.office, row.state].filter(Boolean).join(" ");
}

function parseAnswers(item) {
  if (Array.isArray(item?.answers)) return item.answers;
  if (Array.isArray(item?.results)) return item.results;
  return [];
}

function externalId(item, fallback) {
  return text(item?.id || item?.poll_id || item?.url || fallback);
}

function intOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function ensurePollingSignalsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS polling_signals (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'votehub_polling',
      external_id TEXT,
      poll_type TEXT,
      pollster TEXT,
      subject TEXT,
      state TEXT,
      office TEXT,
      candidate_name TEXT,
      candidate_id TEXT,
      start_date DATE,
      end_date DATE,
      sample_size INTEGER,
      population TEXT,
      url TEXT,
      answers JSONB DEFAULT '[]'::jsonb,
      raw_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_polling_signals_source_external
    ON polling_signals (COALESCE(source, ''), COALESCE(external_id, ''))
    WHERE external_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_polling_signals_end_date
    ON polling_signals (end_date DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_polling_signals_state
    ON polling_signals (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_polling_signals_candidate_id
    ON polling_signals (candidate_id)
  `);
}

export async function getPollingIngestionTargets(limit = 8) {
  const { rows } = await pool.query(
    `
      SELECT
        external_id AS candidate_id,
        full_name AS candidate,
        state,
        office,
        party
      FROM candidates
      WHERE state IS NOT NULL
        AND state <> ''
        AND office IS NOT NULL
        AND office <> ''
        AND office IN ('Senate', 'House', 'Governor', 'President')
      ORDER BY last_imported_at DESC NULLS LAST, full_name ASC
      LIMIT $1
    `,
    [limit]
  );

  return (rows || []).map((row) => ({
    candidate_id: row.candidate_id,
    candidate: row.candidate,
    state: stateName(row.state),
    office: row.office,
    party: row.party || ""
  }));
}

export async function fetchVoteHubPolls({ subject, fromDate }) {
  const endpoint =
    process.env.VOTEHUB_POLLING_API_URL ||
    "https://api.votehub.com/polls";

  try {
    const response = await axios.get(endpoint, {
      params: {
        subject,
        from_date: fromDate
      },
      timeout: 30000
    });

    if (Array.isArray(response?.data?.polls)) return response.data.polls;
    if (Array.isArray(response?.data?.results)) return response.data.results;
    if (Array.isArray(response?.data)) return response.data;

    return [];
  } catch (error) {
    console.warn("Polling fetch failed:", {
      subject,
      message: error.message
    });

    return [];
  }
}

export async function upsertPollingSignal(input = {}) {
  await ensurePollingSignalsTable();

  const source = text(input.source || "votehub_polling");
  const id = text(input.external_id || "");
  const fallbackId = `${source}:${input.subject || ""}:${input.candidate_id || ""}:${input.end_date || ""}`;
  const finalExternalId = id || fallbackId;

  const params = [
    source,
    finalExternalId,
    text(input.poll_type),
    text(input.pollster),
    text(input.subject),
    text(input.state),
    text(input.office),
    text(input.candidate_name),
    text(input.candidate_id),
    input.start_date || null,
    input.end_date || null,
    intOrNull(input.sample_size),
    text(input.population),
    text(input.url),
    JSON.stringify(input.answers || []),
    JSON.stringify(input.raw_payload || {})
  ];

  const existing = await pool.query(
    `
      SELECT id
      FROM polling_signals
      WHERE COALESCE(source, '') = COALESCE($1, '')
        AND COALESCE(external_id, '') = COALESCE($2, '')
      LIMIT 1
    `,
    [source, finalExternalId]
  );

  if (existing.rows.length) {
    await pool.query(
      `
        UPDATE polling_signals
        SET
          poll_type = $3,
          pollster = $4,
          subject = $5,
          state = $6,
          office = $7,
          candidate_name = $8,
          candidate_id = $9,
          start_date = $10,
          end_date = $11,
          sample_size = $12,
          population = $13,
          url = $14,
          answers = $15::jsonb,
          raw_payload = $16::jsonb,
          updated_at = NOW()
        WHERE COALESCE(source, '') = COALESCE($1, '')
          AND COALESCE(external_id, '') = COALESCE($2, '')
      `,
      params
    );

    return "updated";
  }

  await pool.query(
    `
      INSERT INTO polling_signals (
        source,
        external_id,
        poll_type,
        pollster,
        subject,
        state,
        office,
        candidate_name,
        candidate_id,
        start_date,
        end_date,
        sample_size,
        population,
        url,
        answers,
        raw_payload,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,NOW(),NOW()
      )
    `,
    params
  );

  return "inserted";
}

export async function ingestPollingSignals(limit = 8) {
  await ensurePollingSignalsTable();

  const targets = await getPollingIngestionTargets(limit);
  const fromDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let seen = 0;
  let inserted = 0;
  let updated = 0;

  for (const row of targets) {
    const subject = buildSubject(row);
    if (!subject) continue;

    const polls = await fetchVoteHubPolls({ subject, fromDate });

    for (const item of polls) {
      seen += 1;

      const result = await upsertPollingSignal({
        external_id: externalId(item, `${subject}:${item?.end_date || item?.date || ""}`),
        poll_type: item?.poll_type || item?.type || "",
        pollster: item?.pollster || item?.sponsor || "",
        subject: item?.subject || subject,
        state: row.state,
        office: row.office,
        candidate_name: row.candidate,
        candidate_id: row.candidate_id,
        start_date: item?.start_date || item?.field_start || null,
        end_date: item?.end_date || item?.field_end || item?.date || null,
        sample_size: item?.sample_size || item?.n || null,
        population: item?.population || "",
        url: item?.url || "",
        answers: parseAnswers(item),
        raw_payload: item
      });

      if (result === "inserted") inserted += 1;
      if (result === "updated") updated += 1;
    }
  }

  return {
    success: true,
    source: "votehub_polling",
    targets: targets.length,
    seen,
    inserted,
    updated
  };
}

export async function getRecentPollingSignals(limit = 10) {
  await ensurePollingSignalsTable();

  const { rows } = await pool.query(
    `
      SELECT
        id,
        source,
        external_id,
        poll_type,
        pollster,
        subject,
        state,
        office,
        candidate_name,
        candidate_id,
        start_date,
        end_date,
        sample_size,
        population,
        url,
        answers,
        raw_payload,
        created_at,
        updated_at
      FROM polling_signals
      ORDER BY COALESCE(end_date::timestamp, updated_at, created_at) DESC, id DESC
      LIMIT $1
    `,
    [limit]
  );

  return rows || [];
}

/*
  Compatibility aliases.
  These prevent Render from crashing if another file imports older names.
*/
export async function ingestPolling(limit = 8) {
  return ingestPollingSignals(limit);
}

export async function getRecentPolling(limit = 10) {
  return getRecentPollingSignals(limit);
}

export default {
  ensurePollingSignalsTable,
  getPollingIngestionTargets,
  fetchVoteHubPolls,
  upsertPollingSignal,
  ingestPollingSignals,
  getRecentPollingSignals,
  ingestPolling,
  getRecentPolling
};
