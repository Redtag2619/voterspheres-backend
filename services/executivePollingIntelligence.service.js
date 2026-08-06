
import { pool } from "../db/pool.js";

const clean = (value = "") => String(value ?? "").trim();

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, Number(value) || minimum));

const normalizeState = (value = "") => {
  const next = clean(value).toUpperCase();
  if (!next || next === "NATIONAL" || next === "US") return "US";
  return next.slice(0, 2);
};

const normalizePollType = (value = "") => {
  const next = clean(value).toLowerCase();
  return next || "generic-ballot";
};

const normalizePopulation = (value = "") =>
  clean(value).toLowerCase();

async function tableExists(tableName) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function tableColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

function column(columns, candidates, fallback = "NULL") {
  const found = candidates.find((candidate) => columns.has(candidate));
  return found ? `"${found}"` : fallback;
}

function pollTypeExpression(columns) {
  if (columns.has("poll_type")) return `"poll_type"`;
  if (columns.has("office")) {
    return `
      CASE
        WHEN LOWER(COALESCE("office", '')) LIKE '%generic%' THEN 'generic-ballot'
        WHEN LOWER(COALESCE("office", '')) LIKE '%approval%' THEN 'approval'
        WHEN LOWER(COALESCE("office", '')) LIKE '%favor%' THEN 'favorability'
        WHEN LOWER(COALESCE("office", '')) LIKE '%president%' THEN 'president'
        WHEN LOWER(COALESCE("office", '')) LIKE '%senate%' THEN 'senate'
        WHEN LOWER(COALESCE("office", '')) LIKE '%governor%' THEN 'governor'
        WHEN LOWER(COALESCE("office", '')) LIKE '%house%' THEN 'house'
        ELSE LOWER(REPLACE(COALESCE("office", 'unknown'), ' ', '-'))
      END
    `;
  }

  return `'generic-ballot'`;
}

function choiceExpression(columns) {
  return column(
    columns,
    ["answer", "candidate_name", "choice", "response"],
    "NULL"
  );
}

function pctExpression(columns) {
  return column(
    columns,
    ["pct", "percentage", "percent", "value"],
    "NULL"
  );
}

function dateExpression(columns) {
  const options = [
    "field_end",
    "end_date",
    "published_at",
    "created_at",
    "updated_at",
  ];

  const found = options.find((candidate) => columns.has(candidate));
  return found ? `"${found}"` : "NULL";
}

function freshnessCase(dateSql) {
  return `
    CASE
      WHEN ${dateSql} IS NULL THEN 25
      WHEN CURRENT_DATE - (${dateSql})::date <= 3 THEN 100
      WHEN CURRENT_DATE - (${dateSql})::date <= 7 THEN 92
      WHEN CURRENT_DATE - (${dateSql})::date <= 14 THEN 84
      WHEN CURRENT_DATE - (${dateSql})::date <= 30 THEN 72
      WHEN CURRENT_DATE - (${dateSql})::date <= 90 THEN 58
      WHEN CURRENT_DATE - (${dateSql})::date <= 365 THEN 44
      ELSE 28
    END
  `;
}

async function pollingSchema() {
  const exists = await tableExists("polling_results");

  if (!exists) {
    return {
      exists: false,
      columns: new Set(),
    };
  }

  return {
    exists: true,
    columns: await tableColumns("polling_results"),
  };
}

function buildFilters({
  state,
  pollType,
  population,
  pollster,
  subject,
  measuredOnly,
  startDate,
  endDate,
}, expressions) {
  const params = [];
  const conditions = [];

  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (state && state !== "US") {
    conditions.push(
      `UPPER(COALESCE(${expressions.state}, '')) = ${push(state)}`
    );
  }

  if (pollType) {
    conditions.push(
      `LOWER(COALESCE(${expressions.pollType}, '')) = ${push(pollType)}`
    );
  }

  if (population) {
    conditions.push(
      `LOWER(COALESCE(${expressions.population}, '')) = ${push(population)}`
    );
  }

  if (pollster) {
    conditions.push(
      `COALESCE(${expressions.pollster}, '') ILIKE ${push(`%${pollster}%`)}`
    );
  }

  if (subject) {
    conditions.push(
      `COALESCE(${expressions.subject}, '') ILIKE ${push(`%${subject}%`)}`
    );
  }

  if (measuredOnly && expressions.isEstimate !== "FALSE") {
    conditions.push(`COALESCE(${expressions.isEstimate}, FALSE) = FALSE`);
  }

  if (startDate) {
    conditions.push(`(${expressions.date})::date >= ${push(startDate)}::date`);
  }

  if (endDate) {
    conditions.push(`(${expressions.date})::date <= ${push(endDate)}::date`);
  }

  return {
    params,
    whereSql: conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "",
  };
}

function schemaExpressions(columns) {
  const date = dateExpression(columns);

  return {
    id: column(columns, ["id", "poll_id"], "NULL"),
    pollId: column(columns, ["poll_id", "id"], "NULL"),
    pollType: pollTypeExpression(columns),
    state: column(columns, ["state", "state_code"], "'US'"),
    district: column(columns, ["district", "district_number"], "NULL"),
    office: column(columns, ["office", "race_name"], "'Generic Ballot'"),
    raceName: column(columns, ["race_name", "seat_name", "office"], "NULL"),
    pollster: column(columns, ["pollster", "source"], "'Unknown'"),
    sponsor: column(columns, ["sponsor", "sponsors"], "NULL"),
    population: column(columns, ["population"], "NULL"),
    subject: column(columns, ["subject", "cycle"], "NULL"),
    choice: choiceExpression(columns),
    pct: pctExpression(columns),
    sampleSize: column(columns, ["sample_size"], "NULL"),
    partisan: column(columns, ["partisan"], "NULL"),
    source: column(columns, ["source"], "'VoteHub'"),
    sourceUrl: column(columns, ["source_url", "url"], "NULL"),
    date,
    startDate: column(columns, ["field_start", "start_date"], "NULL"),
    endDate: column(columns, ["field_end", "end_date"], date),
    createdAt: column(columns, ["created_at"], date),
    confidence: column(columns, ["confidence_score"], "NULL"),
    freshness: columns.has("freshness_score")
      ? `"freshness_score"`
      : freshnessCase(date),
    recordType: column(columns, ["record_type"], "'measured_poll'"),
    isEstimate: column(columns, ["is_estimate"], "FALSE"),
  };
}

function dashboardFilters(query = {}) {
  return {
    state: normalizeState(query.state),
    pollType: normalizePollType(query.poll_type),
    population: normalizePopulation(query.population),
    pollster: clean(query.pollster),
    subject: clean(query.subject),
    measuredOnly:
      String(query.measured_only ?? "true").toLowerCase() !== "false",
    startDate: clean(query.start_date),
    endDate: clean(query.end_date),
  };
}

async function baseRows({
  filters,
  limit = 500,
} = {}) {
  const schema = await pollingSchema();

  if (!schema.exists) {
    return {
      rows: [],
      schema,
    };
  }

  const x = schemaExpressions(schema.columns);
  const where = buildFilters(filters, x);

  const sql = `
    SELECT
      ${x.id} AS id,
      ${x.pollId}::text AS poll_id,
      ${x.pollType}::text AS poll_type,
      UPPER(COALESCE(${x.state}::text, 'US')) AS state,
      ${x.district}::text AS district,
      ${x.office}::text AS office,
      ${x.raceName}::text AS race_name,
      ${x.pollster}::text AS pollster,
      ${x.sponsor}::text AS sponsor,
      LOWER(${x.population}::text) AS population,
      ${x.subject}::text AS subject,
      ${x.choice}::text AS choice,
      (${x.pct})::numeric AS pct,
      (${x.sampleSize})::integer AS sample_size,
      ${x.partisan}::text AS partisan,
      ${x.source}::text AS source,
      ${x.sourceUrl}::text AS source_url,
      (${x.startDate})::date AS start_date,
      (${x.endDate})::date AS end_date,
      (${x.date})::date AS poll_date,
      (${x.createdAt})::timestamptz AS created_at,
      COALESCE((${x.confidence})::numeric, 75) AS confidence_score,
      COALESCE((${x.freshness})::numeric, 50) AS freshness_score,
      ${x.recordType}::text AS record_type,
      COALESCE(${x.isEstimate}, FALSE) AS is_estimate
    FROM polling_results
    ${where.whereSql}
    ORDER BY
      (${x.date})::date DESC NULLS LAST,
      ${x.pollster} ASC,
      ${x.pollId} ASC
    LIMIT ${clamp(limit, 1, 5000)}
  `;

  const result = await pool.query(sql, where.params);

  return {
    rows: result.rows,
    schema,
  };
}

function uniquePollKey(row) {
  return [
    row.poll_id || row.id,
    row.pollster,
    row.start_date,
    row.end_date,
    row.poll_type,
    row.state,
    row.population,
  ].join("|");
}

function groupPolls(rows = []) {
  const groups = new Map();

  for (const row of rows) {
    const key = uniquePollKey(row);

    if (!groups.has(key)) {
      groups.set(key, {
        id: row.poll_id || String(row.id || key),
        poll_type: row.poll_type,
        state: row.state || "US",
        district: row.district,
        office: row.office,
        race_name: row.race_name,
        pollster: row.pollster || "Unknown",
        sponsor: row.sponsor,
        population: row.population,
        subject: row.subject,
        sample_size: row.sample_size,
        partisan: row.partisan,
        source: row.source,
        source_url: row.source_url,
        start_date: row.start_date,
        end_date: row.end_date,
        poll_date: row.poll_date,
        confidence_score: Number(row.confidence_score || 0),
        freshness_score: Number(row.freshness_score || 0),
        record_type: row.record_type,
        is_estimate: Boolean(row.is_estimate),
        answers: [],
      });
    }

    const poll = groups.get(key);

    if (row.choice && Number.isFinite(Number(row.pct))) {
      poll.answers.push({
        choice: row.choice,
        pct: Number(row.pct),
      });
    }
  }

  return [...groups.values()]
    .map((poll) => ({
      ...poll,
      answers: poll.answers.sort((a, b) => b.pct - a.pct),
    }))
    .sort((a, b) =>
      String(b.poll_date || b.end_date || "").localeCompare(
        String(a.poll_date || a.end_date || "")
      )
    );
}

function genericBallotAverage(polls = [], windowSize = 20) {
  const latest = polls
    .filter((poll) => poll.poll_type === "generic-ballot")
    .slice(0, windowSize);

  const values = new Map();

  for (const poll of latest) {
    for (const answer of poll.answers) {
      const choice = clean(answer.choice);
      const current = values.get(choice) || {
        total: 0,
        weight: 0,
        count: 0,
      };

      const recencyWeight = Math.max(
        0.35,
        Number(poll.freshness_score || 50) / 100
      );

      const sampleWeight = poll.sample_size
        ? Math.min(2, Math.sqrt(Number(poll.sample_size)) / 25)
        : 1;

      const weight = recencyWeight * sampleWeight;

      current.total += Number(answer.pct) * weight;
      current.weight += weight;
      current.count += 1;
      values.set(choice, current);
    }
  }

  return [...values.entries()]
    .map(([choice, value]) => ({
      choice,
      average:
        value.weight > 0
          ? Number((value.total / value.weight).toFixed(1))
          : 0,
      polls: value.count,
    }))
    .sort((a, b) => b.average - a.average);
}

function trendSeries(polls = []) {
  const byDate = new Map();

  for (const poll of [...polls].reverse()) {
    if (!poll.poll_date && !poll.end_date) continue;

    const date = String(poll.poll_date || poll.end_date);

    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        values: new Map(),
      });
    }

    const bucket = byDate.get(date);

    for (const answer of poll.answers) {
      const current = bucket.values.get(answer.choice) || [];
      current.push(Number(answer.pct));
      bucket.values.set(answer.choice, current);
    }
  }

  return [...byDate.values()]
    .map((bucket) => ({
      date: bucket.date,
      values: [...bucket.values.entries()]
        .map(([choice, numbers]) => ({
          choice,
          pct: Number(
            (
              numbers.reduce((sum, value) => sum + value, 0) /
              Math.max(1, numbers.length)
            ).toFixed(1)
          ),
        }))
        .sort((a, b) => b.pct - a.pct),
    }))
    .slice(-120);
}

function pollsterSummary(polls = []) {
  const map = new Map();

  for (const poll of polls) {
    const key = poll.pollster || "Unknown";
    const current = map.get(key) || {
      pollster: key,
      polls: 0,
      total_sample: 0,
      latest_date: null,
      populations: new Set(),
      partisan: new Set(),
    };

    current.polls += 1;
    current.total_sample += Number(poll.sample_size || 0);
    current.latest_date =
      !current.latest_date ||
      String(poll.poll_date || poll.end_date || "") > current.latest_date
        ? String(poll.poll_date || poll.end_date || "")
        : current.latest_date;

    if (poll.population) current.populations.add(poll.population);
    if (poll.partisan) current.partisan.add(poll.partisan);

    map.set(key, current);
  }

  return [...map.values()]
    .map((row) => ({
      pollster: row.pollster,
      polls: row.polls,
      average_sample: row.polls
        ? Math.round(row.total_sample / row.polls)
        : 0,
      latest_date: row.latest_date,
      populations: [...row.populations],
      partisan: [...row.partisan],
    }))
    .sort((a, b) => b.polls - a.polls || a.pollster.localeCompare(b.pollster))
    .slice(0, 25);
}

function summarize(polls, rows) {
  const latestDate = polls[0]?.poll_date || polls[0]?.end_date || null;
  const pollsters = new Set(polls.map((poll) => poll.pollster).filter(Boolean));
  const populations = new Set(
    polls.map((poll) => poll.population).filter(Boolean)
  );

  const averageFreshness = polls.length
    ? Math.round(
        polls.reduce(
          (sum, poll) => sum + Number(poll.freshness_score || 0),
          0
        ) / polls.length
      )
    : 0;

  const averageConfidence = polls.length
    ? Math.round(
        polls.reduce(
          (sum, poll) => sum + Number(poll.confidence_score || 0),
          0
        ) / polls.length
      )
    : 0;

  return {
    poll_count: polls.length,
    answer_count: rows.length,
    pollster_count: pollsters.size,
    populations: [...populations].sort(),
    latest_poll_date: latestDate,
    average_freshness: averageFreshness,
    average_confidence: averageConfidence,
    measured_polls: polls.filter((poll) => !poll.is_estimate).length,
    estimated_polls: polls.filter((poll) => poll.is_estimate).length,
  };
}

export async function getExecutivePollingDashboard({
  query = {},
} = {}) {
  const filters = dashboardFilters(query);
  const { rows, schema } = await baseRows({
    filters,
    limit: query.limit || 2000,
  });

  const polls = groupPolls(rows);
  const latestPolls = polls.slice(
    0,
    clamp(query.recent_limit || 30, 1, 100)
  );

  return {
    ok: true,
    build: "5.6.0",
    service: "executive-polling-intelligence",
    configured: schema.exists,
    source: "polling_results",
    attribution: "Polling data powered by VoteHub and stored by VoterSpheres.",
    filters,
    summary: summarize(polls, rows),
    averages: genericBallotAverage(
      polls,
      clamp(query.average_window || 20, 1, 100)
    ),
    trend: trendSeries(polls),
    recent_polls: latestPolls,
    pollsters: pollsterSummary(polls),
    generated_at: new Date().toISOString(),
  };
}

export async function listExecutivePollingRecords({
  query = {},
} = {}) {
  const filters = dashboardFilters(query);
  const { rows, schema } = await baseRows({
    filters,
    limit: query.limit || 250,
  });

  return {
    ok: true,
    configured: schema.exists,
    count: rows.length,
    results: rows,
    filters,
    generated_at: new Date().toISOString(),
  };
}

export async function getExecutivePollingHealth() {
  const schema = await pollingSchema();

  if (!schema.exists) {
    return {
      ok: false,
      build: "5.6.0",
      service: "executive-polling-intelligence",
      configured: false,
      error: "polling_results table does not exist",
      generated_at: new Date().toISOString(),
    };
  }

  const result = await pool.query(`
    SELECT
      COUNT(*)::integer AS answer_rows,
      COUNT(DISTINCT COALESCE(poll_id::text, id::text))::integer AS poll_count,
      MAX(COALESCE(field_end::date, published_at::date, updated_at::date)) AS freshest_record
    FROM polling_results
  `).catch(async () => {
    const columns = schemaExpressions(schema.columns);

    return pool.query(`
      SELECT
        COUNT(*)::integer AS answer_rows,
        COUNT(DISTINCT COALESCE(${columns.pollId}::text, ${columns.id}::text))::integer AS poll_count,
        MAX((${columns.date})::date) AS freshest_record
      FROM polling_results
    `);
  });

  const row = result.rows[0] || {};

  return {
    ok: Number(row.answer_rows || 0) > 0,
    build: "5.6.0",
    service: "executive-polling-intelligence",
    configured: true,
    answer_rows: Number(row.answer_rows || 0),
    poll_count: Number(row.poll_count || 0),
    freshest_record: row.freshest_record || null,
    available_columns: [...schema.columns],
    generated_at: new Date().toISOString(),
  };
}

export default {
  getExecutivePollingDashboard,
  listExecutivePollingRecords,
  getExecutivePollingHealth,
};

