import OpenAI from "openai";

 

import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

import { getCandidateIntelligenceBundle } from "./candidateIntelligenceBundle.service.js";

 

const BUILD = "4.4.1-unified-candidate-intelligence";

 

const ORCHESTRATOR_TIMEOUT_MS =

  Number(process.env.EXECUTIVE_ORCHESTRATOR_TIMEOUT_MS) || 70000;

 

const TOOL_TIMEOUT_MS =

  Number(process.env.EXECUTIVE_ORCHESTRATOR_TOOL_TIMEOUT_MS) || 30000;

 

const SYNTHESIS_TIMEOUT_MS =

  Number(process.env.EXECUTIVE_ORCHESTRATOR_SYNTHESIS_TIMEOUT_MS) || 25000;

 

const MODEL =

  process.env.EXECUTIVE_ORCHESTRATOR_MODEL || "gpt-5-mini";

 

const openai = process.env.OPENAI_API_KEY

  ? new OpenAI({

      apiKey: process.env.OPENAI_API_KEY,

      timeout: SYNTHESIS_TIMEOUT_MS,

      maxRetries: 1,

    })

  : null;

 

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").trim();

const arr = (value) => Array.isArray(value) ? value : [];

const obj = (value) =>

  value && typeof value === "object" && !Array.isArray(value) ? value : {};

 

const STATE_NAMES = Object.freeze({

  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",

  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",

  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",

  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",

  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",

  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",

  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",

  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",

  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",

  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",

  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",

  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",

  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",

});

 

const STATE_CODES = Object.fromEntries(

  Object.entries(STATE_NAMES).map(([code, name]) => [

    name.toLowerCase(),

    code,

  ])

);

 

function withTimeout(promise, timeoutMs, label) {

  let timer;

 

  const timeout = new Promise((_resolve, reject) => {

    timer = setTimeout(() => {

      reject(

        Object.assign(

          new Error(`${label} timed out after ${timeoutMs}ms.`),

          { code: "ORCHESTRATOR_TIMEOUT" }

        )

      );

    }, timeoutMs);

  });

 

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));

}

 

function clamp(value, fallback = 12, min = 1, max = 25) {

  const number = Number(value);

  return Number.isFinite(number)

    ? Math.min(max, Math.max(min, number))

    : fallback;

}

 

function cleanupDetectedCandidate(value = "") {

  let text = clean(value);

 

  if (!text) return "";

 

  text = text

    .replace(/[?!.,;:]+$/g, "")

    .replace(

      /\b(?:in|for|from|during|with)\s+(?:the\s+)?(?:20\d{2}\s+)?(?:election|cycle|race|campaign)\b.*$/i,

      ""

    )

    .replace(/\b(?:today|currently|right now|latest|current)\b.*$/i, "")

    .trim();

 

  return text;

}

 

function detectState(question, supplied = "") {

  const explicit = clean(supplied).toUpperCase();

 

  if (STATE_NAMES[explicit]) {

    return explicit;

  }

 

  const lower = clean(question).toLowerCase();

 

  for (const [name, code] of Object.entries(STATE_CODES)) {

    if (lower.includes(name)) return code;

  }

 

  const match = clean(question).match(

    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i

  );

 

  return match?.[1]?.toUpperCase() || "";

}

 

function detectCycle(question, supplied = "") {

  const explicit = clean(supplied);

 

  if (/^20\d{2}$/.test(explicit)) {

    return explicit;

  }

 

  const match = clean(question).match(/\b(20\d{2})\b/);

 

  return match?.[1] || String(new Date().getFullYear());

}

 

function detectOffice(question, supplied = "") {

  const explicit = clean(supplied);

 

  if (explicit) return explicit;

 

  const lower = clean(question).toLowerCase();

 

  if (/\bsenate|senator\b/.test(lower)) return "Senate";

  if (/\bhouse|congress|congressional|representative\b/.test(lower)) return "House";

  if (/\bpresident|presidential\b/.test(lower)) return "President";

  if (/\bgovernor|gubernatorial\b/.test(lower)) return "Governor";

 

  return "";

}

 

/*

 * Build 4.4.1 candidate detection.

 *

 * The critical fix is that a broad natural-language request such as:

 *   "give me a complete briefing on jasmine crockett"

 * resolves "jasmine crockett" before intent classification.

 */

function detectCandidate(question, suppliedCandidate = "") {

  const explicit = cleanupDetectedCandidate(suppliedCandidate);

 

  if (explicit) {

    return explicit;

  }

 

  const text = clean(question);

 

  if (!text) return "";

 

  const patterns = [

    /\b(?:give|prepare|build|create|show)\s+me\s+(?:a\s+)?(?:complete|full|executive|candidate|strategic|current|latest)?\s*(?:candidate\s+)?(?:briefing|brief|assessment|profile|report|intelligence)\s+(?:on|about|for)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,

 

    /\b(?:complete|full|executive|candidate|strategic|current|latest)\s+(?:briefing|brief|assessment|profile|report|intelligence)\s+(?:on|about|for)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,

 

    /\b(?:tell\s+me\s+everything\s+about|tell\s+me\s+about|what\s+should\s+i\s+know\s+about|what\s+do\s+we\s+know\s+about)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,

 

    /\b(?:fec|finance|financial|fundraising|polling|polls|news|strategy|profile|candidate)\s+(?:report\s+)?(?:for|on|about)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,

 

    /\b(?:what\s+is|what's)\s+(?:the\s+)?(?:current|latest)?\s*(?:fec|finance|financial|fundraising|polling|poll|news|strategy|profile|report)\s+(?:for|on|about)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,

 

    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(?:campaign|candidate|polling|polls|fundraising|finance|fec|strategy|briefing|profile|news)\b/i,

  ];

 

  for (const pattern of patterns) {

    const match = text.match(pattern);

 

    if (match?.[1]) {

      const candidate = cleanupDetectedCandidate(match[1]);

 

      if (candidate) return candidate;

    }

  }

 

  return "";

}

 

function classifyIntent(question, context = {}) {

  const lower = clean(question).toLowerCase();

 

  /*

   * Keep specific data questions first.

   * "What is the current FEC report for Jasmine Crockett?"

   * must remain a finance request, not a broad candidate briefing.

   */

  if (

    /fec|fundrais|donor|cash on hand|receipts|disbursement|finance|financial|raised|spent|committee money|filing|quarterly report/.test(

      lower

    )

  ) {

    return "finance";

  }

 

  if (

    /poll|polls|polling|horse race|margin|who(?:'s| is) leading|lead(?:ing)? by|survey/.test(

      lower

    )

  ) {

    return "polling";

  }

 

  /*

   * Build 4.4 unified candidate briefing.

   * Candidate must already be detected.

   */

  if (

    context.candidate &&

    /complete briefing|full briefing|executive briefing|candidate briefing|complete assessment|full assessment|candidate assessment|complete profile|full profile|complete report|full report|candidate intelligence|complete intelligence|tell me everything|what should i know|what do we know|strategy|strategic|news articles|latest news|current news/.test(

      lower

    )

  ) {

    return "candidate_intelligence";

  }

 

  if (

    /operations|operational|field|county|parish|task|workspace|readiness|execution|command center/.test(

      lower

    )

  ) {

    return "operations";

  }

 

  if (

    /deadline|ballot access|election administration|voting system|court ruling|election law/.test(

      lower

    )

  ) {

    return "administration";

  }

 

  if (

    /legislat|bill|committee hearing|congress\.gov|congressional action/.test(

      lower

    )

  ) {

    return "legislative";

  }

 

  if (

    /weather|storm|rain|heat|snow|field risk|temperature/.test(

      lower

    )

  ) {

    return "weather";

  }

 

  if (

    /candidate|campaign|profile|biograph|tell me about|who is/.test(

      lower

    )

  ) {

    return context.candidate

      ? "candidate_intelligence"

      : "candidate";

  }

 

  if (

    /race|election|political|statewide|district|contest/.test(

      lower

    )

  ) {

    return "race_overview";

  }

 

  /*

   * If a named candidate was resolved from the question, candidate context

   * wins over generic executive overview.

   */

  if (context.candidate) {

    return "candidate_intelligence";

  }

 

  return "executive_overview";

}

 

function resolveContext(payload = {}) {

  const question = clean(

    payload.question ||

      payload.query ||

      payload.prompt

  );

 

  const context = {

    question,

 

    state: detectState(

      question,

      payload.state

    ),

 

    office: detectOffice(

      question,

      payload.office

    ),

 

    candidate: detectCandidate(

      question,

      payload.candidate

    ),

 

    cycle: detectCycle(

      question,

      payload.cycle

    ),

 

    locality: clean(payload.locality),

 

    candidate_id: clean(

      payload.candidate_id ||

        payload.fec_candidate_id

    ),

 

    committee_id: clean(

      payload.committee_id

    ),

  };

 

  context.state_name =

    STATE_NAMES[context.state] || null;

 

  context.intent =

    classifyIntent(

      question,

      context

    );

 

  return context;

}

 

function makeCall(name, args, reason, priority = 50) {

  return {

    name,

    arguments: args,

    reason,

    priority,

  };

}

 

function buildToolPlan({

  question,

  context,

  workspaceId,

  limit,

}) {

  const calls = [];

 

  const common = {

    query: question,

    state: context.state,

    office: context.office,

    locality: context.locality,

    cycle: context.cycle,

    limit,

    workspace_id: workspaceId,

  };

 

  if (context.intent === "candidate_intelligence") {

    /*

     * Build 4.4 critical route:

     * one candidate-specific bundle, no generic state-operations call.

     */

    calls.push(

      makeCall(

        "get_candidate_intelligence_bundle",

        {

          candidate: context.candidate,

          candidate_id: context.candidate_id,

          state: context.state,

          office: context.office,

          cycle: context.cycle,

          locality: context.locality,

          workspace_id: workspaceId,

          limit,

        },

        "Build complete verified candidate intelligence: identity, FEC finance, polling, news, signals, and strategy.",

        100

      )

    );

 

    return calls;

  }

 

  if (context.intent === "polling") {

    calls.push(

      makeCall(

        "get_latest_polling",

        {

          candidate: context.candidate,

          state: context.state,

          office: context.office,

          locality: context.locality,

          limit,

        },

        "Retrieve polling directly relevant to the question.",

        100

      )

    );

 

    calls.push(

      makeCall(

        "search_live_news",

        {

          query: context.candidate || question,

          state: context.state,

          locality: context.locality,

          limit,

        },

        "Check current reporting for corroborating polling coverage.",

        82

      )

    );

 

    return calls;

  }

 

  if (context.intent === "finance") {

    /*

     * Preserve the strict finance design:

     * candidate database resolves identity;

     * FEC is queried only for verified identities at execution time.

     */

    calls.push(

      makeCall(

        "get_candidate_statistics",

        {

          candidate: context.candidate,

          candidate_id: context.candidate_id,

          state: context.state,

          office: context.office,

          cycle: context.cycle,

        },

        "Resolve candidate identity from the VoterSpheres candidate database only.",

        100

      )

    );

 

    return calls;

  }

 

  if (context.intent === "candidate") {

    calls.push(

      makeCall(

        "get_candidate_statistics",

        {

          candidate: context.candidate,

          candidate_id: context.candidate_id,

          state: context.state,

          office: context.office,

          cycle: context.cycle,

        },

        "Resolve stored candidate records.",

        100

      )

    );

 

    calls.push(

      makeCall(

        "search_live_news",

        {

          query: context.candidate || question,

          state: context.state,

          locality: context.locality,

          limit,

        },

        "Retrieve candidate reporting.",

        90

      )

    );

 

    return calls;

  }

 

  if (context.intent === "operations") {

    calls.push(

      makeCall(

        "get_state_operations",

        common,

        "Load state and field execution context.",

        100

      )

    );

 

    calls.push(

      makeCall(

        "get_unified_executive_intelligence",

        {

          workspace_id: workspaceId,

          state: context.state,

          office: context.office,

        },

        "Load unified executive operating context.",

        90

      )

    );

 

    return calls;

  }

 

  if (context.intent === "administration") {

    calls.push(

      makeCall(

        "search_live_news",

        common,

        "Retrieve current election-administration reporting.",

        100

      )

    );

 

    calls.push(

      makeCall(

        "get_unified_executive_intelligence",

        {

          workspace_id: workspaceId,

          state: context.state,

          office: context.office,

        },

        "Load relevant VoterSpheres executive context.",

        80

      )

    );

 

    return calls;

  }

 

  if (context.intent === "legislative") {

    calls.push(

      makeCall(

        "search_live_news",

        common,

        "Retrieve current legislative reporting.",

        100

      )

    );

 

    return calls;

  }

 

  if (context.intent === "weather") {

    calls.push(

      makeCall(

        "search_live_news",

        common,

        "Retrieve available current weather-related political operations reporting.",

        100

      )

    );

 

    return calls;

  }

 

  if (context.intent === "race_overview") {

    calls.push(

      makeCall(

        "get_latest_polling",

        {

          candidate: context.candidate,

          state: context.state,

          office: context.office,

          locality: context.locality,

          limit,

        },

        "Retrieve polling for the race.",

        100

      )

    );

 

    calls.push(

      makeCall(

        "search_live_news",

        {

          query: question,

          state: context.state,

          locality: context.locality,

          limit,

        },

        "Retrieve current race reporting.",

        90

      )

    );

 

    return calls;

  }

 

  calls.push(

    makeCall(

      "get_unified_executive_intelligence",

      {

        workspace_id: workspaceId,

        state: context.state,

        office: context.office,

      },

      "Load the VoterSpheres executive operating picture.",

      100

    )

  );

 

  calls.push(

    makeCall(

      "search_live_news",

      {

        query: question,

        state: context.state,

        locality: context.locality,

        limit,

      },

      "Retrieve current reporting relevant to the executive question.",

      85

    )

  );

 

  return calls;

}

 

function normalizeResult(callValue, value, latencyMs) {

  const result = obj(value);

 

  return {

    tool: callValue.name,

    reason: callValue.reason,

    arguments: callValue.arguments,

    ok: Boolean(result.ok),

    usable: Boolean(

      result.ok &&

        (

          result.data ||

          arr(result.sources).length ||

          clean(result.summary)

        )

    ),

    degraded: Boolean(result.degraded),

    summary: clean(result.summary),

    data: result.data ?? null,

    sources: arr(result.sources),

    warnings: arr(result.warnings),

    diagnostics: arr(result.diagnostics),

    generated_at: result.generated_at || null,

    latency_ms: latencyMs,

  };

}

 

async function executeCall(callValue, user) {

  const started = Date.now();

 

  try {

    let output;

 

    if (callValue.name === "get_candidate_intelligence_bundle") {

      output = await getCandidateIntelligenceBundle({

        candidate: callValue.arguments.candidate,

        candidateId: callValue.arguments.candidate_id,

        state: callValue.arguments.state,

        office: callValue.arguments.office,

        cycle: callValue.arguments.cycle,

        locality: callValue.arguments.locality,

        workspaceId: callValue.arguments.workspace_id || 1,

        limit: callValue.arguments.limit || 12,

        user,

      });

 

      /*

       * normalizeResult expects data.

       * Wrap the bundle so the complete bundle becomes result.data.

       */

      output = {

        ok: output.ok,

        summary: output.ok

          ? `Built unified candidate intelligence for ${output.candidate_query || "the requested candidate"}.`

          : "Candidate intelligence bundle returned insufficient verified evidence.",

        data: output,

        sources: output.sources,

        warnings: output.warnings,

        diagnostics: output.diagnostics,

        degraded: !output.ok,

        generated_at: output.generated_at,

      };

    } else {

      output = await executeExecutiveVoiceTool({

        name: callValue.name,

        arguments: callValue.arguments,

        user,

      });

    }

 

    return normalizeResult(

      callValue,

      await withTimeout(

        Promise.resolve(output),

        callValue.name === "get_candidate_intelligence_bundle"

          ? ORCHESTRATOR_TIMEOUT_MS

          : TOOL_TIMEOUT_MS,

        callValue.name

      ),

      Date.now() - started

    );

  } catch (error) {

    return {

      tool: callValue.name,

      reason: callValue.reason,

      arguments: callValue.arguments,

      ok: false,

      usable: false,

      degraded: true,

      summary: `${callValue.name} failed.`,

      data: null,

      sources: [],

      warnings: [error?.message || "Unknown tool failure."],

      diagnostics: [

        {

          provider: callValue.name,

          ok: false,

          error: error?.message || "Unknown tool failure.",

          checked_at: now(),

        },

      ],

      generated_at: now(),

      latency_ms: Date.now() - started,

    };

  }

}

 

function normalizePersonName(value = "") {

  const parts = clean(value)

    .replace(/,/g, " ")

    .replace(/\s+/g, " ")

    .toLowerCase()

    .split(" ")

    .filter(Boolean);

 

  return parts.length >= 2 ? [...parts].sort().join(" ") : parts.join(" ");

}

 

function samePerson(requested, row) {

  const stored = clean(row.full_name || row.name);

 

  return (

    normalizePersonName(requested) &&

    normalizePersonName(requested) === normalizePersonName(stored)

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

 

function selectFinanceIdentities(rows, context) {

  const requestedId = clean(context.candidate_id).toUpperCase();

  const requestedState = clean(context.state).toUpperCase();

  const requestedOffice = officeKey(context.office);

  const requestedCycle = clean(context.cycle);

 

  return arr(rows)

    .filter((row) => {

      if (requestedId) {

        return clean(row.fec_candidate_id).toUpperCase() === requestedId;

      }

 

      return !context.candidate || samePerson(context.candidate, row);

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

    .filter((row) => clean(row.fec_candidate_id));

}

 

async function executeFinancePlan(plan, user) {

  const statisticsCall = plan.tool_plan[0];

  const statistics = await executeCall(statisticsCall, user);

  const results = [statistics];

 

  const identities = selectFinanceIdentities(

    statistics?.data?.candidates,

    plan.context

  );

 

  for (const row of identities) {

    const fecCall = makeCall(

      "get_fec_finance",

      {

        candidate: row.full_name || row.name || plan.context.candidate,

        candidate_id: row.fec_candidate_id,

        committee_id: row.campaign_committee_id || "",

        cycle: plan.context.cycle,

      },

      "Retrieve the official FEC report for the verified candidate identity.",

      99

    );

 

    results.push(

      await executeCall(fecCall, user)

    );

  }

 

  return results;

}

 

function mergeSources(results) {

  const seen = new Set();

  const sources = [];

 

  for (const source of results.flatMap((result) => arr(result.sources))) {

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

    sources.push(item);

  }

 

  return sources;

}

 

function money(value) {

  const number = Number(value);

 

  return Number.isFinite(number)

    ? number.toLocaleString("en-US", {

        style: "currency",

        currency: "USD",

      })

    : null;

}

 

function dateLabel(value) {

  if (!value) return null;

 

  const date = new Date(value);

 

  if (Number.isNaN(date.getTime())) return clean(value);

 

  return date.toLocaleDateString("en-US", {

    month: "long",

    day: "numeric",

    year: "numeric",

  });

}

 

function buildFinanceDataAnswer(results, context) {

  const fecResults = results.filter(

    (result) =>

      result.tool === "get_fec_finance" &&

      result.ok

  );

 

  if (!fecResults.length) return null;

 

  const reports = [];

  const sections = [];

 

  for (const result of fecResults) {

    const record =

      arr(result.data?.records)[0] ||

      arr(result.data?.finance)[0] ||

      null;

 

    if (!record) continue;

 

    const candidateId =

      record.candidate_id ||

      result.arguments?.candidate_id ||

      null;

 

    const candidateName =

      result.arguments?.candidate ||

      context.candidate ||

      "Candidate";

 

    const report = {

      candidate: candidateName,

      candidate_id: candidateId,

      cycle: record.cycle || context.cycle || null,

      report: record.last_report_type_full || null,

      coverage_start: record.coverage_start_date || null,

      coverage_end:

        record.coverage_end_date ||

        record.transaction_coverage_date ||

        null,

      receipts: record.receipts ?? null,

      disbursements: record.disbursements ?? null,

      cash_on_hand: record.last_cash_on_hand_end_period ?? null,

      contributions: record.contributions ?? null,

      individual_contributions: record.individual_contributions ?? null,

      itemized_individual_contributions:

        record.individual_itemized_contributions ?? null,

      unitemized_individual_contributions:

        record.individual_unitemized_contributions ?? null,

      operating_expenditures: record.operating_expenditures ?? null,

      transfers_to_other_authorized_committee:

        record.transfers_to_other_authorized_committee ?? null,

      transfers_from_other_authorized_committee:

        record.transfers_from_other_authorized_committee ?? null,

      contribution_refunds: record.contribution_refunds ?? null,

      debts_owed_by_committee:

        record.last_debts_owed_by_committee ?? null,

      source: result.sources?.[0] || null,

    };

 

    reports.push(report);

 

    const lines = [

      candidateName,

      "",

      `Candidate ID: ${candidateId || "—"}`,

      `Cycle: ${report.cycle || "—"}`,

      `Report: ${report.report || "Latest available filing"}`,

      `Coverage start: ${dateLabel(report.coverage_start) || "—"}`,

      `Coverage through: ${dateLabel(report.coverage_end) || "—"}`,

      "",

      `Total receipts: ${money(report.receipts) || "—"}`,

      `Total disbursements: ${money(report.disbursements) || "—"}`,

      `Cash on hand: ${money(report.cash_on_hand) || "—"}`,

      `Total contributions: ${money(report.contributions) || "—"}`,

      `Individual contributions: ${money(report.individual_contributions) || "—"}`,

      `Itemized individual contributions: ${money(report.itemized_individual_contributions) || "—"}`,

      `Unitemized individual contributions: ${money(report.unitemized_individual_contributions) || "—"}`,

      `Operating expenditures: ${money(report.operating_expenditures) || "—"}`,

      `Transfers to other authorized committees: ${money(report.transfers_to_other_authorized_committee) || "—"}`,

      `Transfers from other authorized committees: ${money(report.transfers_from_other_authorized_committee) || "—"}`,

      `Contribution refunds: ${money(report.contribution_refunds) || "—"}`,

      `Debts owed by committee: ${money(report.debts_owed_by_committee) || "—"}`,

    ];

 

    sections.push(lines.join("\n"));

  }

 

  if (!reports.length) return null;

 

  return {

    type: "finance",

    title: `Latest FEC Report — ${context.candidate || "Candidate"}`,

    reports,

    answer: sections.join("\n\n---\n\n"),

  };

}

 

function recordLabel(record = {}) {

  return clean(

    record.title ||

      record.headline ||

      record.question ||

      record.pollster ||

      record.name ||

      record.summary ||

      record.description

  );

}

 

function buildCandidateDataAnswer(bundle, context) {

  const identities = arr(bundle.identities);

  const financeReports = arr(bundle.finance?.reports);

  const polls = arr(bundle.polling?.records);

  const articles = arr(bundle.news?.records);

  const signals = arr(bundle.signals);

  const strategies = arr(bundle.strategy?.recommendations);

 

  const candidateName =

    identities[0]?.name ||

    context.candidate ||

    bundle.candidate_query ||

    "Candidate";

 

  const lines = [

    `Unified Candidate Intelligence — ${candidateName}`,

    "",

    `Verified identities: ${identities.length}`,

  ];

 

  for (const identity of identities) {

    lines.push(

      `- ${identity.office || "Office"}${

        identity.district ? ` - ${identity.district}` : ""

      } | ${identity.state || ""} | FEC ${identity.fec_candidate_id || "—"}`

    );

  }

 

  lines.push(

    "",

    `Official FEC reports returned: ${financeReports.filter((item) => item?.ok).length}`,

    `Polling records returned: ${polls.length}`,

    `News/articles returned: ${articles.length}`,

    `Political signals returned: ${signals.length}`,

    `Strategy recommendations returned: ${strategies.length}`

  );

 

  if (polls.length) {

    lines.push("", "Latest polling evidence:");

 

    for (const poll of polls.slice(0, 5)) {

      lines.push(`- ${recordLabel(poll) || JSON.stringify(poll).slice(0, 220)}`);

    }

  }

 

  if (articles.length) {

    lines.push("", "Current reporting:");

 

    for (const article of articles.slice(0, 5)) {

      lines.push(`- ${recordLabel(article) || JSON.stringify(article).slice(0, 220)}`);

    }

  }

 

  if (strategies.length) {

    lines.push("", "VoterSpheres strategy recommendations:");

 

    for (const strategy of strategies.slice(0, 5)) {

      lines.push(

        `- ${

          typeof strategy === "string"

            ? strategy

            : clean(

                strategy.title ||

                  strategy.recommended_action ||

                  strategy.summary ||

                  strategy.rationale

              ) ||

              JSON.stringify(strategy).slice(0, 220)

        }`

      );

    }

  }

 

  return {

    type: "candidate_intelligence",

    title: `Unified Candidate Intelligence — ${candidateName}`,

    candidate: candidateName,

    identities,

    profile: bundle.profile || null,

    finance: bundle.finance || null,

    polling: bundle.polling || null,

    news: bundle.news || null,

    signals,

    strategy: bundle.strategy || null,

    operations: bundle.operations || null,

    coverage: bundle.coverage || null,

    sources: bundle.sources || [],

    answer: lines.join("\n"),

  };

}

 

function fallbackBrief(question, results, sources, confidence, dataAnswer) {

  if (dataAnswer?.answer) {

    return {

      headline: dataAnswer.title || "Verified VoterSpheres intelligence",

      executive_summary: dataAnswer.answer,

      key_findings: [],

      risks_and_gaps: results

        .filter((result) => !result.usable)

        .map((result) => ({

          tool: result.tool,

          issue: result.warnings[0] || result.summary,

        })),

      recommended_actions: [],

      answer: dataAnswer.answer,

      confidence,

      source_count: sources.length,

    };

  }

 

  const usable = results.filter((result) => result.usable);

 

  const findings = usable.map((result, index) => ({

    rank: index + 1,

    finding: result.summary || `${result.tool} returned evidence.`,

    support: result.tool,

  }));

 

  const answer = findings.length

    ? [

        findings[0].finding,

        "",

        ...findings.map((item) => `${item.rank}. ${item.finding}`),

        "",

        `Evidence status: partial. Confidence: ${confidence}%. Sources: ${sources.length}.`,

      ].join("\n")

    : `VoterSpheres could not retrieve enough verified evidence to answer: "${question}". The system will not substitute generic model knowledge for unavailable live political data.`;

 

  return {

    headline: findings[0]?.finding || "No verified evidence returned.",

    executive_summary: findings.map((item) => item.finding).join(" "),

    key_findings: findings,

    risks_and_gaps: results

      .filter((result) => !result.usable)

      .map((result) => ({

        tool: result.tool,

        issue: result.warnings[0] || result.summary,

      })),

    recommended_actions: [],

    answer,

    confidence,

    source_count: sources.length,

  };

}

 

async function synthesize({

  question,

  context,

  results,

  sources,

  confidence,

  deterministic,

  dataAnswer,

}) {

  if (!openai || !results.some((result) => result.usable)) {

    return null;

  }

 

  const evidence = results

    .filter((result) => result.usable)

    .map((result) => ({

      tool: result.tool,

      summary: result.summary,

      data: result.data,

      sources: result.sources,

      warnings: result.warnings,

    }));

 

  const response = await withTimeout(

    openai.responses.create({

      model: MODEL,

      input: [

        "You are the VoterSpheres Executive Chief of Staff.",

        "Use only the retrieved VoterSpheres/provider evidence supplied below.",

        "Do not use unsupported model memory as current political fact.",

        "Never invent candidate identities, FEC values, polls, news articles, dates, offices, districts, sources, or strategy recommendations.",

        "For a candidate_intelligence request, organize the response into: Verified Candidate Identity, Campaign Finance, Polling, Current News, Political Signals, Strategy Recommendations, Data Gaps, and Executive Takeaway.",

        "Strategy Recommendations must be clearly labeled as VoterSpheres recommendations/analysis, not external facts.",

        "If multiple verified candidate identities exist, keep them distinct.",

        "For finance questions preserve exact returned FEC numbers and candidate IDs.",

        "Do not substitute state-operations information for missing candidate intelligence.",

        "Return only JSON with headline, executive_summary, key_findings, risks_and_gaps, recommended_actions, answer.",

        `Question: ${question}`,

        `Resolved context: ${JSON.stringify(context)}`,

        `Structured Data Answer: ${JSON.stringify(dataAnswer).slice(0, 70000)}`,

        `Sources: ${JSON.stringify(sources).slice(0, 30000)}`,

        `Evidence: ${JSON.stringify(evidence).slice(0, 120000)}`,

        `Deterministic fallback: ${JSON.stringify(deterministic).slice(0, 30000)}`,

      ].join("\n"),

    }),

    SYNTHESIS_TIMEOUT_MS,

    "Executive synthesis"

  );

 

  try {

    return JSON.parse(response?.output_text || "");

  } catch {

    return null;

  }

}

 

export function getExecutiveOrchestratorConfiguration() {

  return {

    ok: true,

    build: BUILD,

    model: MODEL,

    openai_synthesis_configured: Boolean(openai),

    live_intelligence_policy: "retrieved-evidence-required",

    candidate_intelligence_mode:

      "verified-profile-fec-polling-news-signals-strategy",

    finance_resolution_mode:

      "strict-candidate-statistics-multi-identity",

    orchestrator_timeout_ms: ORCHESTRATOR_TIMEOUT_MS,

    tool_timeout_ms: TOOL_TIMEOUT_MS,

    synthesis_timeout_ms: SYNTHESIS_TIMEOUT_MS,

    generated_at: now(),

  };

}

 

export function createExecutiveIntelligencePlan({ payload = {} } = {}) {

  const question = clean(

    payload.question ||

      payload.query ||

      payload.prompt

  );

 

  if (!question) {

    const error = new Error("A question, query, or prompt is required.");

    error.status = 400;

    throw error;

  }

 

  const context = resolveContext(payload);

 

  const workspaceId = Number(

    payload.workspace_id ||

      payload.workspaceId ||

      1

  );

 

  const limit = clamp(

    payload.limit,

    12,

    1,

    25

  );

 

  return {

    ok: true,

    build: BUILD,

    question,

    context,

    workspace_id: workspaceId,

    limit,

    tool_plan: buildToolPlan({

      question,

      context,

      workspaceId,

      limit,

    }),

    generated_at: now(),

  };

}

 

export async function runExecutiveIntelligenceOrchestrator({

  user = {},

  payload = {},

} = {}) {

  const startedAt = Date.now();

 

  const plan =

    createExecutiveIntelligencePlan({

      payload,

    });

 

  let results;

 

  if (plan.context.intent === "finance") {

    results = await withTimeout(

      executeFinancePlan(

        plan,

        user

      ),

      ORCHESTRATOR_TIMEOUT_MS,

      "FEC finance orchestration"

    );

  } else {

    results = await withTimeout(

      Promise.all(

        plan.tool_plan.map((callValue) =>

          executeCall(

            callValue,

            user

          )

        )

      ),

      ORCHESTRATOR_TIMEOUT_MS,

      "Executive Intelligence Orchestrator"

    );

  }

 

  const sources =

    mergeSources(results);

 

  const useful =

    results.filter(

      (result) =>

        result.usable

    ).length;

 

  const confidence =

    Math.max(

      0,

      Math.min(

        97,

        Math.round(

          (

            useful /

            Math.max(

              1,

              results.length

            )

          ) *

            70 +

            Math.min(

              27,

              sources.length * 3

            )

        )

      )

    );

 

  let dataAnswer = null;

 

  if (

    plan.context.intent ===

    "candidate_intelligence"

  ) {

    const bundleResult =

      results.find(

        (result) =>

          result.tool ===

            "get_candidate_intelligence_bundle" &&

          result.usable

      );

 

    if (bundleResult?.data) {

      dataAnswer =

        buildCandidateDataAnswer(

          bundleResult.data,

          plan.context

        );

    }

  }

 

  if (

    plan.context.intent ===

    "finance"

  ) {

    dataAnswer =

      buildFinanceDataAnswer(

        results,

        plan.context

      );

  }

 

  let briefing =

    fallbackBrief(

      plan.question,

      results,

      sources,

      confidence,

      dataAnswer

    );

 

  try {

    const ai =

      await synthesize({

        question:

          plan.question,

 

        context:

          plan.context,

 

        results,

 

        sources,

 

        confidence,

 

        deterministic:

          briefing,

 

        dataAnswer,

      });

 

    if (

      ai?.answer ||

      ai?.executive_summary

    ) {

      briefing = {

        ...briefing,

        ...ai,

        confidence,

        source_count:

          sources.length,

      };

    }

  } catch (error) {

    results.push({

      tool:

        "briefing_synthesis",

 

      ok:

        false,

 

      usable:

        false,

 

      degraded:

        true,

 

      summary:

        "OpenAI synthesis failed.",

 

      data:

        null,

 

      sources:

        [],

 

      warnings: [

        error?.message ||

          "OpenAI synthesis failed.",

      ],

 

      diagnostics:

        [],

    });

  }

 

  /*

   * Finance keeps the deterministic exact-number Data Answer as the final

   * answer so synthesis cannot alter official totals.

   *

   * Candidate intelligence uses synthesis when available, with the complete

   * structured bundle also returned as candidate_intelligence/data_answer.

   */

  const finalAnswer =

    plan.context.intent === "finance" &&

    dataAnswer?.answer

      ? dataAnswer.answer

      : briefing.answer ||

        dataAnswer?.answer ||

        briefing.executive_summary;

 

  return {

    ok:

      useful > 0,

 

    build:

      BUILD,

 

    provider:

      "executive_intelligence_orchestrator",

 

    degraded:

      useful <

      results.length,

 

    live_data_available:

      useful > 0,

 

    grounded:

      useful > 0,

 

    evidence_status:

      useful ===

      results.length

        ? "live"

        : useful > 0

          ? "partial"

          : "unavailable",

 

    question:

      plan.question,

 

    context:

      plan.context,

 

    workspace_id:

      plan.workspace_id,

 

    plan: {

      tool_count:

        plan.tool_plan.length,

 

      tools:

        plan.tool_plan,

    },

 

    execution: {

      started_at:

        new Date(

          startedAt

        ).toISOString(),

 

      completed_at:

        now(),

 

      latency_ms:

        Date.now() -

        startedAt,

 

      confidence,

 

      candidate_intelligence_mode:

        plan.context.intent ===

        "candidate_intelligence",

    },

 

    data_answer:

      dataAnswer,

 

    candidate_intelligence:

      dataAnswer?.type ===

      "candidate_intelligence"

        ? dataAnswer

        : null,

 

    briefing: {

      ...briefing,

      data_answer:

        dataAnswer,

    },

 

    answer:

      finalAnswer,

 

    tool_results:

      results,

 

    evidence:

      results.filter(

        (result) =>

          result.usable

      ),

 

    sources,

 

    warnings:

      results.flatMap(

        (result) =>

          arr(

            result.warnings

          )

      ),

 

    diagnostics:

      results.flatMap(

        (result) =>

          arr(

            result.diagnostics

          )

      ),

 

    generated_at:

      now(),

  };

}

 

export default {

  getExecutiveOrchestratorConfiguration,

  createExecutiveIntelligencePlan,

  runExecutiveIntelligenceOrchestrator,

};
