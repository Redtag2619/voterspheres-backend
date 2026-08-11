import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

const BUILD = "4.4.1-unified-candidate-intelligence";

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").trim();

const arr = (value) => Array.isArray(value) ? value : [];

const obj = (value) =>

  value && typeof value === "object" && !Array.isArray(value) ? value : {};

 

function normalizePersonName(value = "") {

  const parts = clean(value)

    .replace(/,/g, " ")

    .replace(/\s+/g, " ")

    .toLowerCase()

    .split(" ")

    .filter(Boolean);

 

  return parts.length >= 2 ? [...parts].sort().join(" ") : parts.join(" ");

}

 

function displayName(row = {}) {

  return clean(

    row.full_name ||

      row.name ||

      [row.first_name, row.last_name].filter(Boolean).join(" ")

  );

}

 

function samePerson(requested, row) {

  return (

    normalizePersonName(requested) &&

    normalizePersonName(requested) === normalizePersonName(displayName(row))

  );

}

 

function officeKey(value = "") {

  const text = clean(value).toLowerCase();

  if (text.includes("senate")) return "senate";

  if (text.includes("house") || text.includes("congress")) return "house";

  if (text.includes("president")) return "president";

  if (text.includes("governor")) return "governor";

  return text;

}

 

async function runTool(name, args, user) {

  try {

    return await executeExecutiveVoiceTool({

      name,

      arguments: args,

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

 

function selectIdentities(rows, {

  candidate = "",

  candidateId = "",

  state = "",

  office = "",

  cycle = "",

} = {}) {

  const requestedId = clean(candidateId).toUpperCase();

  const requestedState = clean(state).toUpperCase();

  const requestedOffice = officeKey(office);

  const requestedCycle = clean(cycle);

 

  return arr(rows)

    .filter((row) => {

      if (requestedId) {

        return clean(row.fec_candidate_id).toUpperCase() === requestedId;

      }

      return !candidate || samePerson(candidate, row);

    })

    .filter(

      (row) =>

        !requestedState ||

        clean(row.state_code || row.state).toUpperCase() === requestedState

    )

    .filter(

      (row) =>

        !requestedOffice ||

        officeKey(row.office) === requestedOffice

    )

    .filter(

      (row) =>

        !requestedCycle ||

        !row.election_year ||

        String(row.election_year) === requestedCycle

    )

    .filter((row) => clean(row.fec_candidate_id))

    .map((row) => ({

      id: row.id ?? null,

      name: displayName(row),

      party: row.party || null,

      state: row.state_code || row.state || null,

      office: row.office || null,

      district: row.district || null,

      election_year: row.election_year || null,

      incumbent: row.incumbent ?? null,

      status: row.status || row.campaign_status || null,

      fec_candidate_id: row.fec_candidate_id || null,

      committee_id: row.campaign_committee_id || null,

      website: row.website || null,

      record: row,

    }));

}

 

function collectRecords(data) {

  const value = obj(data);

  const candidates = [

    value.records,

    value.results,

    value.items,

    value.articles,

    value.news,

    value.polls,

    value.polling,

    value.signals,

    value.recommendations,

    value.strategy_recommendations,

  ];

 

  for (const candidate of candidates) {

    if (Array.isArray(candidate)) return candidate;

  }

 

  return [];

}

 

function collectRecommendations(unifiedResult) {

  const data = obj(unifiedResult?.data);

 

  const candidates = [

    data.recommendations,

    data.strategy_recommendations,

    data.briefing?.recommendations,

    data.briefing?.recommended_actions,

    data.actions,

  ];

 

  for (const candidate of candidates) {

    if (Array.isArray(candidate)) return candidate;

  }

 

  return [];

}

 

function collectSignals(unifiedResult) {

  const data = obj(unifiedResult?.data);

 

  const candidates = [

    data.signals,

    data.political_signals,

    data.intelligence?.signals,

    data.briefing?.signals,

  ];

 

  for (const candidate of candidates) {

    if (Array.isArray(candidate)) return candidate;

  }

 

  return [];

}

 

function mergeSources(results) {

  const seen = new Set();

  const output = [];

 

  for (const source of results.flatMap((result) => arr(result?.sources))) {

    const item = typeof source === "string" ? { source } : obj(source);

    const key = clean(

      item.url ||

        item.source_url ||

        item.source ||

        item.name ||

        item.provider

    );

 

    if (!key || seen.has(key)) continue;

 

    seen.add(key);

    output.push(item);

  }

 

  return output;

}

 

export async function getCandidateIntelligenceBundle({

  candidate = "",

  candidateId = "",

  state = "",

  office = "",

  cycle = "",

  locality = "",

  workspaceId = 1,

  limit = 12,

  user = {},

} = {}) {

  const requestedCandidate = clean(candidate);

  const requestedCandidateId = clean(candidateId);

 

  if (!requestedCandidate && !requestedCandidateId) {

    const error = new Error("Candidate name or candidate ID is required.");

    error.status = 400;

    throw error;

  }

 

  /*

   * 1. Resolve identity from the working VoterSpheres candidate database.

   * This is the same identity source already proven to return Crockett's

   * House H2TX30178 and Senate S6TX00552 records.

   */

  const statistics = await runTool(

    "get_candidate_statistics",

    {

      candidate: requestedCandidate,

      candidate_id: requestedCandidateId,

      state: clean(state),

      office: clean(office),

      cycle: clean(cycle),

    },

    user

  );

 

  const identities = selectIdentities(

    statistics?.data?.candidates,

    {

      candidate: requestedCandidate,

      candidateId: requestedCandidateId,

      state,

      office,

      cycle,

    }

  );

 

  /*

   * 2. FEC finance is executed once per VERIFIED identity.

   * We never use polling/news to resolve finance identity.

   */

  const financeReports = [];

 

  for (const identity of identities) {

    const result = await runTool(

      "get_fec_finance",

      {

        candidate: identity.name || requestedCandidate,

        candidate_id: identity.fec_candidate_id,

        committee_id: identity.committee_id || "",

        cycle: clean(cycle || identity.election_year),

      },

      user

    );

 

    financeReports.push({

      identity: {

        name: identity.name,

        state: identity.state,

        office: identity.office,

        district: identity.district,

        fec_candidate_id: identity.fec_candidate_id,

        committee_id: identity.committee_id,

      },

      ...result,

    });

  }

 

  /*

   * 3. Polling and news use the candidate name, not the entire user prompt.

   * This prevents searches like:

   * "give me a complete briefing on jasmine crockett"

   * from being passed verbatim to the news provider.

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

 

  const news = await runTool(

    "search_live_news",

    {

      query: requestedCandidate,

      candidate: requestedCandidate,

      state: clean(state || identities[0]?.state),

      locality: clean(locality),

      limit,

    },

    user

  );

 

  /*

   * 4. Existing VoterSpheres unified intelligence supplies political signals

   * and existing strategy recommendations. It is supporting context only.

   * Candidate identity remains anchored to get_candidate_statistics.

   */

  const unified = await runTool(

    "get_unified_executive_intelligence",

    {

      workspace_id: workspaceId,

      state: clean(state || identities[0]?.state),

      office: clean(office),

      candidate: requestedCandidate,

      cycle: clean(cycle),

    },

    user

  );

 

  const strategyRecommendations = collectRecommendations(unified);

  const politicalSignals = collectSignals(unified);

 

  const allResults = [

    statistics,

    ...financeReports,

    polling,

    news,

    unified,

  ];

 

  return {

    ok: identities.length > 0 && allResults.some((result) => result?.ok),

    build: BUILD,

    provider: "voterspheres_candidate_intelligence_bundle",

    candidate_query: requestedCandidate,

    candidate_id_query: requestedCandidateId || null,

 

    identities,

 

    profile: {

      primary: identities[0]?.record || null,

      candidates: identities.map((identity) => identity.record),

    },

 

    finance: {

      identity_count: identities.length,

      reports: financeReports,

    },

 

    polling: {

      ok: Boolean(polling?.ok),

      summary: polling?.summary || "",

      records: collectRecords(polling?.data),

      data: polling?.data || null,

      sources: arr(polling?.sources),

    },

 

    news: {

      ok: Boolean(news?.ok),

      summary: news?.summary || "",

      records: collectRecords(news?.data),

      data: news?.data || null,

      sources: arr(news?.sources),

    },

 

    signals: politicalSignals,

 

    strategy: {

      recommendations: strategyRecommendations,

      source: strategyRecommendations.length

        ? "VoterSpheres Unified Executive Intelligence"

        : null,

    },

 

    operations: unified?.data || null,

 

    coverage: {

      identity: identities.length > 0,

      profile: identities.length > 0,

      finance: financeReports.some((result) => result?.ok),

      polling: Boolean(polling?.ok),

      news: Boolean(news?.ok),

      signals: politicalSignals.length > 0,

      strategy: strategyRecommendations.length > 0,

    },

 

    sources: mergeSources(allResults),

 

    warnings: allResults.flatMap((result) => arr(result?.warnings)),

    diagnostics: allResults.flatMap((result) => arr(result?.diagnostics)),

 

    raw: {

      candidate_statistics: statistics,

      finance: financeReports,

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
