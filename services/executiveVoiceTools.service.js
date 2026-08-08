import { pool } from "../db/pool.js";

import { getUnifiedExecutiveIntelligence } from "./unifiedExecutiveIntelligence.service.js";

 

import {

  getCongressUpdates,

  getElectionAdministrationUpdates,

  getOpenFecFinance,

  getPollingProviderData,

  getWeatherFieldRisk,

  searchCandidatePoliticalNews,

  searchCurrentPoliticalNews,

} from "./executiveVoiceLiveSources.service.js";

 

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").trim();

const upper = (value = "") => clean(value).toUpperCase();

 

const STATE_NAME_TO_CODE = Object.freeze({

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

  "WASHINGTON DC": "DC",

  "WASHINGTON D C": "DC",

  DC: "DC",

});

 

const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

 

export function normalizeExecutiveVoiceState(value = "") {

  const raw = upper(value)

    .replace(/[.,]/g, " ")

    .replace(/\s+/g, " ")

    .trim();

 

  if (!raw) return "";

 

  if (

    [

      "US",

      "USA",

      "U S",

      "UNITED STATES",

      "UNITED STATES OF AMERICA",

      "NATIONAL",

      "NATIONWIDE",

    ].includes(raw)

  ) {

    return "US";

  }

 

  if (STATE_CODES.has(raw)) return raw;

  if (STATE_NAME_TO_CODE[raw]) return STATE_NAME_TO_CODE[raw];

 

  const withoutYear = raw.replace(/^(19|20)\d{2}\s+/, "").trim();

  if (STATE_CODES.has(withoutYear)) return withoutYear;

  if (STATE_NAME_TO_CODE[withoutYear]) return STATE_NAME_TO_CODE[withoutYear];

 

  const stateNames = Object.keys(STATE_NAME_TO_CODE).sort(

    (a, b) => b.length - a.length

  );

 

  for (const stateName of stateNames) {

    if (

      withoutYear === stateName ||

      withoutYear.startsWith(`${stateName} `) ||

      withoutYear.endsWith(` ${stateName}`) ||

      withoutYear.includes(` ${stateName} `)

    ) {

      return STATE_NAME_TO_CODE[stateName];

    }

  }

 

  // Preserve unknown geography instead of silently truncating it.

  return clean(value);

}

 

function normalizeToolArgs(args = {}) {

  const next = { ...(args || {}) };

  if (Object.prototype.hasOwnProperty.call(next, "state")) {

    next.state = normalizeExecutiveVoiceState(next.state);

  }

  return next;

}

 

function clamp(value, fallback = 5, min = 1, max = 20) {

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed)

    ? Math.min(max, Math.max(min, parsed))

    : fallback;

}

 

function timestamp(value) {

  const parsed = new Date(value || "").getTime();

  return Number.isFinite(parsed) ? parsed : 0;

}

 

function sortNewest(rows = []) {

  return [...rows].sort(

    (a, b) =>

      timestamp(

        b.published_at || b.field_end || b.updated_at || b.created_at

      ) -

      timestamp(

        a.published_at || a.field_end || a.updated_at || a.created_at

      )

  );

}

 

function dedupe(rows = []) {

  const seen = new Set();

  return rows.filter((row) => {

    const key = clean(

      row?.url || row?.source_url || row?.title || row?.id || row?.poll_id

    ).toLowerCase();

    if (!key || seen.has(key)) return false;

    seen.add(key);

    return true;

  });

}

 

function getFirmId(user = {}) {

  return user.firmId || user.firm_id || user.firm?.id || null;

}

 

function firstValue(...values) {

  return (

    values.find(

      (value) => value !== undefined && value !== null && value !== ""

    ) ?? null

  );

}

 

function uniqueWarnings(warnings = []) {

  return [

    ...new Set(

      warnings

        .flat()

        .filter(Boolean)

        .map((warning) => clean(warning))

        .filter(Boolean)

    ),

  ];

}

 

function toolResult({

  tool,

  ok = true,

  summary = "",

  data = null,

  sources = [],

  warnings = [],

  diagnostics = [],

  degraded = false,

} = {}) {

  return {

    ok,

    tool,

    summary,

    data,

    sources,

    warnings: uniqueWarnings(warnings),

    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],

    degraded: Boolean(degraded),

    generated_at: now(),

  };

}

 

async function safeQuery(key, sql, params = []) {

  try {

    const response = await pool.query(sql, params);

    return {

      key,

      ok: true,

      rows: response.rows || [],

      error: null,

    };

  } catch (error) {

    console.warn(`[executive-voice-tools] ${key} unavailable:`, error.message);

    return {

      key,

      ok: false,

      rows: [],

      error: error.message,

    };

  }

}

 

async function firstAvailable(candidates = []) {

  for (const candidate of candidates) {

    const response = await safeQuery(

      candidate.key,

      candidate.sql,

      candidate.params || []

    );

    if (response.ok) return response;

  }

 

  return {

    key: candidates[0]?.key || "unknown",

    ok: false,

    rows: [],

    error: "No compatible data source is available.",

  };

}

 

function stateProperty() {

  return {

    type: "string",

    description:

      "U.S. state. A full state name such as North Carolina or a two-letter postal code such as NC is accepted; VoterSpheres normalizes it internally.",

  };

}

 

export const EXECUTIVE_VOICE_TOOL_DEFINITIONS = [

  {

    type: "function",

    name: "get_unified_executive_intelligence",

    description:

      "Get the current VoterSpheres executive operating picture, including health, workspaces, tasks, alerts, recommendations, and source freshness. Use for broad executive briefings and cross-platform questions.",

    parameters: {

      type: "object",

      properties: {

        workspace_id: { type: ["number", "string", "null"] },

        state: stateProperty(),

        office: { type: "string" },

        risk: { type: "string" },

      },

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "search_live_news",

    description:

      "Search the newest political reporting. Use for current, latest, today, breaking, or recent public political developments.",

    parameters: {

      type: "object",

      properties: {

        query: { type: "string" },

        state: stateProperty(),

        locality: { type: "string" },

        limit: { type: "integer", minimum: 1, maximum: 10 },

      },

      required: ["query"],

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_candidate_live_intelligence",

    description:

      "Get newest available intelligence about a named political candidate, including current news, polling, finance and campaign developments.",

    parameters: {

      type: "object",

      properties: {

        candidate: { type: "string" },

        candidate_id: { type: ["number", "string", "null"] },

        fec_candidate_id: { type: ["string", "null"] },

        committee_id: { type: ["string", "null"] },

        state: stateProperty(),

        office: { type: "string" },

        locality: { type: "string" },

        cycle: { type: ["integer", "string", "null"] },

        limit: { type: "integer", minimum: 1, maximum: 20 },

      },

      required: ["candidate"],

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_latest_polling",

    description:

      "Get newest available polling. For state polling, pass either the full state name or two-letter code; VoterSpheres normalizes full names automatically.",

    parameters: {

      type: "object",

      properties: {

        state: stateProperty(),

        office: { type: "string" },

        candidate: { type: "string" },

        locality: { type: "string" },

        limit: { type: "integer", minimum: 1, maximum: 20 },

      },

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_fec_finance",

    description:

      "Get latest official federal campaign-finance totals and reporting period from OpenFEC, with local database fallback.",

    parameters: {

      type: "object",

      properties: {

        candidate: { type: "string" },

        candidate_id: { type: "string" },

        committee_id: { type: "string" },

        cycle: { type: ["integer", "string"] },

      },

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_legislative_updates",

    description: "Get newest official legislative updates from Congress.gov.",

    parameters: {

      type: "object",

      properties: {

        query: { type: "string" },

        limit: { type: "integer", minimum: 1, maximum: 25 },

      },

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_weather_field_risk",

    description:

      "Get live official National Weather Service alerts and field-operation risk for coordinates.",

    parameters: {

      type: "object",

      properties: {

        latitude: { type: "number" },

        longitude: { type: "number" },

        location: { type: "string" },

      },

      required: ["latitude", "longitude"],

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_election_administration_updates",

    description:

      "Search newest public election-administration developments, deadlines, voting-system updates and election-official announcements.",

    parameters: {

      type: "object",

      properties: {

        query: { type: "string" },

        state: stateProperty(),

        locality: { type: "string" },

        limit: { type: "integer", minimum: 1, maximum: 10 },

      },

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_state_operations",

    description:

      "Get state, county, parish, workspace, task and operational intelligence for a U.S. state or locality.",

    parameters: {

      type: "object",

      properties: {

        state: stateProperty(),

        locality: { type: "string" },

        workspace_id: { type: ["number", "string", "null"] },

      },

      required: ["state"],

      additionalProperties: false,

    },

  },

  {

    type: "function",

    name: "get_candidate_statistics",

    description:

      "Get stored VoterSpheres candidate profile and campaign statistics. Use for profile/database questions that do not require live news.",

    parameters: {

      type: "object",

      properties: {

        candidate: { type: "string" },

        candidate_id: { type: ["number", "string"] },

        state: stateProperty(),

        office: { type: "string" },

        cycle: { type: ["integer", "string"] },

      },

      additionalProperties: false,

    },

  },

];

 

async function unifiedTool(rawArgs, user) {
  const args = normalizeToolArgs(rawArgs);

  const data = await getUnifiedExecutiveIntelligence({
    user,

    workspaceId:
      args.workspace_id ||
      null,

    state:
      clean(args.state),

    office:
      clean(args.office),

    risk:
      clean(args.risk),
  });

  const sourceStatus =
    Array.isArray(
      data?.source_status
    )
      ? data.source_status
      : [];

  const sourceModules =
    Array.isArray(
      data?.briefing
        ?.source_modules
    )
      ? data.briefing
          .source_modules
      : [];

  const degradedSources =
    Array.isArray(
      data?.briefing
        ?.degraded_sources
    )
      ? data.briefing
          .degraded_sources
      : [];

  const signals =
    Array.isArray(
      data?.signals
    )
      ? data.signals
          .slice(0, 12)
      : [];

  const alerts =
    Array.isArray(
      data?.alerts
    )
      ? data.alerts
          .slice(0, 12)
      : [];

  const recommendations =
    Array.isArray(
      data?.recommendations
    )
      ? data.recommendations
          .slice(0, 12)
      : [];

  const decisionItems =
    Array.isArray(
      data?.decision_intelligence
        ?.items
    )
      ? data.decision_intelligence
          .items
          .slice(0, 10)
      : [];

  const missions =
    Array.isArray(
      data?.missions
    )
      ? data.missions
          .slice(0, 10)
      : [];

  const activity =
    Array.isArray(
      data?.activity
    )
      ? data.activity
          .slice(0, 10)
      : [];

  const workspaces =
    Array.isArray(
      data?.workspaces
    )
      ? data.workspaces
          .slice(0, 12)
      : [];

  const tasks =
    Array.isArray(
      data?.tasks
    )
      ? data.tasks
          .slice(0, 20)
      : [];

  const sources =
    sourceStatus.length
      ? sourceStatus.map(
          (source) => ({
            provider:
              "VoterSpheres",

            source:
              source?.key ||
              "unknown",

            name:
              source?.key ||
              "VoterSpheres intelligence source",

            published_at:
              source?.last_seen ||
              source?.checked_at ||
              data?.generated_at ||
              null,

            fetched_at:
              source?.checked_at ||
              now(),

            confidence:
              source?.ok
                ? data?.health
                    ?.intelligence_confidence ||
                  85
                : 55,

            status:
              source?.status ||
              (
                source?.ok
                  ? "available"
                  : "degraded"
              ),

            freshness:
              source?.freshness ||
              "unknown",

            error:
              source?.error ||
              null,
          })
        )
      : sourceModules.map(
          (sourceName) => ({
            provider:
              "VoterSpheres",

            source:
              sourceName,

            name:
              sourceName,

            published_at:
              data?.generated_at ||
              null,

            fetched_at:
              now(),

            confidence:
              data?.health
                ?.intelligence_confidence ||
              80,

            status:
              degradedSources.includes(
                sourceName
              )
                ? "degraded"
                : "available",
          })
        );

  const voiceData = {
    generated_at:
      data?.generated_at ||
      now(),

    scope:
      data?.scope ||
      {},

    health:
      data?.health ||
      {},

    briefing:
      data?.briefing ||
      {},

    summary:
      data?.summary ||
      {},

    kpis:
      data?.kpis ||
      {},

    source_status:
      sourceStatus,

    workspaces,

    urgent_workspaces:
      Array.isArray(
        data?.urgent_workspaces
      )
        ? data.urgent_workspaces
            .slice(0, 10)
        : [],

    tasks,

    signals,

    alerts,

    recommendations,

    strategy: {
      recommendations:
        Array.isArray(
          data?.strategy
            ?.recommendations
        )
          ? data.strategy
              .recommendations
              .slice(0, 10)
          : [],
    },

    decision_intelligence: {
      items:
        decisionItems,
    },

    missions,

    activity,

    voice_projection: {
      source_count:
        sourceStatus.length ||
        Number(
          data?.summary
            ?.source_count ||
          0
        ),

      available_source_count:
        sourceStatus.filter(
          (source) =>
            source?.status ===
              "available" ||
            source?.ok ===
              true
        ).length,

      degraded_source_count:
        sourceStatus.filter(
          (source) =>
            source?.status ===
              "degraded" ||
            source?.ok ===
              false
        ).length,

      signal_count:
        signals.length,

      alert_count:
        alerts.length,

      recommendation_count:
        recommendations.length,

      decision_count:
        decisionItems.length,

      mission_count:
        missions.length,

      task_count:
        tasks.length,

      workspace_count:
        workspaces.length,
    },
  };

  console.log(
    "[Executive Voice Unified] projection:",
    {
      source_count:
        voiceData
          .voice_projection
          .source_count,

      available_sources:
        voiceData
          .voice_projection
          .available_source_count,

      degraded_sources:
        voiceData
          .voice_projection
          .degraded_source_count,

      signals:
        signals.length,

      alerts:
        alerts.length,

      recommendations:
        recommendations.length,

      decisions:
        decisionItems.length,

      missions:
        missions.length,

      tasks:
        tasks.length,
    }
  );

  return toolResult({
    tool:
      "get_unified_executive_intelligence",

    summary:
      data?.briefing
        ?.strategic_summary ||
      "Unified executive intelligence loaded.",

    data:
      voiceData,

    sources,

    warnings:
      degradedSources.length
        ? [
            `Degraded sources: ${degradedSources.join(
              ", "
            )}`,
          ]
        : [],

    degraded:
      degradedSources.length >
        0 ||
      Boolean(
        data?.summary
          ?.degraded_source_count
      ),
  });
}
 

async function databaseNews({ query, state, locality, limit, user }) {

  const params = [`%${query}%`];

  let where = `

    WHERE (

      COALESCE(title, '') ILIKE $1

      OR COALESCE(summary, '') ILIKE $1

      OR COALESCE(description, '') ILIKE $1

    )

  `;

 

  const firmId = getFirmId(user);

 

  if (firmId) {

    params.push(firmId);

    where += ` AND (firm_id = $${params.length} OR firm_id IS NULL)`;

  }

 

  if (state) {

    params.push(state.toUpperCase());

    where += ` AND UPPER(COALESCE(state, '')) = $${params.length}`;

  }

 

  if (locality) {

    params.push(`%${locality}%`);

    where += ` AND (

      COALESCE(county, '') ILIKE $${params.length}

      OR COALESCE(locality, '') ILIKE $${params.length}

      OR COALESCE(title, '') ILIKE $${params.length}

    )`;

  }

 

  params.push(limit);

 

  const response = await safeQuery(

    "political_signals_news",

    `

      SELECT *

      FROM political_signals

      ${where}

      ORDER BY COALESCE(published_at, updated_at, created_at) DESC

      LIMIT $${params.length}

    `,

    params

  );

 

  return response.rows.map((row) => ({

    id: row.id,

    title: row.title || "Political intelligence article",

    summary:

      row.executive_summary || row.summary || row.description || row.detail || "",

    url: row.source_url || row.url || null,

    publisher: row.publisher || row.source_name || row.source || null,

    published_at: row.published_at || row.updated_at || row.created_at || null,

    state: row.state || null,

    locality: row.county || row.locality || null,

    score: row.signal_score || row.confidence_score || null,

    source_type: "voterspheres_political_signals",

  }));

}

 

async function newsTool(rawArgs, user) {

  const args = normalizeToolArgs(rawArgs);

  const query = clean(args.query);

  const state = clean(args.state);

  const locality = clean(args.locality);

  const limit = clamp(args.limit, 5, 1, 10);

 

  const [live, localRows] = await Promise.all([

    searchCurrentPoliticalNews({ query, state, locality, limit }),

    databaseNews({ query, state, locality, limit, user }),

  ]);

 

  const liveRows = Array.isArray(live?.data?.articles)

    ? live.data.articles

    : [];

 

  const articles = dedupe(sortNewest([...liveRows, ...localRows])).slice(

    0,

    limit

  );

 

  return toolResult({

    tool: "search_live_news",

    ok: articles.length > 0,

    summary: articles.length

      ? `Found ${articles.length} current political reports for ${query}.`

      : `No current reports were found for ${query}.`,

    data: { query, state: state || null, locality: locality || null, articles },

    sources: [

      ...(live?.sources || []),

      ...localRows.map((row) => ({

        source: row.publisher || "VoterSpheres Political Signals",

        source_url: row.url,

        published_at: row.published_at,

        fetched_at: now(),

        confidence: row.score || 78,

      })),

    ],

    warnings: live?.warnings || [],

    diagnostics: live?.diagnostics || [],

    degraded: !live?.ok && localRows.length === 0,

  });

}

 

async function pollingTool(rawArgs = {}) {

  const args = normalizeToolArgs(rawArgs);

  const state = clean(args.state);

  const office = clean(args.office);

  const candidate = clean(args.candidate);

  const locality = clean(args.locality);

  const limit = clamp(args.limit, 10, 1, 20);

 

  console.log("[Executive Voice Polling] normalized arguments:", {

    input_state: rawArgs?.state || null,

    normalized_state: state || null,

    office: office || null,

    candidate: candidate || null,

    locality: locality || null,

    limit,

  });

 

  const live = await getPollingProviderData({

    state,

    office,

    candidate,

    locality,

    limit,

  });

 

  const livePolls = Array.isArray(live?.data?.polls) ? live.data.polls : [];

 

  if (livePolls.length) {

    return toolResult({

      tool: "get_latest_polling",

      ok: true,

      summary:

        live?.summary || `Found ${Math.min(livePolls.length, limit)} polling records.`,

      data: {

        state: state || null,

        office: office || null,

        candidate: candidate || null,

        locality: locality || null,

        polls: sortNewest(livePolls).slice(0, limit),

        provider_priority: live?.data?.provider_priority || "external",

      },

      sources: live?.sources || [],

      warnings: live?.warnings || [],

      diagnostics: live?.diagnostics || [],

      degraded: Boolean(live?.degraded),

    });

  }

 

  const params = [];

  const conditions = [];

 

  if (state) {

    params.push(state.toUpperCase());

    conditions.push(`UPPER(COALESCE(state, '')) = $${params.length}`);

  }

  if (office) {

    params.push(`%${office}%`);

    conditions.push(`COALESCE(office, '') ILIKE $${params.length}`);

  }

  if (candidate) {

    params.push(`%${candidate}%`);

    conditions.push(`COALESCE(candidate_name, '') ILIKE $${params.length}`);

  }

  if (locality) {

    params.push(`%${locality}%`);

    conditions.push(`COALESCE(locality, '') ILIKE $${params.length}`);

  }

 

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);

 

  const response = await firstAvailable([

    {

      key: "polling_results",

      sql: `

        SELECT *

        FROM polling_results

        ${where}

        ORDER BY COALESCE(field_end, published_at, updated_at, created_at) DESC

        LIMIT $${params.length}

      `,

      params,

    },

    {

      key: "polls",

      sql: `

        SELECT *

        FROM polls

        ${where}

        ORDER BY COALESCE(field_end, published_at, updated_at, created_at) DESC

        LIMIT $${params.length}

      `,

      params,

    },

    {

      key: "election_polls",

      sql: `

        SELECT *

        FROM election_polls

        ${where}

        ORDER BY COALESCE(field_end, published_at, updated_at, created_at) DESC

        LIMIT $${params.length}

      `,

      params,

    },

  ]);

 

  return toolResult({

    tool: "get_latest_polling",

    ok: response.rows.length > 0,

    summary: response.rows.length

      ? `Found ${response.rows.length} stored polling records.`

      : "No current polling records are available.",

    data: {

      state: state || null,

      office: office || null,

      candidate: candidate || null,

      locality: locality || null,

      polls: sortNewest(response.rows).slice(0, limit),

      provider_priority: "local-fallback",

    },

    sources: live?.sources || [],

    warnings: [

      ...(live?.warnings || []),

      ...(!response.ok && response.error ? [response.error] : []),

    ],

    diagnostics: live?.diagnostics || [],

    degraded: response.rows.length === 0,

  });

}

 

async function fecTool(args = {}) {

  const candidate = clean(args.candidate);

  const candidateId = clean(args.candidate_id);

  const committeeId = clean(args.committee_id);

  const cycle = clean(args.cycle);

 

  const live = await getOpenFecFinance({

    candidate,

    candidate_id: candidateId,

    committee_id: committeeId,

    cycle,

  });

 

  const liveRecords = Array.isArray(live?.data?.records)

    ? live.data.records

    : Array.isArray(live?.data?.finance)

      ? live.data.finance

      : [];

 

  if (liveRecords.length) {

    return toolResult({

      tool: "get_fec_finance",

      ok: true,

      summary: live?.summary || `Found ${liveRecords.length} FEC finance records.`,

      data: live.data,

      sources: live?.sources || [],

      warnings: live?.warnings || [],

      diagnostics: live?.diagnostics || [],

      degraded: Boolean(live?.degraded),

    });

  }

 

  const params = [];

  const conditions = [];

  if (candidateId) {

    params.push(candidateId);

    conditions.push(`CAST(candidate_id AS text) = $${params.length}`);

  }

  if (committeeId) {

    params.push(committeeId);

    conditions.push(`CAST(committee_id AS text) = $${params.length}`);

  }

  if (cycle) {

    params.push(cycle);

    conditions.push(`CAST(cycle AS text) = $${params.length}`);

  }

 

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

 

  const response = await firstAvailable([

    {

      key: "candidate_finance_summary",

      sql: `

        SELECT * FROM candidate_finance_summary

        ${where}

        ORDER BY COALESCE(coverage_through_date, updated_at, created_at) DESC

        LIMIT 20

      `,

      params,

    },

    {

      key: "fec_candidate_finance",

      sql: `

        SELECT * FROM fec_candidate_finance

        ${where}

        ORDER BY COALESCE(coverage_through_date, updated_at, created_at) DESC

        LIMIT 20

      `,

      params,

    },

  ]);

 

  return toolResult({

    tool: "get_fec_finance",

    ok: response.rows.length > 0,

    summary: response.rows.length

      ? `Found ${response.rows.length} stored campaign-finance records.`

      : "No campaign-finance records matched the request.",

    data: { records: response.rows },

    sources: live?.sources || [],

    warnings: [

      ...(live?.warnings || []),

      ...(!response.ok && response.error ? [response.error] : []),

    ],

    diagnostics: live?.diagnostics || [],

    degraded: response.rows.length === 0,

  });

}

 

async function resolveCandidateProfile(rawArgs = {}) {

  const args = normalizeToolArgs(rawArgs);

  const params = [];

  const conditions = [];

 

  if (args.candidate_id) {

    params.push(clean(args.candidate_id));

    conditions.push(`CAST(id AS text) = $${params.length}`);

  }

  if (args.candidate) {

    params.push(`%${clean(args.candidate)}%`);

    conditions.push(`(

      COALESCE(name, '') ILIKE $${params.length}

      OR (COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE $${params.length}

    )`);

  }

  if (args.state) {

    params.push(upper(args.state));

    conditions.push(`UPPER(COALESCE(state, '')) = $${params.length}`);

  }

  if (args.office) {

    params.push(`%${clean(args.office)}%`);

    conditions.push(`COALESCE(office, '') ILIKE $${params.length}`);

  }

 

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return firstAvailable([

    {

      key: "candidates",

      sql: `

        SELECT *

        FROM candidates

        ${where}

        ORDER BY COALESCE(updated_at, created_at) DESC

        LIMIT 5

      `,

      params,

    },

  ]);

}

 

function candidateDisplayName(candidate) {

  if (!candidate || typeof candidate !== "object") return null;

  return (

    clean(candidate.name) ||

    clean(

      [candidate.first_name, candidate.middle_name, candidate.last_name]

        .filter(Boolean)

        .join(" ")

    ) ||

    null

  );

}

 

async function candidateLiveTool(rawArgs = {}, user = {}) {

  const args = normalizeToolArgs(rawArgs);

  const requestedCandidate = clean(args.candidate);

  const requestedState = clean(args.state);

  const requestedOffice = clean(args.office);

  const requestedLocality = clean(args.locality);

  const requestedCycle = clean(args.cycle);

  const requestedLimit = clamp(args.limit, 10, 1, 20);

 

  const profileResponse = await resolveCandidateProfile(args);

  const profile = profileResponse.rows?.[0] || null;

  const resolvedCandidate = candidateDisplayName(profile) || requestedCandidate;

  const resolvedState = normalizeExecutiveVoiceState(

    firstValue(profile?.state, requestedState) || ""

  );

  const resolvedOffice = clean(firstValue(profile?.office, requestedOffice) || "");

  const resolvedCycle = clean(

    firstValue(profile?.cycle, profile?.election_year, requestedCycle) || ""

  );

  const resolvedFecCandidateId = firstValue(

    args.fec_candidate_id,

    profile?.fec_candidate_id,

    profile?.candidate_id,

    profile?.fec_id

  );

  const resolvedCommitteeId = firstValue(

    args.committee_id,

    profile?.committee_id,

    profile?.principal_committee_id,

    profile?.fec_committee_id

  );

 

  const [liveNews, polling, finance, localNews] = await Promise.all([

    searchCandidatePoliticalNews({

      candidate: resolvedCandidate,

      state: resolvedState,

      office: resolvedOffice,

      locality: requestedLocality,

      limit: requestedLimit,

    }),

    pollingTool({

      candidate: resolvedCandidate,

      state: resolvedState,

      office: resolvedOffice,

      locality: requestedLocality,

      limit: requestedLimit,

    }),

    fecTool({

      candidate: resolvedCandidate,

      candidate_id: resolvedFecCandidateId,

      committee_id: resolvedCommitteeId,

      cycle: resolvedCycle,

    }),

    databaseNews({

      query: resolvedCandidate,

      state: resolvedState,

      locality: requestedLocality,

      limit: requestedLimit,

      user,

    }),

  ]);

 

  const liveArticles = Array.isArray(liveNews?.data?.articles)

    ? liveNews.data.articles

    : [];

  const articles = dedupe(sortNewest([...liveArticles, ...localNews])).slice(

    0,

    requestedLimit

  );

  const polls = Array.isArray(polling?.data?.polls)

    ? polling.data.polls

    : [];

  const financeRecords = Array.isArray(finance?.data?.records)

    ? finance.data.records

    : Array.isArray(finance?.data?.finance)

      ? finance.data.finance

      : [];

 

  const summaryParts = [];

  if (articles.length) summaryParts.push(`${articles.length} current articles`);

  if (polls.length) summaryParts.push(`${polls.length} polling records`);

  if (financeRecords.length)

    summaryParts.push(`${financeRecords.length} finance records`);

 

  const ok = Boolean(profile || articles.length || polls.length || financeRecords.length);

 

  return toolResult({

    tool: "get_candidate_live_intelligence",

    ok,

    summary: ok

      ? `${resolvedCandidate}: ${summaryParts.join(", ") || "candidate profile loaded"}.`

      : `No current intelligence matched ${resolvedCandidate || requestedCandidate}.`,

    data: {

      candidate: resolvedCandidate || requestedCandidate,

      state: resolvedState || null,

      office: resolvedOffice || null,

      cycle: resolvedCycle || null,

      profile,

      articles,

      polls,

      finance: financeRecords,

      newest_article: articles[0] || null,

      newest_poll: polls[0] || null,

      newest_finance_record: financeRecords[0] || null,

    },

    sources: [

      ...(liveNews?.sources || []),

      ...(polling?.sources || []),

      ...(finance?.sources || []),

    ],

    warnings: uniqueWarnings([

      liveNews?.warnings || [],

      polling?.warnings || [],

      finance?.warnings || [],

      profileResponse.ok ? [] : [profileResponse.error],

    ]),

    diagnostics: [

      ...(liveNews?.diagnostics || []),

      ...(polling?.diagnostics || []),

      ...(finance?.diagnostics || []),

    ],

    degraded: Boolean(

      liveNews?.degraded || polling?.degraded || finance?.degraded

    ),

  });

}

 

async function operationsTool(rawArgs = {}, user = {}) {

  const args = normalizeToolArgs(rawArgs);

  const state = clean(args.state);

  const locality = clean(args.locality);

  const workspaceId = args.workspace_id || null;

  const firmId = getFirmId(user);

 

  const params = [];

  const conditions = [];

 

  if (state) {

    params.push(state.toUpperCase());

    conditions.push(`UPPER(COALESCE(state_code, state, '')) = $${params.length}`);

  }

  if (locality) {

    params.push(`%${locality}%`);

    conditions.push(`COALESCE(locality_name, name, county, locality, '') ILIKE $${params.length}`);

  }

  if (firmId) {

    params.push(firmId);

    conditions.push(`(firm_id = $${params.length} OR firm_id IS NULL)`);

  }

  if (workspaceId) {

    params.push(workspaceId);

    conditions.push(`(workspace_id = $${params.length} OR workspace_id IS NULL)`);

  }

 

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const response = await firstAvailable([

    {

      key: "state_localities",

      sql: `

        SELECT * FROM state_localities

        ${where}

        ORDER BY COALESCE(population, 0) DESC

        LIMIT 50

      `,

      params,

    },

    {

      key: "operations_state_localities",

      sql: `

        SELECT * FROM operations_state_localities

        ${where}

        ORDER BY COALESCE(updated_at, created_at) DESC

        LIMIT 50

      `,

      params,

    },

  ]);

 

  return toolResult({

    tool: "get_state_operations",

    ok: response.rows.length > 0,

    summary: response.rows.length

      ? `Found ${response.rows.length} operational records for ${state || "the requested geography"}.`

      : `No state-operations records matched ${state || "the requested geography"}.`,

    data: {

      state: state || null,

      locality: locality || null,

      workspace_id: workspaceId,

      records: response.rows,

    },

    warnings: response.ok ? [] : [response.error],

    degraded: !response.ok,

  });

}

 

async function candidateTool(rawArgs = {}) {

  const args = normalizeToolArgs(rawArgs);

  const response = await resolveCandidateProfile(args);

  return toolResult({

    tool: "get_candidate_statistics",

    ok: response.rows.length > 0,

    summary: response.rows.length

      ? `Found ${response.rows.length} candidate records.`

      : "No candidate record matched the request.",

    data: { candidates: response.rows },

    sources: response.rows.length

      ? [

          {

            source: "VoterSpheres Candidate Database",

            published_at:

              response.rows?.[0]?.updated_at ||

              response.rows?.[0]?.created_at ||

              null,

            fetched_at: now(),

            confidence: 90,

          },

        ]

      : [],

    warnings: response.ok ? [] : [response.error],

    degraded: !response.ok,

  });

}

 

export async function executeExecutiveVoiceTool({

  name,

  arguments: rawArgs = {},

  user = {},

} = {}) {

  const args = normalizeToolArgs(rawArgs);

 

  switch (name) {

    case "get_unified_executive_intelligence":

      return unifiedTool(args, user);

 

    case "search_live_news":

      return newsTool(args, user);

 

    case "get_candidate_live_intelligence":

      return candidateLiveTool(args, user);

 

    case "get_latest_polling":

      return pollingTool(args);

 

    case "get_fec_finance":

      return fecTool(args);

 

    case "get_legislative_updates": {

      const live = await getCongressUpdates(args);

      return toolResult({

        tool: name,

        ok: live?.ok,

        summary: live?.summary,

        data: live?.data,

        sources: live?.sources || [],

        warnings: live?.warnings || [],

        diagnostics: live?.diagnostics || [],

        degraded: Boolean(live?.degraded),

      });

    }

 

    case "get_weather_field_risk": {

      const live = await getWeatherFieldRisk(args);

      return toolResult({

        tool: name,

        ok: live?.ok,

        summary: live?.summary,

        data: live?.data,

        sources: live?.sources || [],

        warnings: live?.warnings || [],

        diagnostics: live?.diagnostics || [],

        degraded: Boolean(live?.degraded),

      });

    }

 

    case "get_election_administration_updates": {

      const live = await getElectionAdministrationUpdates(args);

      return toolResult({

        tool: name,

        ok: live?.ok,

        summary: live?.summary,

        data: live?.data,

        sources: live?.sources || [],

        warnings: live?.warnings || [],

        diagnostics: live?.diagnostics || [],

        degraded: Boolean(live?.degraded),

      });

    }

 

    case "get_state_operations":

      return operationsTool(args, user);

 

    case "get_candidate_statistics":

      return candidateTool(args);

 

    default:

      return toolResult({

        tool: name || "unknown",

        ok: false,

        summary: `Unknown Executive Voice tool: ${name || "missing tool name"}.`,

        warnings: ["The requested tool is not registered."],

        degraded: true,

      });

  }

}
