
import crypto from "node:crypto";
import { pool } from "../db/pool.js";

const DEFAULT_TIMEOUT_MS =
  Number(process.env.POLLING_FREE_SOURCE_TIMEOUT_MS || 15000);

const DEFAULT_LOOKBACK_DAYS =
  Number(process.env.POLLING_LOOKBACK_DAYS || 730);

const DEFAULT_RETENTION_DAYS =
  Number(process.env.POLLING_RETENTION_DAYS || 3650);

const DEFAULT_SOURCE_DELAY_MS =
  Number(process.env.POLLING_SOURCE_DELAY_MS || 250);

const clean = (value = "") => String(value ?? "").trim();

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).replace(/[$,%]/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toInteger = (value, fallback = null) => {
  const parsed = toNumber(value, fallback);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
};

const normalizeState = (value = "") => {
  const next = clean(value).toUpperCase();
  if (!next || next === "US" || next === "NATIONAL") return next || "US";
  return next.slice(0, 2);
};

const normalizeOffice = (value = "") => {
  const next = clean(value).toLowerCase();
  if (!next) return "Unknown";
  if (next.includes("president")) return "President";
  if (next.includes("senate")) return "Senate";
  if (next.includes("house")) return "House";
  if (next.includes("governor")) return "Governor";
  if (next.includes("generic")) return "Generic Ballot";
  if (next.includes("approval")) return "Approval";
  return clean(value);
};

const normalizeDate = (value) => {
  if (!value) return null;
  const raw = clean(value);
  if (!raw) return null;

  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  const year = Number(match[3]) < 100
    ? 2000 + Number(match[3])
    : Number(match[3]);

  const parsed = new Date(Date.UTC(
    year,
    Number(match[1]) - 1,
    Number(match[2])
  ));

  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : null;
};

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : null;
};

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function lowerKeyObject(row = {}) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      clean(key).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value,
    ])
  );
}

function first(row, names = []) {
  for (const name of names) {
    const key = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

function calculateFreshnessScore(fieldEnd, publishedAt) {
  const raw = publishedAt || fieldEnd;
  if (!raw) return 35;

  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return 35;

  const days = Math.max(0, (Date.now() - timestamp) / 86400000);

  if (days <= 3) return 100;
  if (days <= 7) return 92;
  if (days <= 14) return 84;
  if (days <= 30) return 72;
  if (days <= 90) return 58;
  if (days <= 365) return 44;
  return 28;
}

function calculateConfidence({
  sampleSize,
  marginOfError,
  population,
  source,
  isEstimate,
}) {
  if (isEstimate) return 58;

  let score = 65;

  if (sampleSize >= 1500) score += 15;
  else if (sampleSize >= 1000) score += 12;
  else if (sampleSize >= 600) score += 8;
  else if (sampleSize >= 300) score += 4;

  if (marginOfError !== null && marginOfError !== undefined) {
    if (marginOfError <= 2.5) score += 10;
    else if (marginOfError <= 3.5) score += 7;
    else if (marginOfError <= 5) score += 3;
  }

  const pop = clean(population).toLowerCase();
  if (pop === "lv") score += 6;
  else if (pop === "rv") score += 4;
  else if (pop === "a") score += 1;

  if (/fivethirtyeight|538/i.test(source)) score += 3;

  return Math.max(25, Math.min(98, score));
}

function parseCsv(text = "") {
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(current);
      current = "";

      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      continue;
    }

    current += character;
  }

  row.push(current);
  if (row.some((value) => clean(value))) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map((header) =>
    clean(header).toLowerCase().replace(/[^a-z0-9]+/g, "_")
  );

  return rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""])
    )
  );
}

async function fetchText(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 2,
  headers = {},
} = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/csv,application/json,text/plain,*/*",
          "User-Agent":
            process.env.POLLING_USER_AGENT ||
            "VoterSpheres/1.0 contact@voterspheres.org",
          ...headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Polling source returned HTTP ${response.status}: ${response.statusText}`
        );
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function defaultSources() {
  if (String(process.env.POLLING_ENABLE_538_ARCHIVE || "true").toLowerCase() === "false") {
    return [];
  }

  return [
    {
      id: "538-president-general",
      name: "FiveThirtyEight Presidential General Polls",
      format: "csv",
      race_type: "President",
      url:
        "https://projects.fivethirtyeight.com/polls-page/data/president_polls.csv",
      historical_url:
        "https://projects.fivethirtyeight.com/polls-page/data/president_polls_historical.csv",
      enabled: true,
    },
    {
      id: "538-senate",
      name: "FiveThirtyEight Senate Polls",
      format: "csv",
      race_type: "Senate",
      url:
        "https://projects.fivethirtyeight.com/polls-page/data/senate_polls.csv",
      historical_url:
        "https://projects.fivethirtyeight.com/polls-page/data/senate_polls_historical.csv",
      enabled: true,
    },
    {
      id: "538-house",
      name: "FiveThirtyEight House Polls",
      format: "csv",
      race_type: "House",
      url:
        "https://projects.fivethirtyeight.com/polls-page/data/house_polls.csv",
      historical_url:
        "https://projects.fivethirtyeight.com/polls-page/data/house_polls_historical.csv",
      enabled: true,
    },
    {
      id: "538-governor",
      name: "FiveThirtyEight Governor Polls",
      format: "csv",
      race_type: "Governor",
      url:
        "https://projects.fivethirtyeight.com/polls-page/data/governor_polls.csv",
      historical_url:
        "https://projects.fivethirtyeight.com/polls-page/data/governor_polls_historical.csv",
      enabled: true,
    },
    {
      id: "538-generic-ballot",
      name: "FiveThirtyEight Generic Ballot Polls",
      format: "csv",
      race_type: "Generic Ballot",
      url:
        "https://projects.fivethirtyeight.com/polls-page/data/generic_ballot_polls.csv",
      historical_url:
        "https://projects.fivethirtyeight.com/polls-page/data/generic_ballot_polls_historical.csv",
      enabled: true,
    },
  ];
}

function configuredSources() {
  const raw = clean(process.env.POLLING_FREE_SOURCES_JSON);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((source) => source?.url)
      : [];
  } catch (error) {
    console.warn("[PollingIntelligence] POLLING_FREE_SOURCES_JSON is invalid:", error.message);
    return [];
  }
}

export function getPollingSourceRegistry({
  includeHistorical = false,
} = {}) {
  const combined = [...defaultSources(), ...configuredSources()];

  const registry = [];

  for (const source of combined) {
    if (source.enabled === false) continue;

    registry.push({
      ...source,
      id: clean(source.id) || `source-${registry.length + 1}`,
      name: clean(source.name) || clean(source.id) || "Public polling source",
      format: clean(source.format || "csv").toLowerCase(),
      historical: false,
      record_type: source.record_type || "measured_poll",
    });

    if (includeHistorical && source.historical_url) {
      registry.push({
        ...source,
        id: `${clean(source.id)}-historical`,
        name: `${clean(source.name)} Historical`,
        url: source.historical_url,
        format: clean(source.format || "csv").toLowerCase(),
        historical: true,
        record_type: "historical_poll",
      });
    }
  }

  return registry;
}

export async function ensurePollingIntelligenceSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS polling_results (
      id BIGSERIAL PRIMARY KEY
    )
  `);

  await pool.query(`
    ALTER TABLE polling_results
      ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
      ADD COLUMN IF NOT EXISTS poll_id TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS source_url TEXT,
      ADD COLUMN IF NOT EXISTS source_dataset TEXT,
      ADD COLUMN IF NOT EXISTS pollster TEXT,
      ADD COLUMN IF NOT EXISTS sponsor TEXT,
      ADD COLUMN IF NOT EXISTS state TEXT,
      ADD COLUMN IF NOT EXISTS district TEXT,
      ADD COLUMN IF NOT EXISTS office TEXT,
      ADD COLUMN IF NOT EXISTS race_name TEXT,
      ADD COLUMN IF NOT EXISTS candidate_name TEXT,
      ADD COLUMN IF NOT EXISTS party TEXT,
      ADD COLUMN IF NOT EXISTS answer TEXT,
      ADD COLUMN IF NOT EXISTS pct NUMERIC,
      ADD COLUMN IF NOT EXISTS field_start DATE,
      ADD COLUMN IF NOT EXISTS field_end DATE,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sample_size INTEGER,
      ADD COLUMN IF NOT EXISTS population TEXT,
      ADD COLUMN IF NOT EXISTS methodology TEXT,
      ADD COLUMN IF NOT EXISTS mode TEXT,
      ADD COLUMN IF NOT EXISTS margin_of_error NUMERIC,
      ADD COLUMN IF NOT EXISTS cycle INTEGER,
      ADD COLUMN IF NOT EXISTS election_date DATE,
      ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'measured_poll',
      ADD COLUMN IF NOT EXISTS is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS confidence_score NUMERIC NOT NULL DEFAULT 75,
      ADD COLUMN IF NOT EXISTS freshness_score NUMERIC NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_polling_results_dedupe_key
      ON polling_results (dedupe_key)
      WHERE dedupe_key IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_polling_results_state
      ON polling_results (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_polling_results_field_end
      ON polling_results (field_end DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS polling_ingestion_runs (
      id BIGSERIAL PRIMARY KEY,
      run_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      source_count INTEGER NOT NULL DEFAULT 0,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      normalized_count INTEGER NOT NULL DEFAULT 0,
      stored_count INTEGER NOT NULL DEFAULT 0,
      estimate_count INTEGER NOT NULL DEFAULT 0,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
}

function normalizePublicPollRow(rawRow, source) {
  const row = lowerKeyObject(rawRow);

  const pollId = clean(first(row, [
    "poll_id",
    "pollid",
    "id",
    "question_id",
  ]));

  const candidateName = clean(first(row, [
    "candidate_name",
    "candidate",
    "answer",
    "choice",
    "response",
    "party",
  ]));

  const answer = clean(first(row, [
    "answer",
    "choice",
    "response",
    "candidate_name",
    "candidate",
  ]));

  const pct = toNumber(first(row, [
    "pct",
    "percentage",
    "percent",
    "value",
    "support",
    "share",
  ]));

  if (!candidateName || pct === null) return null;

  const state = normalizeState(first(row, [
    "state",
    "state_code",
    "location",
    "geography",
  ]) || "US");

  const office = normalizeOffice(
    first(row, [
      "office",
      "office_type",
      "race_type",
      "type",
    ]) ||
    source.race_type ||
    "Unknown"
  );

  const fieldStart = normalizeDate(first(row, [
    "start_date",
    "field_start",
    "startdate",
    "date_start",
  ]));

  const fieldEnd = normalizeDate(first(row, [
    "end_date",
    "field_end",
    "enddate",
    "date_end",
  ]));

  const publishedAt =
    normalizeTimestamp(first(row, [
      "created_at",
      "published_at",
      "updated_at",
      "publication_date",
    ])) ||
    (fieldEnd ? `${fieldEnd}T12:00:00.000Z` : null);

  const sampleSize = toInteger(first(row, [
    "sample_size",
    "samplesize",
    "sample",
    "n",
  ]));

  const marginOfError = toNumber(first(row, [
    "margin_of_error",
    "moe",
    "margin_error",
  ]));

  const population = clean(first(row, [
    "population",
    "population_type",
    "sample_population",
  ]));

  const party = clean(first(row, [
    "party",
    "candidate_party",
  ]));

  const cycle = toInteger(first(row, [
    "cycle",
    "election_year",
    "year",
  ]));

  const electionDate = normalizeDate(first(row, [
    "election_date",
    "electiondate",
  ]));

  const district = clean(first(row, [
    "district",
    "district_number",
    "seat_number",
  ]));

  const pollster = clean(first(row, [
    "pollster",
    "pollster_name",
    "organization",
    "firm",
  ])) || source.name;

  const sponsor = clean(first(row, [
    "sponsor",
    "sponsors",
    "sponsor_name",
  ]));

  const methodology = clean(first(row, [
    "methodology",
    "method",
    "notes",
  ]));

  const mode = clean(first(row, [
    "mode",
    "survey_mode",
  ]));

  const raceName = clean(first(row, [
    "race_name",
    "question",
    "question_text",
  ])) || `${state} ${office}`;

  const recordType = source.record_type || (
    source.historical ? "historical_poll" : "measured_poll"
  );

  const isEstimate = recordType !== "measured_poll" && recordType !== "historical_poll";

  const dedupeKey = hash([
    source.id,
    pollId,
    pollster,
    state,
    district,
    office,
    candidateName,
    fieldStart,
    fieldEnd,
    pct,
  ].join("|"));

  return {
    dedupe_key: dedupeKey,
    poll_id: pollId || dedupeKey.slice(0, 24),
    source: source.name,
    source_url: source.url,
    source_dataset: source.id,
    pollster,
    sponsor: sponsor || null,
    state,
    district: district || null,
    office,
    race_name: raceName,
    candidate_name: candidateName,
    party: party || null,
    answer: answer || candidateName,
    pct,
    field_start: fieldStart,
    field_end: fieldEnd,
    published_at: publishedAt,
    sample_size: sampleSize,
    population: population || null,
    methodology: methodology || null,
    mode: mode || null,
    margin_of_error: marginOfError,
    cycle,
    election_date: electionDate,
    record_type: recordType,
    is_estimate: isEstimate,
    confidence_score: calculateConfidence({
      sampleSize,
      marginOfError,
      population,
      source: source.name,
      isEstimate,
    }),
    freshness_score: calculateFreshnessScore(fieldEnd, publishedAt),
    source_payload: rawRow,
  };
}

async function fetchSourceRows(source) {
  const text = await fetchText(source.url, {
    timeoutMs: Number(source.timeout_ms || DEFAULT_TIMEOUT_MS),
    retries: Number(source.retries ?? 2),
    headers: source.headers || {},
  });

  if (source.format === "json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;

    for (const key of [
      source.records_key,
      "polls",
      "results",
      "records",
      "data",
      "items",
    ].filter(Boolean)) {
      if (Array.isArray(parsed?.[key])) return parsed[key];
    }

    return [];
  }

  return parseCsv(text);
}

async function upsertPollingRows(rows = []) {
  let stored = 0;

  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO polling_results (
          dedupe_key,
          poll_id,
          source,
          source_url,
          source_dataset,
          pollster,
          sponsor,
          state,
          district,
          office,
          race_name,
          candidate_name,
          party,
          answer,
          pct,
          field_start,
          field_end,
          published_at,
          sample_size,
          population,
          methodology,
          mode,
          margin_of_error,
          cycle,
          election_date,
          record_type,
          is_estimate,
          confidence_score,
          freshness_score,
          source_payload,
          ingested_at,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,
          NOW(),NOW(),NOW()
        )
        ON CONFLICT (dedupe_key)
        WHERE dedupe_key IS NOT NULL
        DO UPDATE SET
          poll_id = EXCLUDED.poll_id,
          source = EXCLUDED.source,
          source_url = EXCLUDED.source_url,
          source_dataset = EXCLUDED.source_dataset,
          pollster = EXCLUDED.pollster,
          sponsor = EXCLUDED.sponsor,
          state = EXCLUDED.state,
          district = EXCLUDED.district,
          office = EXCLUDED.office,
          race_name = EXCLUDED.race_name,
          candidate_name = EXCLUDED.candidate_name,
          party = EXCLUDED.party,
          answer = EXCLUDED.answer,
          pct = EXCLUDED.pct,
          field_start = EXCLUDED.field_start,
          field_end = EXCLUDED.field_end,
          published_at = EXCLUDED.published_at,
          sample_size = EXCLUDED.sample_size,
          population = EXCLUDED.population,
          methodology = EXCLUDED.methodology,
          mode = EXCLUDED.mode,
          margin_of_error = EXCLUDED.margin_of_error,
          cycle = EXCLUDED.cycle,
          election_date = EXCLUDED.election_date,
          record_type = EXCLUDED.record_type,
          is_estimate = EXCLUDED.is_estimate,
          confidence_score = EXCLUDED.confidence_score,
          freshness_score = EXCLUDED.freshness_score,
          source_payload = EXCLUDED.source_payload,
          ingested_at = NOW(),
          updated_at = NOW()
      `,
      [
        row.dedupe_key,
        row.poll_id,
        row.source,
        row.source_url,
        row.source_dataset,
        row.pollster,
        row.sponsor,
        row.state,
        row.district,
        row.office,
        row.race_name,
        row.candidate_name,
        row.party,
        row.answer,
        row.pct,
        row.field_start,
        row.field_end,
        row.published_at,
        row.sample_size,
        row.population,
        row.methodology,
        row.mode,
        row.margin_of_error,
        row.cycle,
        row.election_date,
        row.record_type,
        row.is_estimate,
        row.confidence_score,
        row.freshness_score,
        JSON.stringify(row.source_payload || {}),
      ]
    );

    stored += 1;
  }

  return stored;
}

async function getTableColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function buildForecastEstimateRows({
  cycle = new Date().getFullYear(),
  limit = 250,
} = {}) {
  const columns = await getTableColumns("election_forecasts");

  if (!columns.size) return [];

  const candidateColumn = [
    "candidate_name",
    "name",
  ].find((column) => columns.has(column));

  const stateColumn = [
    "state",
    "state_code",
  ].find((column) => columns.has(column));

  const officeColumn = [
    "office",
    "office_type",
  ].find((column) => columns.has(column));

  const voteShareColumn = [
    "projected_vote_share",
    "vote_share",
    "estimated_vote_share",
  ].find((column) => columns.has(column));

  const probabilityColumn = [
    "win_probability",
    "forecast_probability",
  ].find((column) => columns.has(column));

  const dateColumn = [
    "updated_at",
    "created_at",
  ].find((column) => columns.has(column));

  if (!candidateColumn || (!voteShareColumn && !probabilityColumn)) return [];

  const metricColumn = voteShareColumn || probabilityColumn;
  const recordType = voteShareColumn
    ? "model_vote_share_estimate"
    : "forecast_probability";

  const result = await pool.query(`
    SELECT
      "${candidateColumn}"::text AS candidate_name,
      ${stateColumn ? `"${stateColumn}"::text` : "'US'"} AS state,
      ${officeColumn ? `"${officeColumn}"::text` : "'Unknown'"} AS office,
      "${metricColumn}"::numeric AS metric_value,
      ${dateColumn ? `"${dateColumn}"` : "NOW()"} AS updated_at
    FROM election_forecasts
    WHERE "${candidateColumn}" IS NOT NULL
      AND "${metricColumn}" IS NOT NULL
    ORDER BY ${dateColumn ? `"${dateColumn}" DESC NULLS LAST` : "1"}
    LIMIT ${Math.max(1, Math.min(Number(limit) || 250, 1000))}
  `);

  return result.rows.map((row) => {
    const candidateName = clean(row.candidate_name);
    const state = normalizeState(row.state || "US");
    const office = normalizeOffice(row.office);
    const pct = toNumber(row.metric_value);
    const publishedAt = normalizeTimestamp(row.updated_at) || new Date().toISOString();

    const dedupeKey = hash([
      "voterspheres-model",
      recordType,
      candidateName,
      state,
      office,
      cycle,
      publishedAt.slice(0, 10),
    ].join("|"));

    return {
      dedupe_key: dedupeKey,
      poll_id: dedupeKey.slice(0, 24),
      source: "VoterSpheres Forecast Engine",
      source_url: null,
      source_dataset: "voterspheres-election-forecasts",
      pollster: "VoterSpheres Model",
      sponsor: null,
      state,
      district: null,
      office,
      race_name: `${state} ${office}`,
      candidate_name: candidateName,
      party: null,
      answer: recordType === "forecast_probability"
        ? "Win probability"
        : candidateName,
      pct,
      field_start: null,
      field_end: publishedAt.slice(0, 10),
      published_at: publishedAt,
      sample_size: null,
      population: "MODEL",
      methodology:
        "Derived from the VoterSpheres election forecast engine. This is not a measured public-opinion poll.",
      mode: "MODEL",
      margin_of_error: null,
      cycle: Number(cycle),
      election_date: null,
      record_type: recordType,
      is_estimate: true,
      confidence_score: 58,
      freshness_score: calculateFreshnessScore(
        publishedAt.slice(0, 10),
        publishedAt
      ),
      source_payload: row,
    };
  });
}

async function pruneOldRows(retentionDays = DEFAULT_RETENTION_DAYS) {
  const result = await pool.query(
    `
      DELETE FROM polling_results
      WHERE COALESCE(field_end, published_at::date, created_at::date)
        < CURRENT_DATE - $1::integer
      RETURNING id
    `,
    [Math.max(30, Number(retentionDays) || DEFAULT_RETENTION_DAYS)]
  );

  return result.rowCount;
}

export async function runPollingIntelligenceIngestion({
  includeHistorical = false,
  generateEstimates = true,
  estimateCycle = new Date().getFullYear(),
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  retentionDays = DEFAULT_RETENTION_DAYS,
} = {}) {
  await ensurePollingIntelligenceSchema();

  const runKey = `polling-${Date.now()}-${crypto.randomUUID()}`;
  const sources = getPollingSourceRegistry({ includeHistorical });

  await pool.query(
    `
      INSERT INTO polling_ingestion_runs (
        run_key,
        status,
        source_count,
        started_at
      )
      VALUES ($1, 'running', $2, NOW())
    `,
    [runKey, sources.length]
  );

  let fetchedCount = 0;
  let normalizedCount = 0;
  let storedCount = 0;
  let estimateCount = 0;
  const errors = [];
  const diagnostics = [];

  const lookbackTimestamp =
    Date.now() - Math.max(1, Number(lookbackDays) || DEFAULT_LOOKBACK_DAYS) * 86400000;

  for (const source of sources) {
    const startedAt = Date.now();

    try {
      const rawRows = await fetchSourceRows(source);
      fetchedCount += rawRows.length;

      const normalizedRows = rawRows
        .map((row) => normalizePublicPollRow(row, source))
        .filter(Boolean)
        .filter((row) => {
          if (source.historical) return true;
          const timestamp = new Date(
            row.field_end || row.published_at || 0
          ).getTime();
          return !timestamp || timestamp >= lookbackTimestamp;
        });

      normalizedCount += normalizedRows.length;
      storedCount += await upsertPollingRows(normalizedRows);

      diagnostics.push({
        source: source.id,
        ok: true,
        fetched: rawRows.length,
        normalized: normalizedRows.length,
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      errors.push({
        source: source.id,
        message: error.message,
      });

      diagnostics.push({
        source: source.id,
        ok: false,
        fetched: 0,
        normalized: 0,
        latency_ms: Date.now() - startedAt,
        error: error.message,
      });
    }

    await sleep(DEFAULT_SOURCE_DELAY_MS);
  }

  if (generateEstimates) {
    try {
      const estimates = await buildForecastEstimateRows({
        cycle: estimateCycle,
      });

      estimateCount = estimates.length;
      storedCount += await upsertPollingRows(estimates);
    } catch (error) {
      errors.push({
        source: "voterspheres-election-forecasts",
        message: error.message,
      });
    }
  }

  const prunedCount = await pruneOldRows(retentionDays);

  const status =
    errors.length === 0
      ? "complete"
      : storedCount > 0
        ? "degraded"
        : "failed";

  await pool.query(
    `
      UPDATE polling_ingestion_runs
      SET
        status = $2,
        fetched_count = $3,
        normalized_count = $4,
        stored_count = $5,
        estimate_count = $6,
        errors = $7::jsonb,
        diagnostics = $8::jsonb,
        completed_at = NOW()
      WHERE run_key = $1
    `,
    [
      runKey,
      status,
      fetchedCount,
      normalizedCount,
      storedCount,
      estimateCount,
      JSON.stringify(errors),
      JSON.stringify({
        sources: diagnostics,
        pruned_count: prunedCount,
      }),
    ]
  );

  return {
    ok: storedCount > 0,
    build: "5.5.0",
    service: "polling-intelligence",
    run_key: runKey,
    status,
    source_count: sources.length,
    fetched_count: fetchedCount,
    normalized_count: normalizedCount,
    stored_count: storedCount,
    estimate_count: estimateCount,
    pruned_count: prunedCount,
    errors,
    diagnostics,
    completed_at: new Date().toISOString(),
  };
}

export async function listPollingIntelligence({
  state = "",
  office = "",
  candidate = "",
  recordType = "",
  measuredOnly = false,
  limit = 100,
} = {}) {
  await ensurePollingIntelligenceSchema();

  const conditions = [];
  const params = [];

  if (clean(state)) {
    params.push(normalizeState(state));
    conditions.push(`UPPER(COALESCE(state, '')) = $${params.length}`);
  }

  if (clean(office)) {
    params.push(`%${clean(office)}%`);
    conditions.push(`office ILIKE $${params.length}`);
  }

  if (clean(candidate)) {
    params.push(`%${clean(candidate)}%`);
    conditions.push(`candidate_name ILIKE $${params.length}`);
  }

  if (clean(recordType)) {
    params.push(clean(recordType));
    conditions.push(`record_type = $${params.length}`);
  }

  if (measuredOnly) {
    conditions.push(`is_estimate = FALSE`);
  }

  const whereSql = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const result = await pool.query(
    `
      SELECT *
      FROM polling_results
      ${whereSql}
      ORDER BY
        COALESCE(field_end, published_at::date, updated_at::date) DESC NULLS LAST,
        confidence_score DESC,
        pct DESC
      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 500))}
    `,
    params
  );

  return {
    ok: true,
    count: result.rows.length,
    results: result.rows,
    generated_at: new Date().toISOString(),
  };
}

export async function getPollingIntelligenceHealth() {
  await ensurePollingIntelligenceSchema();

  const [summary, latestRun] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::integer AS total_records,
        COUNT(*) FILTER (WHERE is_estimate = FALSE)::integer AS measured_records,
        COUNT(*) FILTER (WHERE is_estimate = TRUE)::integer AS estimate_records,
        COUNT(DISTINCT source_dataset)::integer AS datasets,
        MAX(COALESCE(field_end::timestamptz, published_at, updated_at)) AS freshest_record
      FROM polling_results
    `),
    pool.query(`
      SELECT *
      FROM polling_ingestion_runs
      ORDER BY started_at DESC
      LIMIT 1
    `),
  ]);

  const row = summary.rows[0] || {};

  return {
    ok: Number(row.total_records || 0) > 0,
    build: "5.5.0",
    service: "polling-intelligence",
    configured: true,
    paid_api_required: false,
    total_records: Number(row.total_records || 0),
    measured_records: Number(row.measured_records || 0),
    estimate_records: Number(row.estimate_records || 0),
    datasets: Number(row.datasets || 0),
    freshest_record: row.freshest_record || null,
    latest_run: latestRun.rows[0] || null,
    source_registry: getPollingSourceRegistry({
      includeHistorical: false,
    }).map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      format: source.format,
    })),
    generated_at: new Date().toISOString(),
  };
}

export default {
  ensurePollingIntelligenceSchema,
  getPollingSourceRegistry,
  runPollingIntelligenceIngestion,
  listPollingIntelligence,
  getPollingIntelligenceHealth,
};

