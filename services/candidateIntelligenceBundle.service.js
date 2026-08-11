import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

const BUILD = "4.4.0";

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").trim();

const arr = (value) => Array.isArray(value) ? value : [];

const obj = (value) =>

  value && typeof value === "object" && !Array.isArray(value) ? value : {};

 

function normalizedName(value = "") {

  const parts = clean(value)

    .replace(/,/g, " ")

    .replace(/\s+/g, " ")

    .toLowerCase()

    .split(" ")

    .filter(Boolean);

 

  return parts.length >= 2

    ? [...parts].sort().join(" ")

    : parts.join(" ");

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

    normalizedName(requested) &&

    normalizedName(requested) === normalizedName(displayName(row))

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

 

function selectIdentities(rows, context) {

  const state = clean(context.state).toUpperCase();

  const office = officeKey(context.office);

  const cycle = clean(context.cycle);

 

  return arr(rows)

    .filter((row) => !context.candidate || samePerson(context.candidate, row))

    .filter(

      (row) =>

        !state ||

        clean(row.state_code || row.state).toUpperCase() === state

    )

    .filter((row) => !office || officeKey(row.office) === office)

    .filter(

      (row) =>

        !cycle ||

        !row.election_year ||

        String(row.election_year) === cycle

    )

    .filter(

      (row) =>

        clean(row.fec_candidate_id) ||

        clean(row.campaign_committee_id)

    )

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

 

async function tool(name, args, user) {

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

 

function recommendationsFrom(unified) {

  const data = obj(unified?.data);

 

  return arr(

    data.recommendations ||

      data.strategy_recommendations ||

      data.briefing?.recommendations ||

      data.briefing?.recommended_actions ||

      data.actions

  );

}

 

function signalsFrom(unified) {

  const data = obj(unified?.data);

 

  return arr(

    data.signals ||

      data.political_signals ||

      data.intelligence?.signals ||

      data.briefing?.signals

  );

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

 

  if (!requestedCandidate && !clean(candidateId)) {

    const error = new Error("Candidate name or candidate ID is required.");

    error.status = 400;

    throw error;

  }

 

  const statistics = await tool(

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

 

  const identities = selectIdentities(

    statistics?.data?.candidates,

    {

      candidate: requestedCandidate,

      state,

      office,

      cycle,

    }

  );

 

  const finance = [];

 

  for (const identity of identities) {

    finance.push(

      await tool(

        "get_fec_finance",

        {

          candidate: identity.name || requestedCandidate,

          candidateId: identity.fec_candidate_id || "",

          committeeId: identity.committee_id || "",

          cycle: clean(cycle || identity.election_year),

        },

        user

      )

    );

  }

 

  const polling = await tool(

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

 

  const news = await tool(

    "search_live_news",

    {

      query: requestedCandidate,

      state: clean(state || identities[0]?.state),

      locality: clean(locality),

      limit,

    },

    user

  );

 

  const unified = await tool(

    "get_unified_executive_intelligence",

    {

      workspace_id: workspaceId,

      state: clean(state || identities[0]?.state),

      office: clean(office),

    },

    user

  );

 

  const strategy = recommendationsFrom(unified);

  const signals = signalsFrom(unified);

 

  const allResults = [

    statistics,

    ...finance,

    polling,

    news,

    unified,

  ];

 

  return {

    ok: allResults.some((result) => result?.ok),

    build: BUILD,

    provider: "voterspheres_candidate_intelligence_bundle",

    candidate_query: requestedCandidate,

    identities,

    profile: {

      primary: identities[0]?.record || null,

      candidates: identities.map((identity) => identity.record),

    },

    finance: {

      identity_count: identities.length,

      reports: finance,

    },

    polling: polling?.data || null,

    news: news?.data || null,

    signals,

    strategy: {

      recommendations: strategy,

      source: strategy.length

        ? "VoterSpheres Unified Executive Intelligence"

        : null,

    },

    operations: unified?.data || null,

    coverage: {

      profile: identities.length > 0,

      finance: finance.some((result) => result?.ok),

      polling: Boolean(polling?.ok),

      news: Boolean(news?.ok),

      signals: signals.length > 0,

      strategy: strategy.length > 0,

    },

    sources: mergeSources(allResults),

    warnings: allResults.flatMap((result) => arr(result?.warnings)),

    diagnostics: allResults.flatMap((result) => arr(result?.diagnostics)),

    raw: {

      candidate_statistics: statistics,

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

