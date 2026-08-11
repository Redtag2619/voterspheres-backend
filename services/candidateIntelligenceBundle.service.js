import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

const BUILD = "4.4.1-unified-candidate-intelligence";

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").trim();

const arr = (value) => Array.isArray(value) ? value : [];

const obj = (value) =>

  value && typeof value === "object" && !Array.isArray(value)

    ? value

    : {};

 

function normalizePersonTokens(value = "") {

  return clean(value)

    .toLowerCase()

    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, " ")

    .replace(/[^a-z0-9]+/g, " ")

    .split(/\s+/)

    .map((token) => token.trim())

    .filter(Boolean);

}

 

function candidateNamesMatch(requestedName, candidateName) {

  const requested = normalizePersonTokens(requestedName);

  const candidate = normalizePersonTokens(candidateName);

 

  if (!requested.length || !candidate.length) {

    return false;

  }

 

  if (requested.length === 1) {

    return candidate.includes(requested[0]);

  }

 

  return requested.every((token) => candidate.includes(token));

}

 

function candidateName(record = {}) {

  return clean(

    record.full_name ||

    record.name ||

    record.candidate_name ||

    [record.first_name, record.last_name].filter(Boolean).join(" ")

  );

}

 

function normalizeOffice(value = "") {

  const lower = clean(value)

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, " ")

    .trim();

 

  if (/\bhouse\b|congress/.test(lower)) return "house";

  if (/\bsenate\b|senator/.test(lower)) return "senate";

  if (/president/.test(lower)) return "president";

  if (/governor/.test(lower)) return "governor";

  return lower;

}

 

function verifiedIdentities(rows = [], context = {}) {

  const requestedState = clean(context.state).toUpperCase();

  const requestedOffice = normalizeOffice(context.office);

  const requestedCycle = clean(context.cycle);

 

  return arr(rows)

    .filter((record) => {

      if (!context.candidate) return true;

      return candidateNamesMatch(

        context.candidate,

        candidateName(record)

      );

    })

    .filter((record) => {

      if (!requestedState) return true;

      const state = clean(record.state_code || record.state).toUpperCase();

      return !state || state === requestedState;

    })

    .filter((record) => {

      if (!requestedOffice) return true;

      const office = normalizeOffice(

        record.office || record.office_full || record.office_name

      );

      return !office || office === requestedOffice;

    })

    .filter((record) => {

      if (!requestedCycle) return true;

      return !record.election_year || String(record.election_year) === requestedCycle;

    })

    .filter((record) =>

      Boolean(

        clean(record.fec_candidate_id) ||

        clean(record.campaign_committee_id)

      )

    )

    .map((record) => ({

      id: record.id ?? null,

      candidate: candidateName(record) || context.candidate || null,

      candidate_id: clean(record.fec_candidate_id) || null,

      committee_id: clean(record.campaign_committee_id) || null,

      state: clean(record.state_code || record.state) || null,

      office: clean(record.office || record.office_full || record.office_name) || null,

      district: clean(record.district) || null,

      party: clean(record.party) || null,

      election_year: record.election_year || null,

      incumbent: record.incumbent ?? null,

      status: clean(record.status || record.campaign_status) || null,

      website: clean(record.website) || null,

      record,

    }));

}

 

async function runTool(name, argumentsValue, user) {

  try {

    return await executeExecutiveVoiceTool({

      name,

      arguments: argumentsValue,

      user,

    });

  } catch (error) {

    return {

      ok: false,

      tool: name,

      summary: `${name} failed.`,

      data: null,

      sources: [],

      warnings: [error?.message || "Unknown tool failure."],

      diagnostics: [

        {

          provider: name,

          ok: false,

          error: error?.message || "Unknown tool failure.",

          checked_at: now(),

        },

      ],

      degraded: true,

      generated_at: now(),

    };

  }

}

 

function uniqueSources(results = []) {

  const map = new Map();

 

  for (const result of results) {

    for (const source of arr(result?.sources)) {

      const item = typeof source === "string" ? { source } : obj(source);

      const key = clean(

        item.url ||

        item.source_url ||

        item.source ||

        item.name ||

        item.provider

      ).toLowerCase();

 

      if (!key || map.has(key)) continue;

      map.set(key, item);

    }

  }

 

  return [...map.values()];

}

 

function firstList(data = {}, keys = []) {

  for (const key of keys) {

    if (Array.isArray(data?.[key])) return data[key];

  }

  return [];

}

 

function extractPolls(result) {

  return firstList(result?.data || {}, [

    "polls",

    "records",

    "results",

  ]);

}

 

function extractArticles(result) {

  return firstList(result?.data || {}, [

    "articles",

    "news",

    "records",

    "results",

  ]);

}

 

function extractSignals(result) {

  const data = obj(result?.data);

  return firstList(data, [

    "signals",

    "political_signals",

    "intelligence_signals",

  ]).length

    ? firstList(data, [

        "signals",

        "political_signals",

        "intelligence_signals",

      ])

    : firstList(data?.briefing || {}, ["signals"]);

}

 

function extractStrategies(result) {

  const data = obj(result?.data);

  const direct = firstList(data, [

    "recommendations",

    "strategy_recommendations",

    "recommended_actions",

    "actions",

  ]);

 

  if (direct.length) return direct;

 

  return firstList(data?.briefing || {}, [

    "recommendations",

    "recommended_actions",

    "strategy_recommendations",

  ]);

}

 

export async function getCandidateIntelligenceBundle({

  candidate = "",

  candidateId = "",

  committeeId = "",

  state = "",

  office = "",

  cycle = "",

  locality = "",

  workspaceId = 1,

  limit = 12,

  user = {},

} = {}) {

  const requestedCandidate = clean(candidate);

 

  if (!requestedCandidate && !clean(candidateId)) {

    const error = new Error("Candidate name or candidate ID is required.");

    error.status = 400;

    throw error;

  }

 

  /*

   * 1. Resolve candidate identity from VoterSpheres first.

   */

  const candidateStatistics = await runTool(

    "get_candidate_statistics",

    {

      candidate: requestedCandidate,

      candidate_id: clean(candidateId),

      state: clean(state),

      office: clean(office),

      cycle: clean(cycle),

    },

    user

  );

 

  const identities = verifiedIdentities(

    candidateStatistics?.data?.candidates,

    {

      candidate: requestedCandidate,

      state,

      office,

      cycle,

    }

  );

 

  /*

   * 2. Retrieve official FEC finance for every verified identity.

   *    Use snake_case because executeExecutiveVoiceTool normalizes that

   *    contract before the live OpenFEC provider is called.

   */

  const finance = [];

 

  const financeTargets = identities.length

    ? identities

    : clean(candidateId) || clean(committeeId)

      ? [

          {

            candidate: requestedCandidate || null,

            candidate_id: clean(candidateId) || null,

            committee_id: clean(committeeId) || null,

            state: clean(state) || null,

            office: clean(office) || null,

            district: null,

          },

        ]

      : [];

 

  for (const identity of financeTargets) {

    finance.push(

      await runTool(

        "get_fec_finance",

        {

          candidate: identity.candidate || requestedCandidate,

          candidate_id: identity.candidate_id || "",

          committee_id: identity.committee_id || "",

          cycle: clean(cycle || identity.election_year),

        },

        user

      )

    );

  }

 

  /*

   * 3. Retrieve polling for the candidate/race.

   */

  const polling = await runTool(

    "get_latest_polling",

    {

      candidate: requestedCandidate,

      state: clean(state || identities[0]?.state),

      office: clean(office),

      locality: clean(locality),

      limit,

    },

    user

  );

 

  /*

   * 4. Retrieve current political reporting using only the candidate name

   *    as the news query. This prevents generic briefing phrases from

   *    polluting the search provider request.

   */

  const news = await runTool(

    "search_live_news",

    {

      query: requestedCandidate,

      state: clean(state || identities[0]?.state),

      locality: clean(locality),

      limit,

    },

    user

  );

 

  /*

   * 5. Load existing VoterSpheres executive intelligence for signals and

   *    strategy recommendations. This is analysis from VoterSpheres, not

   *    an external fact provider, and stays clearly separated below.

   */

  const unified = await runTool(

    "get_unified_executive_intelligence",

    {

      workspace_id: workspaceId,

      state: clean(state || identities[0]?.state),

      office: clean(office),

    },

    user

  );

 

  const polls = extractPolls(polling);

  const articles = extractArticles(news);

  const signals = extractSignals(unified);

  const strategies = extractStrategies(unified);

 

  const results = [

    candidateStatistics,

    ...finance,

    polling,

    news,

    unified,

  ];

 

  const coverage = {

    profile: identities.length > 0,

    finance: finance.some((item) => item?.ok),

    polling: Boolean(polling?.ok && polls.length),

    news: Boolean(news?.ok && articles.length),

    signals: signals.length > 0,

    strategy: strategies.length > 0,

  };

 

  return {

    ok: Object.values(coverage).some(Boolean),

    build: BUILD,

    provider: "voterspheres_candidate_intelligence_bundle",

    candidate_query: requestedCandidate || null,

    context: {

      state: clean(state || identities[0]?.state) || null,

      office: clean(office) || null,

      cycle: clean(cycle) || null,

      locality: clean(locality) || null,

      workspace_id: workspaceId,

    },

    identities,

    profile: {

      primary: identities[0]?.record || null,

      candidates: identities.map((identity) => identity.record),

    },

    finance: {

      identity_count: identities.length,

      reports: finance,

    },

    polling: {

      polls,

      raw: polling?.data || null,

    },

    news: {

      articles,

      raw: news?.data || null,

    },

    signals,

    strategy: {

      recommendations: strategies,

      source: strategies.length

        ? "VoterSpheres Unified Executive Intelligence"

        : null,

    },

    operations: unified?.data || null,

    coverage,

    sources: uniqueSources(results),

    warnings: results.flatMap((item) => arr(item?.warnings)),

    diagnostics: results.flatMap((item) => arr(item?.diagnostics)),

    raw: {

      candidate_statistics: candidateStatistics,

      finance,

      polling,

      news,

      unified,

    },

    generated_at: now(),

  };

}

 

export default {

  getCandidateIntelligenceBundle,

};

