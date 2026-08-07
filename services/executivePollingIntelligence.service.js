import { pool } from "../db/pool.js";

 

const clean = (value = "") => String(value ?? "").trim();

const lower = (value = "") => clean(value).toLowerCase();

const upper = (value = "") => clean(value).toUpperCase();

 

const clamp = (value, minimum, maximum) =>

  Math.min(maximum, Math.max(minimum, Number(value) || minimum));

 

const normalizeState = (value = "") => {

  const next = upper(value);

  if (!next || next === "US" || next === "USA" || next === "NATIONAL") return "US";

  return next.slice(0, 2);

};

 

const normalizePollType = (value = "") => lower(value);

const normalizePopulation = (value = "") => lower(value);

 

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

 

function buildWhere(filters = {}) {

  const params = [];

  const conditions = [];

 

  const push = (value) => {

    params.push(value);

    return `$${params.length}`;

  };

 

  if (filters.state && filters.state !== "US") {

    conditions.push(`UPPER(COALESCE(state, 'US')) = ${push(filters.state)}`);

  }

 

  if (filters.pollType) {

    conditions.push(`LOWER(COALESCE(poll_type, '')) = ${push(filters.pollType)}`);

  }

 

  if (filters.population) {

    conditions.push(`LOWER(COALESCE(population, '')) = ${push(filters.population)}`);

  }

 

  if (filters.pollster) {

    conditions.push(`COALESCE(pollster, '') ILIKE ${push(`%${filters.pollster}%`)}`);

  }

 

  if (filters.subject) {

    conditions.push(`COALESCE(subject, '') ILIKE ${push(`%${filters.subject}%`)}`);

  }

 

  if (filters.measuredOnly) {

    conditions.push(`COALESCE(is_estimate, FALSE) = FALSE`);

  }

 

  if (filters.startDate) {

    conditions.push(

      `COALESCE(field_end, published_at::date, updated_at::date) >= ${push(filters.startDate)}::date`

    );

  }

 

  if (filters.endDate) {

    conditions.push(

      `COALESCE(field_end, published_at::date, updated_at::date) <= ${push(filters.endDate)}::date`

    );

  }

 

  return {

    params,

    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",

  };

}

 

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

 

async function baseRows({ filters, limit = 2500 } = {}) {

  const exists = await tableExists("polling_results");

  if (!exists) return [];

 

  const where = buildWhere(filters);

  const safeLimit = clamp(limit, 1, 5000);

 

  const result = await pool.query(

    `

      SELECT

        id,

        poll_id,

        poll_type,

        COALESCE(state, 'US') AS state,

        district,

        office,

        race_name,

        pollster,

        sponsor,

        population,

        subject,

        COALESCE(answer, candidate_name) AS choice,

        pct,

        sample_size,

        partisan,

        source,

        source_url,

        field_start AS start_date,

        field_end AS end_date,

        COALESCE(field_end, published_at::date, updated_at::date) AS poll_date,

        confidence_score,

        freshness_score,

        record_type,

        COALESCE(is_estimate, FALSE) AS is_estimate

      FROM polling_results

      ${where.whereSql}

      ORDER BY

        COALESCE(field_end, published_at::date, updated_at::date) DESC NULLS LAST,

        pollster ASC NULLS LAST,

        poll_id ASC NULLS LAST

      LIMIT ${safeLimit}

    `,

    where.params

  );

 

  return result.rows;

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

    row.race_name,

  ].join("|");

}

 

function groupPolls(rows = []) {

  const groups = new Map();

 

  for (const row of rows) {

    const key = uniquePollKey(row);

 

    if (!groups.has(key)) {

      groups.set(key, {

        id: row.poll_id || String(row.id || key),

        poll_type: row.poll_type || "unknown",

        state: row.state || "US",

        district: row.district || null,

        office: row.office || null,

        race_name: row.race_name || null,

        pollster: row.pollster || "Unknown",

        sponsor: row.sponsor || null,

        population: row.population || null,

        subject: row.subject || null,

        sample_size: row.sample_size,

        partisan: row.partisan || null,

        source: row.source || "VoteHub",

        source_url: row.source_url || null,

        start_date: row.start_date || null,

        end_date: row.end_date || null,

        poll_date: row.poll_date || null,

        confidence_score: Number(row.confidence_score || 0),

        freshness_score: Number(row.freshness_score || 0),

        record_type: row.record_type || "measured_poll",

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

 

function pollingAverage(polls = [], pollType = "", windowSize = 20) {

  const targetType = pollType || "generic-ballot";

  const latest = polls

    .filter((poll) => lower(poll.poll_type) === targetType)

    .slice(0, windowSize);

 

  const values = new Map();

 

  for (const poll of latest) {

    for (const answer of poll.answers) {

      const choice = clean(answer.choice);

      if (!choice) continue;

 

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

 

function trendSeries(polls = [], pollType = "") {

  const targetType = pollType || "generic-ballot";

  const relevant = polls.filter(

    (poll) => lower(poll.poll_type) === targetType

  );

 

  const byDate = new Map();

 

  for (const poll of [...relevant].reverse()) {

    const date = String(poll.poll_date || poll.end_date || "");

    if (!date) continue;

 

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

      poll_types: new Set(),

    };

 

    current.polls += 1;

    current.total_sample += Number(poll.sample_size || 0);

 

    const date = String(poll.poll_date || poll.end_date || "");

    if (!current.latest_date || date > current.latest_date) {

      current.latest_date = date;

    }

 

    if (poll.population) current.populations.add(poll.population);

    if (poll.partisan) current.partisan.add(poll.partisan);

    if (poll.poll_type) current.poll_types.add(poll.poll_type);

 

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

      poll_types: [...row.poll_types],

    }))

    .sort((a, b) => b.polls - a.polls || a.pollster.localeCompare(b.pollster))

    .slice(0, 50);

}

 

function pollTypeSummary(polls = []) {

  const counts = new Map();

 

  for (const poll of polls) {

    const type = lower(poll.poll_type) || "unknown";

    counts.set(type, (counts.get(type) || 0) + 1);

  }

 

  return [...counts.entries()]

    .map(([poll_type, pollsCount]) => ({

      poll_type,

      polls: pollsCount,

    }))

    .sort((a, b) => b.polls - a.polls || a.poll_type.localeCompare(b.poll_type));

}

 

function summarize(polls = [], rows = []) {

  const latestDate = polls[0]?.poll_date || polls[0]?.end_date || null;

  const pollsters = new Set(polls.map((poll) => poll.pollster).filter(Boolean));

  const populations = new Set(polls.map((poll) => poll.population).filter(Boolean));

  const types = new Set(polls.map((poll) => poll.poll_type).filter(Boolean));

 

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

    poll_type_count: types.size,

    poll_types: [...types].sort(),

    populations: [...populations].sort(),

    latest_poll_date: latestDate,

    average_freshness: averageFreshness,

    average_confidence: averageConfidence,

    measured_polls: polls.filter((poll) => !poll.is_estimate).length,

    estimated_polls: polls.filter((poll) => poll.is_estimate).length,

  };

}

 

export async function getExecutivePollingDashboard({ query = {} } = {}) {

  const filters = dashboardFilters(query);

  const rows = await baseRows({

    filters,

    limit: query.limit || 3000,

  });

 

  const polls = groupPolls(rows);

  const recentPolls = polls.slice(

    0,

    clamp(query.recent_limit || 30, 1, 100)

  );

 

  const averagePollType = filters.pollType || "generic-ballot";

 

  return {

    ok: true,

    build: "5.7.1",

    service: "executive-polling-intelligence",

    configured: await tableExists("polling_results"),

    source: "polling_results",

    attribution: "Polling data powered by VoteHub and stored by VoterSpheres.",

    filters,

    summary: summarize(polls, rows),

    poll_types: pollTypeSummary(polls),

    average_poll_type: averagePollType,

    averages: pollingAverage(

      polls,

      filters.pollType,

      clamp(query.average_window || 20, 1, 100)

    ),

    trend: trendSeries(polls, filters.pollType),

    recent_polls: recentPolls,

    pollsters: pollsterSummary(polls),

    generated_at: new Date().toISOString(),

  };

}

 

export async function listExecutivePollingRecords({ query = {} } = {}) {

  const filters = dashboardFilters(query);

  const rows = await baseRows({

    filters,

    limit: query.limit || 500,

  });

 

  return {

    ok: true,

    configured: await tableExists("polling_results"),

    count: rows.length,

    results: rows,

    filters,

    generated_at: new Date().toISOString(),

  };

}

 

export async function getExecutivePollingHealth() {

  const exists = await tableExists("polling_results");

 

  if (!exists) {

    return {

      ok: false,

      build: "5.7.1",

      service: "executive-polling-intelligence",

      configured: false,

      error: "polling_results table does not exist",

      generated_at: new Date().toISOString(),

    };

  }

 

  const result = await pool.query(`

    SELECT

      COUNT(*)::integer AS answer_rows,

      COUNT(DISTINCT COALESCE(poll_id, id::text))::integer AS poll_count,

      COUNT(DISTINCT NULLIF(pollster, ''))::integer AS pollster_count,

      COUNT(DISTINCT NULLIF(poll_type, ''))::integer AS poll_type_count,

      MAX(COALESCE(field_end, published_at::date, updated_at::date)) AS freshest_record

    FROM polling_results

  `);

 

  const row = result.rows[0] || {};

 

  const types = await pool.query(`

    SELECT

      COALESCE(NULLIF(LOWER(poll_type), ''), 'unknown') AS poll_type,

      COUNT(DISTINCT COALESCE(poll_id, id::text))::integer AS polls,

      COUNT(*)::integer AS answer_rows

    FROM polling_results

    GROUP BY 1

    ORDER BY polls DESC, poll_type

  `);

 

  return {

    ok: Number(row.answer_rows || 0) > 0,

    build: "5.7.1",

    service: "executive-polling-intelligence",

    configured: true,

    answer_rows: Number(row.answer_rows || 0),

    poll_count: Number(row.poll_count || 0),

    pollster_count: Number(row.pollster_count || 0),

    poll_type_count: Number(row.poll_type_count || 0),

    freshest_record: row.freshest_record || null,

    poll_types: types.rows,

    generated_at: new Date().toISOString(),

  };

}

 

export default {

  getExecutivePollingDashboard,

  listExecutivePollingRecords,

  getExecutivePollingHealth,

};
