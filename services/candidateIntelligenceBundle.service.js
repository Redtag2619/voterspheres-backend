import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

/*

 * =========================================================

 * VoterSpheres Build 4.4

 * Unified Candidate Intelligence Bundle

 * FULL REPLACEMENT — RETURN CONTRACT FIX

 * =========================================================

 *

 * Preserves the current retrieval flow:

 *   1. Candidate statistics / verified identity resolution

 *   2. FEC finance for each verified identity

 *   3. Candidate polling

 *   4. Candidate news / articles

 *   5. Unified executive intelligence for signals / strategy

 *

 * Fixes the public return contract expected by

 * executiveIntelligenceOrchestrator.service.js:

 *   - ok

 *   - summary

 *   - data                <-- complete candidate bundle lives here

 *   - records

 *   - count

 *   - sources

 *   - warnings

 *   - diagnostics

 *   - degraded

 *   - generated_at

 *

 * Major bundle fields are also mirrored at top-level for

 * backward compatibility with existing callers.

 */

 

const BUILD = "4.4.1-candidate-bundle-contract";

const PROVIDER = "candidate_intelligence_bundle";

 

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").trim();

const arr = (value) => (Array.isArray(value) ? value : []);

 

function obj(value) {

  return value && typeof value === "object" && !Array.isArray(value)

    ? value

    : {};

}

 

function uniqueStrings(values = []) {

  return [

    ...new Set(

      arr(values)

        .flat(Infinity)

        .map((value) => clean(value))

        .filter(Boolean)

    ),

  ];

}

 

function normalizeName(value = "") {

  return clean(value)

    .replace(/,/g, " ")

    .replace(/\s+/g, " ")

    .trim()

    .toLowerCase();

}

 

function sortedNameKey(value = "") {

  return normalizeName(value)

    .split(" ")

    .filter(Boolean)

    .sort()

    .join(" ");

}

 

function candidateDisplayName(row = {}) {

  return clean(

    row.full_name ||

      row.name ||

      row.candidate_name ||

      [row.first_name, row.last_name].filter(Boolean).join(" ")

  );

}

 

function sameCandidateName(requestedName, row = {}) {

  const requested = sortedNameKey(requestedName);

  const stored = sortedNameKey(candidateDisplayName(row));

 

  return Boolean(requested && stored && requested === stored);

}

 

function normalizeOffice(value = "") {

  const text = clean(value).toLowerCase();

 

  if (!text) return "";

  if (text.includes("senate")) return "senate";

  if (text.includes("house") || text.includes("congress")) return "house";

  if (text.includes("president")) return "president";

  if (text.includes("governor")) return "governor";

 

  return text;

}

 

function normalizeState(value = "") {

  return clean(value).toUpperCase();

}

 

function candidateRowsFromTool(result) {

  const data = obj(result?.data);

 

  if (Array.isArray(data.candidates)) return data.candidates;

  if (Array.isArray(data.records)) return data.records;

  if (Array.isArray(data.results)) return data.results;

  if (Array.isArray(result?.records)) return result.records;

 

  return [];

}

 

function normalizeIdentity(row = {}) {

  return {

    id: row.id ?? null,

    candidate: candidateDisplayName(row) || null,

    name: candidateDisplayName(row) || null,

    party: row.party || null,

    state: row.state_code || row.state || null,

    office: row.office || null,

    district: row.district || null,

    cycle: row.election_year || row.cycle || null,

    election_year: row.election_year || null,

    election_type: row.election_type || null,

    incumbent: row.incumbent ?? null,

    status: row.status || row.campaign_status || null,

    fec_candidate_id: row.fec_candidate_id || row.candidate_id || null,

    committee_id: row.campaign_committee_id || row.committee_id || null,

    campaign_committee_id:

      row.campaign_committee_id || row.committee_id || null,

    campaign_committee_name: row.campaign_committee_name || null,

    website: row.website || null,

    source: row.source || row.contact_source || null,

    record: row,

  };

}

 

function selectVerifiedIdentities(

  rows,

  {

    candidate = "",

    candidateId = "",

    committeeId = "",

    state = "",

    office = "",

    cycle = "",

  } = {}

) {

  const requestedCandidate = clean(candidate);

  const requestedCandidateId = clean(candidateId).toUpperCase();

  const requestedCommitteeId = clean(committeeId).toUpperCase();

  const requestedState = normalizeState(state);

  const requestedOffice = normalizeOffice(office);

  const requestedCycle = clean(cycle);

 

  return arr(rows)

    .map(normalizeIdentity)

    .filter((identity) => {

      if (requestedCandidateId) {

        return (

          clean(identity.fec_candidate_id).toUpperCase() === requestedCandidateId

        );

      }

 

      if (requestedCommitteeId) {

        return clean(identity.committee_id).toUpperCase() === requestedCommitteeId;

      }

 

      if (!requestedCandidate) return true;

 

      return sameCandidateName(requestedCandidate, identity.record);

    })

    .filter(

      (identity) =>

        !requestedState || normalizeState(identity.state) === requestedState

    )

    .filter(

      (identity) =>

        !requestedOffice || normalizeOffice(identity.office) === requestedOffice

    )

    .filter(

      (identity) =>

        !requestedCycle ||

        !identity.cycle ||

        String(identity.cycle) === requestedCycle

    )

    .filter(

      (identity) =>

        clean(identity.fec_candidate_id) || clean(identity.committee_id)

    );

}

 

function financeRecords(result) {

  const data = obj(result?.data);

 

  if (Array.isArray(data.records)) return data.records;

  if (Array.isArray(data.finance)) return data.finance;

  if (Array.isArray(data.results)) return data.results;

  if (Array.isArray(result?.records)) return result.records;

 

  return [];

}

 

function pollingRecords(result) {

  const data = obj(result?.data);

 

  if (Array.isArray(data.polls)) return data.polls;

  if (Array.isArray(data.records)) return data.records;

  if (Array.isArray(data.results)) return data.results;

  if (Array.isArray(result?.records)) return result.records;

 

  return [];

}

 

function newsRecords(result) {

  const data = obj(result?.data);

 

  if (Array.isArray(data.articles)) return data.articles;

  if (Array.isArray(data.news)) return data.news;

  if (Array.isArray(data.records)) return data.records;

  if (Array.isArray(data.results)) return data.results;

  if (Array.isArray(result?.records)) return result.records;

 

  return [];

}

 

function extractStrategyRecommendations(result) {

  const data = obj(result?.data);

  const briefing = obj(data.briefing);

 

  const candidates = [

    data.strategy_recommendations,

    data.recommendations,

    data.actions,

    briefing.strategy_recommendations,

    briefing.recommendations,

    briefing.recommended_actions,

  ];

 

  for (const value of candidates) {

    if (Array.isArray(value)) return value;

  }

 

  return [];

}

 

function extractPoliticalSignals(result) {

  const data = obj(result?.data);

  const briefing = obj(data.briefing);

  const intelligence = obj(data.intelligence);

 

  const candidates = [

    data.political_signals,

    data.signals,

    intelligence.signals,

    briefing.signals,

  ];

 

  for (const value of candidates) {

    if (Array.isArray(value)) return value;

  }

 

  return [];

}

 

function collectSources(results = []) {

  const seen = new Set();

  const output = [];

 

  for (const result of results) {

    for (const source of arr(result?.sources)) {

      const item =

        typeof source === "string"

          ? {

              name: source,

              source,

            }

          : obj(source);

 

      const key = clean(

        item.url ||

          item.source_url ||

          item.name ||

          item.source ||

          item.provider ||

          item.publisher

      ).toLowerCase();

 

      if (!key || seen.has(key)) continue;

 

      seen.add(key);

      output.push(item);

    }

  }

 

  return output;

}

 

function collectDiagnostics(results = []) {

  return results.flatMap((result) => arr(result?.diagnostics));

}

 

function collectWarnings(results = []) {

  return uniqueStrings(

    results.flatMap((result) => arr(result?.warnings))

  );

}

 

function isToolUsable(result, recordCount = 0) {

  return Boolean(

    result?.ok &&

      (recordCount > 0 ||

        arr(result?.sources).length > 0 ||

        clean(result?.summary) ||

        result?.data)

  );

}

 

async function runTool(name, args, user) {

  const startedAt = Date.now();

 

  try {

    const result = await executeExecutiveVoiceTool({

      name,

      arguments: args,

      user,

    });

 

    return {

      ...(result && typeof result === "object" ? result : {}),

      tool: result?.tool || name,

      latency_ms:

        result?.latency_ms ?? Date.now() - startedAt,

    };

  } catch (error) {

    return {

      ok: false,

      tool: name,

      summary: `${name} failed.`,

      data: null,

      records: [],

      sources: [],

      warnings: [error?.message || "Unknown tool failure."],

      diagnostics: [

        {

          provider: name,

          tool: name,

          ok: false,

          error: error?.message || "Unknown tool failure.",

          latency_ms: Date.now() - startedAt,

          checked_at: now(),

        },

      ],

      degraded: true,

      generated_at: now(),

      latency_ms: Date.now() - startedAt,

    };

  }

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

  const startedAt = Date.now();

 

  const requestedCandidate = clean(candidate);

  const requestedCandidateId = clean(candidateId);

  const requestedCommitteeId = clean(committeeId);

  const requestedState = clean(state);

  const requestedOffice = clean(office);

  const requestedCycle = clean(cycle);

  const requestedLocality = clean(locality);

 

  if (

    !requestedCandidate &&

    !requestedCandidateId &&

    !requestedCommitteeId

  ) {

    const error = new Error(

      "Candidate name, candidate ID, or committee ID is required."

    );

 

    error.status = 400;

    throw error;

  }

 

  /*

   * ---------------------------------------------------------

   * 1. Candidate identity / profile

   * ---------------------------------------------------------

   */

 

  const candidateStatistics = await runTool(

    "get_candidate_statistics",

    {

      candidate: requestedCandidate,

      candidate_id: requestedCandidateId,

      fec_candidate_id: requestedCandidateId,

      committee_id: requestedCommitteeId,

      state: requestedState,

      office: requestedOffice,

      cycle: requestedCycle,

      limit,

    },

    user

  );

 

  const candidateRows = candidateRowsFromTool(candidateStatistics);

 

  const identities = selectVerifiedIdentities(candidateRows, {

    candidate: requestedCandidate,

    candidateId: requestedCandidateId,

    committeeId: requestedCommitteeId,

    state: requestedState,

    office: requestedOffice,

    cycle: requestedCycle,

  });

 

  /*

   * ---------------------------------------------------------

   * 2. Official FEC finance — one lookup per verified identity

   * ---------------------------------------------------------

   */

 

  const financeResults = [];

 

  for (const identity of identities) {

    const finance = await runTool(

      "get_fec_finance",

      {

        candidate:

          identity.candidate || requestedCandidate,

 

        /*

         * executeExecutiveVoiceTool expects snake_case tool arguments.

         * fecTool then hands the resolved IDs to the OpenFEC provider.

         */

        candidate_id:

          identity.fec_candidate_id || requestedCandidateId,

 

        committee_id:

          identity.committee_id || requestedCommitteeId,

 

        cycle:

          requestedCycle || clean(identity.cycle),

      },

      user

    );

 

    financeResults.push({

      ...finance,

      identity: {

        candidate: identity.candidate,

        state: identity.state,

        office: identity.office,

        district: identity.district,

        fec_candidate_id: identity.fec_candidate_id,

        committee_id: identity.committee_id,

        cycle: identity.cycle,

      },

    });

  }

 

  /*

   * ---------------------------------------------------------

   * 3. Polling

   * ---------------------------------------------------------

   */

 

  const polling = await runTool(

    "get_latest_polling",

    {

      candidate: requestedCandidate || identities[0]?.candidate || "",

      candidate_id:

        requestedCandidateId || identities[0]?.fec_candidate_id || "",

      state: requestedState || identities[0]?.state || "",

      office: requestedOffice || "",

      locality: requestedLocality,

      cycle: requestedCycle,

      limit,

    },

    user

  );

 

  /*

   * ---------------------------------------------------------

   * 4. Current news / articles

   * ---------------------------------------------------------

   */

 

  const news = await runTool(

    "search_live_news",

    {

      query: requestedCandidate || identities[0]?.candidate || "",

      candidate: requestedCandidate || identities[0]?.candidate || "",

      state: requestedState || identities[0]?.state || "",

      office: requestedOffice || "",

      locality: requestedLocality,

      cycle: requestedCycle,

      limit,

    },

    user

  );

 

  /*

   * ---------------------------------------------------------

   * 5. Unified VoterSpheres operating context, signals, strategy

   * ---------------------------------------------------------

   */

 

  const unified = await runTool(

    "get_unified_executive_intelligence",

    {

      workspace_id: workspaceId,

      candidate: requestedCandidate || identities[0]?.candidate || "",

      candidate_id:

        requestedCandidateId || identities[0]?.fec_candidate_id || "",

      state: requestedState || identities[0]?.state || "",

      office: requestedOffice || "",

      locality: requestedLocality,

      cycle: requestedCycle,

      limit,

    },

    user

  );

 

  const financeReports = financeResults.map((result) => ({

    identity: result.identity,

    ok: Boolean(result.ok),

    summary: result.summary || "",

    data: result.data ?? null,

    records: financeRecords(result),

    sources: arr(result.sources),

    warnings: arr(result.warnings),

    diagnostics: arr(result.diagnostics),

    degraded: Boolean(result.degraded),

    generated_at: result.generated_at || null,

  }));

 

  const polls = pollingRecords(polling);

  const articles = newsRecords(news);

  const signals = extractPoliticalSignals(unified);

  const recommendations = extractStrategyRecommendations(unified);

 

  const allResults = [

    candidateStatistics,

    ...financeResults,

    polling,

    news,

    unified,

  ];

 

  const sources = collectSources(allResults);

  const warnings = collectWarnings(allResults);

  const diagnostics = collectDiagnostics(allResults);

 

  const coverage = {

    profile: identities.length > 0,

    finance: financeReports.some(

      (report) => report.ok && report.records.length > 0

    ),

    polling: isToolUsable(polling, polls.length),

    news: isToolUsable(news, articles.length),

    signals: signals.length > 0,

    strategy: recommendations.length > 0,

  };

 

  const usableSectionCount = Object.values(coverage).filter(Boolean).length;

  const sectionCount = Object.keys(coverage).length;

 

  const data = {

    build: BUILD,

    provider: PROVIDER,

 

    candidate_query:

      requestedCandidate || identities[0]?.candidate || null,

 

    context: {

      candidate:

        requestedCandidate || identities[0]?.candidate || null,

      candidate_id:

        requestedCandidateId || null,

      committee_id:

        requestedCommitteeId || null,

      state:

        requestedState || identities[0]?.state || null,

      office:

        requestedOffice || null,

      cycle:

        requestedCycle || identities[0]?.cycle || null,

      locality:

        requestedLocality || null,

      workspace_id: workspaceId,

      limit,

    },

 

    identities,

 

    profile: {

      primary: identities[0]?.record || null,

      candidates: identities.map((identity) => identity.record),

      identity_count: identities.length,

      source_tool: "get_candidate_statistics",

    },

 

    finance: {

      identity_count: identities.length,

      reports: financeReports,

      records: financeReports.flatMap((report) => report.records),

      source_tool: "get_fec_finance",

    },

 

    polling: {

      ...(obj(polling?.data)),

      polls,

      records: polls,

      count: polls.length,

      summary: polling?.summary || "",

      source_tool: "get_latest_polling",

      degraded: Boolean(polling?.degraded),

    },

 

    news: {

      ...(obj(news?.data)),

      articles,

      records: articles,

      count: articles.length,

      summary: news?.summary || "",

      source_tool: "search_live_news",

      degraded: Boolean(news?.degraded),

    },

 

    signals,

 

    strategy: {

      recommendations,

      count: recommendations.length,

      source:

        recommendations.length > 0

          ? "VoterSpheres Unified Executive Intelligence"

          : null,

      source_tool: "get_unified_executive_intelligence",

    },

 

    operations: unified?.data ?? null,

 

    coverage,

 

    summary: {

      verified_identity_count: identities.length,

      finance_report_count: financeReports.filter((report) => report.ok).length,

      finance_record_count: financeReports.reduce(

        (sum, report) => sum + report.records.length,

        0

      ),

      polling_record_count: polls.length,

      news_article_count: articles.length,

      political_signal_count: signals.length,

      strategy_recommendation_count: recommendations.length,

      usable_section_count: usableSectionCount,

      section_count: sectionCount,

    },

 

    sources,

    warnings,

    diagnostics,

 

    raw: {

      candidate_statistics: candidateStatistics,

      finance: financeResults,

      polling,

      news,

      unified,

    },

 

    generated_at: now(),

  };

 

  const ok = Boolean(

    coverage.profile ||

      coverage.finance ||

      coverage.polling ||

      coverage.news ||

      coverage.signals ||

      coverage.strategy

  );

 

  const degraded = Boolean(

    !ok ||

      usableSectionCount < sectionCount ||

      allResults.some((result) => Boolean(result?.degraded))

  );

 

  const summaryParts = [

    `${identities.length} verified candidate identit${

      identities.length === 1 ? "y" : "ies"

    }`,

    `${data.summary.finance_record_count} FEC finance record${

      data.summary.finance_record_count === 1 ? "" : "s"

    }`,

    `${polls.length} polling record${polls.length === 1 ? "" : "s"}`,

    `${articles.length} news article${articles.length === 1 ? "" : "s"}`,

    `${signals.length} political signal${signals.length === 1 ? "" : "s"}`,

    `${recommendations.length} strategy recommendation${

      recommendations.length === 1 ? "" : "s"

    }`,

  ];

 

  const summary = ok

    ? `Unified candidate intelligence loaded for ${

        requestedCandidate || identities[0]?.candidate || "the requested candidate"

      }: ${summaryParts.join(", ")}.`

    : `No verified candidate intelligence was available for ${

        requestedCandidate || "the requested candidate"

      }.`;

 

  /*

   * =========================================================

   * CRITICAL RETURN CONTRACT

   * =========================================================

   *

   * The orchestrator reads result.data when it normalizes this tool.

   * Therefore the COMPLETE bundle must live under data.

   *

   * Top-level mirrors remain for compatibility with any callers that

   * consumed the pre-fix bundle shape directly.

   */

 

  return {

    ok,

    configured: true,

    provider: PROVIDER,

    tool: "get_candidate_intelligence_bundle",

    build: BUILD,

    summary,

 

    data,

 

    records: identities,

    count: identities.length,

 

    sources,

    warnings,

    diagnostics,

    degraded,

    cached: false,

    stale: false,

 

    latency_ms: Date.now() - startedAt,

    generated_at: data.generated_at,

 

    /* Backward-compatible mirrors */

    candidate_query: data.candidate_query,

    context: data.context,

    identities: data.identities,

    profile: data.profile,

    finance: data.finance,

    polling: data.polling,

    news: data.news,

    signals: data.signals,

    strategy: data.strategy,

    operations: data.operations,

    coverage: data.coverage,

    raw: data.raw,

  };

}

 

export default {

  getCandidateIntelligenceBundle,

};
