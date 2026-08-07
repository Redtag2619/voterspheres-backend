import crypto from "node:crypto";

import axios from "axios";

import { pool } from "../db/pool.js";

 

const clean = (value = "") => String(value ?? "").trim();

const upper = (value = "") => clean(value).toUpperCase();

const lower = (value = "") => clean(value).toLowerCase();

 

const toNumber = (value, fallback = null) => {

  if (value === undefined || value === null || value === "") return fallback;

  const parsed = Number(String(value).replace(/[$,%]/g, "").trim());

  return Number.isFinite(parsed) ? parsed : fallback;

};

 

const toInteger = (value, fallback = null) => {

  const parsed = toNumber(value, fallback);

  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;

};

 

const STATE_NAME_TO_CODE = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
  DC: "DC",
};

const STATE_CODE_TO_NAME = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name])
);

const normalizeState = (value = "") => {
  const next = upper(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !next ||
    next === "US" ||
    next === "USA" ||
    next === "U S" ||
    next === "UNITED STATES" ||
    next === "UNITED STATES OF AMERICA" ||
    next === "NATIONAL" ||
    next === "NATIONWIDE"
  ) {
    return "US";
  }

  if (STATE_CODE_TO_NAME[next]) return next;

  if (STATE_NAME_TO_CODE[next]) return STATE_NAME_TO_CODE[next];

  return null;
};

const inferStateFromSubject = (subject = "") => {
  const text = upper(subject)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  // Prefer full state names, longest first, so compound names such as
  // NORTH CAROLINA are resolved before shorter potential matches.
  const stateNames = Object.keys(STATE_NAME_TO_CODE)
    .filter((name) => name.length > 2)
    .sort((a, b) => b.length - a.length);

  for (const stateName of stateNames) {
    const pattern = new RegExp(
      `(?:^|[^A-Z])${stateName.replace(/\s+/g, "\\s+")}(?:$|[^A-Z])`,
      "i"
    );

    if (pattern.test(text)) {
      return STATE_NAME_TO_CODE[stateName];
    }
  }

  return null;
};

const stateDisplayName = (state = "") => {
  const code = normalizeState(state);

  if (!code || code === "US") return "U.S.";

  const name = STATE_CODE_TO_NAME[code];

  if (!name) return code;

  return name
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const buildRaceName = ({
  state,
  office,
  pollType,
  district,
  suppliedRaceName,
} = {}) => {
  const supplied = clean(suppliedRaceName);

  // Preserve a real provider-supplied race/seat/question label.
  if (supplied) return supplied;

  const geography = stateDisplayName(state);
  const normalizedType = normalizePollType(pollType || office);
  const normalizedOffice = lower(office);

  if (
    normalizedType === "us-senator" ||
    normalizedType === "senate" ||
    normalizedOffice.includes("senator") ||
    normalizedOffice.includes("senate")
  ) {
    return `${geography} U.S. Senate`;
  }

  if (
    normalizedType === "governor" ||
    normalizedOffice.includes("governor")
  ) {
    return `${geography} Governor`;
  }

  if (
    normalizedType === "us-representative" ||
    normalizedType === "house" ||
    normalizedOffice.includes("representative") ||
    normalizedOffice.includes("house")
  ) {
    return district
      ? `${geography} U.S. House District ${district}`
      : `${geography} U.S. House`;
  }

  if (normalizedType === "president") {
    return state === "US"
      ? "U.S. President"
      : `${geography} President`;
  }

  if (normalizedType === "generic-ballot") {
    return state === "US"
      ? "U.S. Generic Ballot"
      : `${geography} Generic Ballot`;
  }

  if (normalizedType === "approval") {
    return state === "US"
      ? "U.S. Approval"
      : `${geography} Approval`;
  }

  if (normalizedType === "favorability") {
    return state === "US"
      ? "U.S. Favorability"
      : `${geography} Favorability`;
  }

  return clean(`${geography} ${office || pollType || "Polling"}`);
};

 const normalizePollType = (value = "") => {

  const next = lower(value).replace(/_/g, "-").replace(/\s+/g, "-");

  if (!next) return "unknown";

  if (next.includes("generic") && next.includes("ballot")) return "generic-ballot";

  if (next.includes("approval")) return "approval";

  if (next.includes("favor")) return "favorability";

  if (next.includes("president")) return "president";

  if (next.includes("senate")) return "senate";

  if (next.includes("governor")) return "governor";

  if (next.includes("house")) return "house";

  return next;

};

 const normalizeDate = (value) => {

  if (!value) return null;

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime())

    ? parsed.toISOString().slice(0, 10)

    : null;

};

const normalizeTimestamp = (value) => {

  if (!value) return null;

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;

};

const sha256 = (value) =>

  crypto.createHash("sha256").update(String(value)).digest("hex");

function firstValue(object = {}, keys = []) {

  for (const key of keys) {

    const value = object?.[key];

    if (value !== undefined && value !== null && value !== "") return value;

  }

  return null;

}

 function sourcePollId(item = {}) {

  return clean(firstValue(item, [

    "id",

    "poll_id",

    "pollId",

    "external_id",

    "uuid",

  ]));

}

function pollAnswers(item = {}) {

  const candidates = [

    item.answers,

    item.results,

    item.responses,

    item.choices,

    item.options,

  ];

  const raw = candidates.find(Array.isArray) || [];

  return raw

    .map((answer) => {

      if (typeof answer === "string") return null;

       const choice = clean(firstValue(answer, [

        "choice",

        "answer",

        "candidate",

        "candidate_name",

        "response",

        "name",

        "label",

        "party",

      ]));

       const pct = toNumber(firstValue(answer, [

        "pct",

        "percentage",

        "percent",

        "value",

        "support",

        "share",

      ]));

       if (!choice || pct === null) return null;

       return {

        choice,

        pct,

        party: clean(firstValue(answer, ["party", "candidate_party"])),

        candidate_id: clean(firstValue(answer, ["candidate_id", "candidateId", "id"])),

      };

    })

    .filter(Boolean);

}

function freshnessScore(dateValue) {

  if (!dateValue) return 35;

  const timestamp = new Date(dateValue).getTime();

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

function confidenceScore({ sampleSize, marginOfError, population }) {

  let score = 65;

  if (sampleSize >= 1500) score += 15;

  else if (sampleSize >= 1000) score += 12;

  else if (sampleSize >= 600) score += 8;

  else if (sampleSize >= 300) score += 4;

  if (marginOfError !== null) {

  if (marginOfError <= 2.5) score += 10;

    else if (marginOfError <= 3.5) score += 7;

    else if (marginOfError <= 5) score += 3;

  }

  const pop = lower(population);

  if (pop === "lv") score += 6;

  else if (pop === "rv") score += 4;

  else if (pop === "a") score += 1;

   return Math.max(25, Math.min(98, score));

}

 export async function ensureUnifiedPollingSchema() {

  await pool.query(`CREATE TABLE IF NOT EXISTS polling_results (id BIGSERIAL PRIMARY KEY)`);

   await pool.query(`

    ALTER TABLE polling_results

      ADD COLUMN IF NOT EXISTS dedupe_key TEXT,

      ADD COLUMN IF NOT EXISTS poll_id TEXT,

      ADD COLUMN IF NOT EXISTS source TEXT,

      ADD COLUMN IF NOT EXISTS source_url TEXT,

      ADD COLUMN IF NOT EXISTS source_dataset TEXT,

      ADD COLUMN IF NOT EXISTS poll_type TEXT,

      ADD COLUMN IF NOT EXISTS pollster TEXT,

      ADD COLUMN IF NOT EXISTS sponsor TEXT,

      ADD COLUMN IF NOT EXISTS subject TEXT,

      ADD COLUMN IF NOT EXISTS state TEXT,

      ADD COLUMN IF NOT EXISTS district TEXT,

      ADD COLUMN IF NOT EXISTS office TEXT,

      ADD COLUMN IF NOT EXISTS race_name TEXT,

      ADD COLUMN IF NOT EXISTS candidate_name TEXT,

      ADD COLUMN IF NOT EXISTS candidate_id TEXT,

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

      ADD COLUMN IF NOT EXISTS partisan TEXT,

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

    CREATE TABLE IF NOT EXISTS polling_ingestion_runs (

      id BIGSERIAL PRIMARY KEY,

      run_key TEXT UNIQUE NOT NULL,

      provider TEXT NOT NULL DEFAULT 'votehub',

      status TEXT NOT NULL DEFAULT 'running',

      request_count INTEGER NOT NULL DEFAULT 0,

      fetched_poll_count INTEGER NOT NULL DEFAULT 0,

      normalized_answer_count INTEGER NOT NULL DEFAULT 0,

      inserted_count INTEGER NOT NULL DEFAULT 0,

      updated_count INTEGER NOT NULL DEFAULT 0,

      skipped_count INTEGER NOT NULL DEFAULT 0,

      errors JSONB NOT NULL DEFAULT '[]'::jsonb,

      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,

      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      completed_at TIMESTAMPTZ

    )

  `);

}

 export async function fetchVoteHubPolls({

  pollType = "",

  subject = "",

  pollster = "",

  fromDate = "",

  limit = 500,

} = {}) {

  const endpoint =

    process.env.VOTEHUB_POLLING_API_URL ||

    "https://api.votehub.com/polls";

  const response = await axios.get(endpoint, {

    params: {

      ...(pollType ? { poll_type: pollType } : {}),

      ...(subject ? { subject } : {}),

      ...(pollster ? { pollster } : {}),

      ...(fromDate ? { from_date: fromDate } : {}),

      ...(limit ? { limit } : {}),

    },

    timeout: Number(process.env.VOTEHUB_TIMEOUT_MS || 30000),

    headers: {

      Accept: "application/json",

      "User-Agent": process.env.VOTEHUB_USER_AGENT || "VoterSpheres/5.7",

    },

  });

   const payload = response?.data;

   if (Array.isArray(payload)) return payload;

  if (Array.isArray(payload?.polls)) return payload.polls;

  if (Array.isArray(payload?.results)) return payload.results;

  if (Array.isArray(payload?.data)) return payload.data;

  if (Array.isArray(payload?.items)) return payload.items;

  return [];

}

export function normalizeVoteHubPoll(item = {}, context = {}) {

  const answers = pollAnswers(item);

  if (!answers.length) return [];

  const pollId = sourcePollId(item) || sha256(JSON.stringify(item)).slice(0, 24);

  const pollType = normalizePollType(

    firstValue(item, ["poll_type", "pollType", "type"]) || context.pollType

  );

  const pollster = clean(firstValue(item, ["pollster", "pollster_name", "organization", "firm"]));

  const sponsorValue = firstValue(item, ["sponsors", "sponsor", "sponsor_name"]);

  const sponsor = Array.isArray(sponsorValue)

    ? sponsorValue.map((value) => clean(value?.name || value)).filter(Boolean).join(", ")

    : clean(sponsorValue);

  const subjectValue = firstValue(item, ["subject", "subject_name", "cycle"]);

  const subject = typeof subjectValue === "object"

    ? clean(subjectValue?.name || subjectValue?.title || subjectValue?.id)

    : clean(subjectValue || context.subject);

 const explicitState =
  normalizeState(
    firstValue(item, ["state", "state_code", "location"]) ||
    context.state
  );

const inferredState = inferStateFromSubject(subject);

const state =
  explicitState && explicitState !== "US"
    ? explicitState
    : inferredState || explicitState || "US";

const office = clean(
  firstValue(item, ["office", "office_type", "race_type"]) ||
  context.office ||
  pollType
);

const district = clean(
  firstValue(item, ["district", "district_number"])
);

const suppliedRaceName = firstValue(item, [
  "seat_name",
  "race_name",
  "question",
  "question_text",
]);

const raceName = buildRaceName({
  state,
  office,
  pollType,
  district,
  suppliedRaceName,
});
 
  const fieldStart = normalizeDate(firstValue(item, ["start_date", "field_start", "startDate"]));

  const fieldEnd = normalizeDate(firstValue(item, ["end_date", "field_end", "endDate", "date"]));

  const publishedAt = normalizeTimestamp(firstValue(item, ["published_at", "created_at", "updated_at"])) ||

    (fieldEnd ? `${fieldEnd}T12:00:00.000Z` : null);

  const sampleSize = toInteger(firstValue(item, ["sample_size", "sample", "n"]));

  const population = clean(firstValue(item, ["population", "population_type"]));

  const marginOfError = toNumber(firstValue(item, ["margin_of_error", "moe"]));

  const methodology = clean(firstValue(item, ["methodology", "method", "notes"]));

  const mode = clean(firstValue(item, ["mode", "survey_mode"]));

  const partisan = clean(firstValue(item, ["partisan", "partisanship"]));

  const sourceUrl = clean(firstValue(item, ["url", "source_url", "link"]));

  const cycle = toInteger(firstValue(item, ["cycle", "election_year", "year"]));

  const electionDate = normalizeDate(firstValue(item, ["election_date", "electionDate"]));

   return answers.map((answer) => {

    const dedupeKey = sha256([

      "votehub",

      pollId,

      answer.choice,

      state,

      fieldEnd,

      pollType,

    ].join("|"));

    return {

      dedupe_key: dedupeKey,

      poll_id: pollId,

      source: "VoteHub",

      source_url: sourceUrl || null,

      source_dataset: "votehub-polling-api",

      poll_type: pollType,

      pollster: pollster || "Unknown",

      sponsor: sponsor || null,

      subject: subject || null,

      state,

      district: district || null,

      office,

      race_name: raceName,

      candidate_name: answer.choice,

      candidate_id: answer.candidate_id || null,

      party: answer.party || null,

      answer: answer.choice,

      pct: answer.pct,

      field_start: fieldStart,

      field_end: fieldEnd,

      published_at: publishedAt,

      sample_size: sampleSize,

      population: population || null,

      methodology: methodology || null,

      mode: mode || null,

      margin_of_error: marginOfError,

      partisan: partisan || null,

      cycle,

      election_date: electionDate,

      record_type: "measured_poll",

      is_estimate: false,

      confidence_score: confidenceScore({ sampleSize, marginOfError, population }),

      freshness_score: freshnessScore(fieldEnd || publishedAt),

      source_payload: item,

    };

  });

}

export async function upsertPollingResult(row = {}) {

  await ensureUnifiedPollingSchema();

  const result = await pool.query(

    `
      INSERT INTO polling_results (

        dedupe_key, poll_id, source, source_url, source_dataset,

        poll_type, pollster, sponsor, subject, state,

        district, office, race_name, candidate_name, candidate_id,

        party, answer, pct, field_start, field_end,

        published_at, sample_size, population, methodology, mode,

        margin_of_error, partisan, cycle, election_date, record_type,

        is_estimate, confidence_score, freshness_score, source_payload,

        ingested_at, created_at, updated_at

      )

      VALUES (

        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,

        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,

        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,

        $31,$32,$33,$34::jsonb,NOW(),NOW(),NOW()

      )

      ON CONFLICT (dedupe_key)

      WHERE dedupe_key IS NOT NULL

      DO UPDATE SET

        poll_id = EXCLUDED.poll_id,

        source = EXCLUDED.source,

        source_url = EXCLUDED.source_url,

        source_dataset = EXCLUDED.source_dataset,

        poll_type = EXCLUDED.poll_type,

        pollster = EXCLUDED.pollster,

        sponsor = EXCLUDED.sponsor,

        subject = EXCLUDED.subject,

        state = EXCLUDED.state,

        district = EXCLUDED.district,

        office = EXCLUDED.office,

        race_name = EXCLUDED.race_name,

        candidate_name = EXCLUDED.candidate_name,

        candidate_id = EXCLUDED.candidate_id,

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

        partisan = EXCLUDED.partisan,

        cycle = EXCLUDED.cycle,

        election_date = EXCLUDED.election_date,

        record_type = EXCLUDED.record_type,

        is_estimate = EXCLUDED.is_estimate,

        confidence_score = EXCLUDED.confidence_score,

        freshness_score = EXCLUDED.freshness_score,

        source_payload = EXCLUDED.source_payload,

        ingested_at = NOW(),

        updated_at = NOW()

      RETURNING (xmax = 0) AS inserted

    `,

    [

      row.dedupe_key, row.poll_id, row.source, row.source_url, row.source_dataset,

      row.poll_type, row.pollster, row.sponsor, row.subject, row.state,

      row.district, row.office, row.race_name, row.candidate_name, row.candidate_id,

      row.party, row.answer, row.pct, row.field_start, row.field_end,

      row.published_at, row.sample_size, row.population, row.methodology, row.mode,

      row.margin_of_error, row.partisan, row.cycle, row.election_date, row.record_type,

      row.is_estimate, row.confidence_score, row.freshness_score,

      JSON.stringify(row.source_payload || {}),

    ]

  );

   return result.rows[0]?.inserted ? "inserted" : "updated";

}

export async function ingestPollingSignals(options = {}) {

  await ensureUnifiedPollingSchema();

  const normalizedOptions = typeof options === "number"

    ? { limit: options }

    : options || {};

   const pollTypes = Array.isArray(normalizedOptions.pollTypes)

    ? normalizedOptions.pollTypes

        .map((value) => clean(value))

        .filter(Boolean)

    : clean(normalizedOptions.pollType)

      ? [clean(normalizedOptions.pollType)]

      : [""];

   const runKey = `votehub-${Date.now()}-${crypto.randomUUID()}`;

  await pool.query(

    `INSERT INTO polling_ingestion_runs (run_key, provider, status, request_count) VALUES ($1, 'votehub', 'running', $2)`,

    [runKey, pollTypes.length]

  );

  let fetchedPollCount = 0;

  let normalizedAnswerCount = 0;

  let insertedCount = 0;

  let updatedCount = 0;

  let skippedCount = 0;

  const errors = [];

  const diagnostics = [];

  for (const pollType of pollTypes) {

    const startedAt = Date.now();

     try {

      const polls = await fetchVoteHubPolls({

        pollType,

        subject: normalizedOptions.subject || "",

        pollster: normalizedOptions.pollster || "",

        fromDate: normalizedOptions.fromDate || "",

        limit: normalizedOptions.limit || 500,

      });

       fetchedPollCount += polls.length;

      let sourceNormalized = 0;

       for (const item of polls) {

        const rows = normalizeVoteHubPoll(item, {

          pollType,

          subject: normalizedOptions.subject,

          state: normalizedOptions.state,

          office: normalizedOptions.office,

        });

         if (!rows.length) {

          skippedCount += 1;

          continue;

        }

         sourceNormalized += rows.length;

        normalizedAnswerCount += rows.length;

         for (const row of rows) {

          const action = await upsertPollingResult(row);

          if (action === "inserted") insertedCount += 1;

          else updatedCount += 1;

        }

      }

       diagnostics.push({

        poll_type: pollType || "all",

        ok: true,

        fetched_polls: polls.length,

        normalized_answers: sourceNormalized,

        latency_ms: Date.now() - startedAt,

      });

    } catch (error) {

      errors.push({ poll_type: pollType || "all", message: error.message });

      diagnostics.push({

        poll_type: pollType || "all",

        ok: false,

        fetched_polls: 0,

        normalized_answers: 0,

        latency_ms: Date.now() - startedAt,

        error: error.message,

      });

    }

  }

  const storedCount = insertedCount + updatedCount;

  const status = storedCount > 0 && errors.length === 0

    ? "complete"

    : storedCount > 0

      ? "degraded"

      : "failed";

  await pool.query(

    `
      UPDATE polling_ingestion_runs

      SET status = $2,

          fetched_poll_count = $3,

          normalized_answer_count = $4,

          inserted_count = $5,

          updated_count = $6,

          skipped_count = $7,

          errors = $8::jsonb,

          diagnostics = $9::jsonb,

          completed_at = NOW()

      WHERE run_key = $1

    `,

    [

      runKey,

      status,

      fetchedPollCount,

      normalizedAnswerCount,

      insertedCount,

      updatedCount,

      skippedCount,

      JSON.stringify(errors),

      JSON.stringify({ sources: diagnostics }),

    ]

  );

  return {

    ok: storedCount > 0,

    success: storedCount > 0,

    build: "5.7.0",

    source: "votehub_polling",

    run_key: runKey,

    status,

    requests: pollTypes.length,

    fetched_polls: fetchedPollCount,

    normalized_answers: normalizedAnswerCount,

    inserted: insertedCount,

    updated: updatedCount,

    skipped: skippedCount,

    errors,

    diagnostics,

    completed_at: new Date().toISOString(),

  };

}

export async function getRecentPollingSignals(limit = 10) {

  await ensureUnifiedPollingSchema();

  const result = await pool.query(

    `
      SELECT

        poll_id AS external_id,

        source,

        poll_type,

        pollster,

        subject,

        state,

        office,

        candidate_name,

        candidate_id,

        field_start AS start_date,

        field_end AS end_date,

        sample_size,

        population,

        source_url AS url,

        jsonb_build_array(

          jsonb_build_object('choice', answer, 'pct', pct)

        ) AS answers,

        source_payload AS raw_payload,

        created_at,

        updated_at

      FROM polling_results

      ORDER BY COALESCE(field_end, published_at::date, updated_at::date) DESC NULLS LAST

      LIMIT $1

    `,

    [Math.max(1, Math.min(Number(limit) || 10, 500))]

  );

   return result.rows;

}

export async function migrateLegacyPollingSignals() {

  await ensureUnifiedPollingSchema();

  const exists = await pool.query(`

    SELECT EXISTS (

      SELECT 1 FROM information_schema.tables

      WHERE table_schema = 'public' AND table_name = 'polling_signals'

    ) AS exists

  `);

  if (!exists.rows[0]?.exists) {

    return { ok: true, migrated: 0, reason: "polling_signals table does not exist" };

  }

  const legacy = await pool.query(`SELECT * FROM polling_signals ORDER BY id`);

  let migrated = 0;

  for (const item of legacy.rows) {

    const sourcePayload = item.raw_payload || {};

    const answers = Array.isArray(item.answers) ? item.answers : [];

    const normalized = normalizeVoteHubPoll(

      {

        ...sourcePayload,

        id: item.external_id,

        poll_type: item.poll_type,

        pollster: item.pollster,

        subject: item.subject,

        state: item.state,

        office: item.office,

        start_date: item.start_date,

        end_date: item.end_date,

        sample_size: item.sample_size,

        population: item.population,

        url: item.url,

        answers,

      },

      {}

    );

     for (const row of normalized) {

      await upsertPollingResult(row);

      migrated += 1;

    }

  }

  return { ok: true, migrated };

}

// Compatibility aliases for older imports.

export async function ensurePollingSignalsTable() {

  return ensureUnifiedPollingSchema();

}

export async function upsertPollingSignal(input = {}) {

  const normalized = normalizeVoteHubPoll(

    {

      id: input.external_id,

      poll_type: input.poll_type,

      pollster: input.pollster,

      subject: input.subject,

      state: input.state,

      office: input.office,

      start_date: input.start_date,

      end_date: input.end_date,

      sample_size: input.sample_size,

      population: input.population,

      url: input.url,

      answers: input.answers,

      ...input.raw_payload,

    },

    {}

  );

  if (!normalized.length) return "skipped";

  let lastAction = "skipped";

  for (const row of normalized) lastAction = await upsertPollingResult(row);

  return lastAction;

}

export async function ingestPolling(options = {}) {

  return ingestPollingSignals(options);

}

export async function getRecentPolling(limit = 10) {

  return getRecentPollingSignals(limit);

}

export default {

  ensureUnifiedPollingSchema,

  ensurePollingSignalsTable,

  fetchVoteHubPolls,

  normalizeVoteHubPoll,

  upsertPollingResult,

  upsertPollingSignal,

  ingestPollingSignals,

  ingestPolling,

  getRecentPollingSignals,

  getRecentPolling,

  migrateLegacyPollingSignals,

};
