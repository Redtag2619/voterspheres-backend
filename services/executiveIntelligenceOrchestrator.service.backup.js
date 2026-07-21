import OpenAI from "openai";
import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

/*
 * =========================================================
 * VoterSpheres Build 4.0
 * Executive Intelligence Orchestrator
 * =========================================================
 *
 * Purpose:
 * - Interpret broad executive political questions
 * - Build a deterministic multi-tool plan
 * - Execute relevant Executive Voice tools in parallel
 * - Preserve partial results when one provider fails
 * - Score confidence, freshness, and data coverage
 * - Produce a sourced executive briefing
 *
 * This service does not replace Build 3.5.3. It orchestrates
 * the existing executeExecutiveVoiceTool() interface.
 */

const BUILD = "4.0.0";

const ORCHESTRATOR_TIMEOUT_MS =
  Number(process.env.EXECUTIVE_ORCHESTRATOR_TIMEOUT_MS) || 30000;

const TOOL_TIMEOUT_MS =
  Number(process.env.EXECUTIVE_ORCHESTRATOR_TOOL_TIMEOUT_MS) || 18000;

const SYNTHESIS_TIMEOUT_MS =
  Number(process.env.EXECUTIVE_ORCHESTRATOR_SYNTHESIS_TIMEOUT_MS) || 15000;

const MAX_TOOLS =
  Number(process.env.EXECUTIVE_ORCHESTRATOR_MAX_TOOLS) || 8;

const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: SYNTHESIS_TIMEOUT_MS,
        maxRetries: 0,
      })
    : null;

const STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const STATE_CODES = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ])
);

const OFFICE_PATTERNS = [
  ["governor", "Governor"],
  ["lieutenant governor", "Lieutenant Governor"],
  ["u.s. senate", "U.S. Senate"],
  ["us senate", "U.S. Senate"],
  ["senate", "U.S. Senate"],
  ["u.s. house", "U.S. House"],
  ["us house", "U.S. House"],
  ["congress", "U.S. House"],
  ["house", "U.S. House"],
  ["secretary of state", "Secretary of State"],
  ["attorney general", "Attorney General"],
  ["state senate", "State Senate"],
  ["state house", "State House"],
  ["mayor", "Mayor"],
  ["county commission", "County Commission"],
];

const now = () => new Date().toISOString();

function clean(value = "") {
  return String(value ?? "").trim();
}

function clamp(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      values
        .map((value) => clean(value))
        .filter(Boolean)
    ),
  ];
}

function safeJson(value) {
  if (value && typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonObject(value) {
  const text = clean(value);

  if (!text) {
    return null;
  }

  const direct = safeJson(text);

  if (direct) {
    return direct;
  }

  const unfenced = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const unfencedJson = safeJson(unfenced);

  if (unfencedJson) {
    return unfencedJson;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return safeJson(text.slice(start, end + 1));
  }

  return null;
}

function timeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms.`);
  error.code = "ORCHESTRATOR_TIMEOUT";
  return error;
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;

  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(timeoutError(label, timeoutMs)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function detectState(question, suppliedState = "") {
  const explicit = clean(suppliedState).toUpperCase();

  if (STATE_NAMES[explicit]) {
    return explicit;
  }

  const lower = clean(question).toLowerCase();

  for (const [name, code] of Object.entries(STATE_CODES)) {
    if (lower.includes(name)) {
      return code;
    }
  }

  const stateCodeMatch = clean(question).match(
    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i
  );

  return stateCodeMatch
    ? stateCodeMatch[1].toUpperCase()
    : "";
}

function detectOffice(question, suppliedOffice = "") {
  const explicit = clean(suppliedOffice);

  if (explicit) {
    return explicit;
  }

  const lower = clean(question).toLowerCase();

  for (const [needle, office] of OFFICE_PATTERNS) {
    if (lower.includes(needle)) {
      return office;
    }
  }

  const districtMatch = clean(question).match(
    /\b(?:district|cd)[\s-]*(\d{1,2})\b/i
  );

  if (districtMatch) {
    return `U.S. House District ${districtMatch[1]}`;
  }

  return "";
}

function detectCycle(question, suppliedCycle = "") {
  const explicit = clean(suppliedCycle);

  if (/^20\d{2}$/.test(explicit)) {
    return explicit;
  }

  const yearMatch = clean(question).match(/\b(20\d{2})\b/);

  if (yearMatch) {
    return yearMatch[1];
  }

  return String(new Date().getFullYear());
}

function detectCandidate(question, suppliedCandidate = "") {
  const explicit = clean(suppliedCandidate);

  if (explicit) {
    return explicit;
  }

  const quoted = clean(question).match(/["“]([^"”]{3,80})["”]/);

  if (quoted) {
    return clean(quoted[1]);
  }

  const patterns = [
    /(?:candidate|about|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,3})/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,3})\s+(?:campaign|polling|fundraising|race)/,
  ];

  for (const pattern of patterns) {
    const match = clean(question).match(pattern);

    if (match) {
      const name = clean(match[1]);

      if (!Object.values(STATE_NAMES).includes(name)) {
        return name;
      }
    }
  }

  return "";
}

function detectLocality(question, suppliedLocality = "") {
  const explicit = clean(suppliedLocality);

  if (explicit) {
    return explicit;
  }

  const match = clean(question).match(
    /\b([A-Z][A-Za-z.' -]{2,40})\s+(County|Parish)\b/
  );

  return match ? clean(`${match[1]} ${match[2]}`) : "";
}

function classifyIntent(question, context) {
  const lower = clean(question).toLowerCase();

  if (
    context.candidate ||
    /\bcandidate\b|\bcampaign\b|\bbiography\b|\bprofile\b/.test(lower)
  ) {
    return "candidate";
  }

  if (
    /\bpoll\b|\bpolling\b|\bmargin\b|\bhorse race\b|\bleading\b/.test(lower)
  ) {
    return "polling";
  }

  if (
    /\bfec\b|\bfundrais|\bdonor\b|\bcash on hand\b|\bfinance\b/.test(lower)
  ) {
    return "finance";
  }

  if (
    /\boperations\b|\bfield\b|\bcounty\b|\bparish\b|\btask\b|\bworkspace\b/.test(lower)
  ) {
    return "operations";
  }

  if (
    /\bdeadline\b|\bballot access\b|\belection administration\b|\bvoting system\b|\bcourt ruling\b/.test(lower)
  ) {
    return "administration";
  }

  if (
    /\blegislat|\bbill\b|\bcongress\b|\bcommittee hearing\b/.test(lower)
  ) {
    return "legislative";
  }

  if (
    /\bweather\b|\bstorm\b|\brain\b|\bheat\b|\bfield risk\b/.test(lower)
  ) {
    return "weather";
  }

  if (
    /\brace\b|\belection\b|\b202\d\b|\bpolitical\b|\bstatewide\b|\bdistrict\b/.test(lower)
  ) {
    return "race_overview";
  }

  return "executive_overview";
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
  const {
    intent,
    state,
    office,
    candidate,
    locality,
    cycle,
    candidateId,
    committeeId,
  } = context;

  const common = {
    query: question,
    state,
    office,
    locality,
    cycle,
    limit,
    workspace_id: workspaceId,
  };

  const calls = [];

  calls.push(
    makeCall(
      "get_unified_executive_intelligence",
      common,
      "Establish the current VoterSpheres executive snapshot.",
      100
    )
  );

  if (state) {
    calls.push(
      makeCall(
        "get_state_operations",
        {
          state,
          locality,
          workspace_id: workspaceId,
        },
        "Measure state, locality, workspace, and task readiness.",
        90
      )
    );
  }

  if (
    [
      "race_overview",
      "candidate",
      "polling",
      "finance",
      "administration",
      "executive_overview",
    ].includes(intent)
  ) {
    calls.push(
      makeCall(
        "search_live_news",
        {
          query: question,
          state,
          locality,
          limit,
        },
        "Retrieve current verified reporting and public-source developments.",
        95
      )
    );
  }

 if (
  (state || candidate) &&
  [
    "race_overview",
    "candidate",
    "polling",
    "finance",
    "executive_overview",
  ].includes(intent)
) {
    calls.push(
      makeCall(
        "get_candidate_statistics",
        {
          candidate,
          state,
          office,
          cycle,
        },
        "Identify relevant candidates from the VoterSpheres database.",
        92
      )
    );
  }

  if (
    candidate ||
    intent === "candidate"
  ) {
    calls.push(
      makeCall(
        "get_candidate_live_intelligence",
        {
          candidate,
          candidate_id: candidateId,
          state,
          office,
          locality,
          cycle,
          limit,
        },
        "Combine candidate profile, live reporting, polling, finance, and database intelligence.",
        99
      )
    );
  }

  if (
    [
      "race_overview",
      "candidate",
      "polling",
      "executive_overview",
    ].includes(intent)
  ) {
    calls.push(
      makeCall(
        "get_latest_polling",
        {
          candidate,
          state,
          office,
          locality,
          cycle,
          limit,
        },
        "Retrieve configured polling records.",
        88
      )
    );
  }

  if (
  candidate ||
  candidateId ||
  committeeId ||
  intent === "finance"
) {
    calls.push(
      makeCall(
        "get_fec_finance",
        {
          candidate,
          candidate_id: candidateId,
          committee_id: committeeId,
          cycle,
        },
        "Retrieve official FEC totals when a candidate or committee identifier is available.",
        86
      )
    );
  }

  if (
    state &&
    [
      "race_overview",
      "administration",
      "executive_overview",
    ].includes(intent)
  ) {
    calls.push(
      makeCall(
        "get_election_administration_updates",
        {
          query:
            intent === "administration"
              ? question
              : `${STATE_NAMES[state] || state} election administration ballot access deadlines voting systems court rulings`,
          state,
          locality,
          limit,
        },
        "Check state election administration, deadlines, ballot access, and legal developments.",
        87
      )
    );
  }

  if (intent === "legislative") {
    calls.push(
      makeCall(
        "get_legislative_updates",
        {
          query: question,
          limit,
        },
        "Retrieve official Congress.gov legislative updates.",
        90
      )
    );
  }

  if (intent === "weather") {
    calls.push(
      makeCall(
        "get_weather_field_risk",
        {
          latitude: context.latitude,
          longitude: context.longitude,
          location:
            locality ||
            STATE_NAMES[state] ||
            state,
        },
        "Retrieve National Weather Service field risk.",
        90
      )
    );
  }

  const deduplicated = [
    ...new Map(
      calls.map((call) => [
        `${call.name}:${JSON.stringify(call.arguments)}`,
        call,
      ])
    ).values(),
  ];

  return deduplicated
    .sort((a, b) => b.priority - a.priority)
    .slice(0, clamp(MAX_TOOLS, 8, 1, 12));
}

function normalizeToolResult(call, result, elapsedMs) {
  const value =
    result && typeof result === "object"
      ? result
      : {};

  return {
    tool: call.name,
    reason: call.reason,
    arguments: call.arguments,
    ok: Boolean(value.ok),
    degraded: Boolean(value.degraded),
    summary: clean(value.summary),
    data: value.data ?? null,
    sources: Array.isArray(value.sources)
      ? value.sources
      : [],
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter(Boolean)
      : [],
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics
      : [],
    generated_at:
      value.generated_at ||
      value.fetched_at ||
      null,
    latency_ms: elapsedMs,
    raw: value,
  };
}

async function executePlannedTool(call, user) {
  const startedAt = Date.now();

  try {
    const output = await withTimeout(
      executeExecutiveVoiceTool({
        name: call.name,
        arguments: call.arguments,
        user,
      }),
      TOOL_TIMEOUT_MS,
      call.name
    );

    return normalizeToolResult(
      call,
      output,
      Date.now() - startedAt
    );
  } catch (error) {
    return {
      tool: call.name,
      reason: call.reason,
      arguments: call.arguments,
      ok: false,
      degraded: true,
      summary: `${call.name} failed.`,
      data: null,
      sources: [],
      warnings: [
        error?.message ||
          "Unknown tool execution failure.",
      ],
      diagnostics: [
        {
          provider: call.name,
          ok: false,
          latency_ms:
            Date.now() - startedAt,
          error:
            error?.message ||
            "Unknown tool execution failure.",
          checked_at: now(),
        },
      ],
      generated_at: null,
      latency_ms:
        Date.now() - startedAt,
      raw: null,
    };
  }
}

function sourceIdentity(source) {
  return clean(
    source?.url ||
      source?.source ||
      source?.name ||
      source?.provider
  ).toLowerCase();
}

function mergeSources(results) {
  const map = new Map();

  for (const result of results) {
    for (const source of result.sources) {
      const key =
        sourceIdentity(source) ||
        `${result.tool}:${map.size}`;

      if (!map.has(key)) {
        map.set(key, {
          ...source,
          tool: result.tool,
        });
      }
    }
  }

  return [...map.values()];
}

function flattenWarnings(results) {
  return uniqueStrings(
    results.flatMap((result) =>
      result.warnings.map(
        (warning) =>
          `${result.tool}: ${warning}`
      )
    )
  );
}

function flattenDiagnostics(results) {
  return results.flatMap((result) =>
    result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      tool: result.tool,
    }))
  );
}

function countMeaningfulItems(value, depth = 0) {
  if (depth > 4 || value == null) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (typeof value !== "object") {
    return clean(value) ? 1 : 0;
  }

  return Object.values(value).reduce(
    (total, child) =>
      total +
      countMeaningfulItems(
        child,
        depth + 1
      ),
    0
  );
}

function calculateCoverage(results) {
  const attempted = results.length;
  const successful = results.filter((item) => item.ok).length;
  const useful = results.filter(
    (item) =>
      item.ok &&
      (
        countMeaningfulItems(item.data) > 0 ||
        item.sources.length > 0 ||
        clean(item.summary)
      )
  ).length;

  const degraded = results.filter(
    (item) => item.degraded
  ).length;

  const score =
    attempted === 0
      ? 0
      : Math.round(
          (
            successful * 55 +
            useful * 35 +
            Math.max(0, attempted - degraded) * 10
          ) /
            attempted
        );

  return {
    attempted_tools: attempted,
    successful_tools: successful,
    useful_tools: useful,
    degraded_tools: degraded,
    coverage_score: Math.min(100, score),
  };
}

function calculateConfidence({
  coverage,
  sources,
  results,
}) {
  const sourceScore = Math.min(
    35,
    sources.length * 5
  );

  const successfulRatio =
    coverage.attempted_tools
      ? coverage.successful_tools /
        coverage.attempted_tools
      : 0;

  const successScore = Math.round(
    successfulRatio * 45
  );

  const nonDegraded = results.filter(
    (item) =>
      item.ok &&
      !item.degraded
  ).length;

  const qualityScore =
    coverage.attempted_tools
      ? Math.round(
          (
            nonDegraded /
            coverage.attempted_tools
          ) *
            20
        )
      : 0;

  return Math.min(
    100,
    sourceScore +
      successScore +
      qualityScore
  );
}

function collectEvidence(results) {
  return results
    .filter(
      (item) =>
        item.ok ||
        clean(item.summary) ||
        countMeaningfulItems(item.data) > 0
    )
    .map((item) => ({
      tool: item.tool,
      ok: item.ok,
      degraded: item.degraded,
      summary: item.summary,
      data: item.data,
      sources: item.sources,
      warnings: item.warnings,
    }));
}

function buildDeterministicBriefing({
  question,
  context,
  results,
  coverage,
  confidence,
  sources,
}) {
  const successful = results.filter(
    (item) => item.ok
  );

  const usefulSummaries = successful
    .map((item) => clean(item.summary))
    .filter(Boolean);

  const failed = results.filter(
    (item) => !item.ok
  );

  const scope = [
    context.candidate,
    context.office,
    context.state
      ? STATE_NAMES[context.state] ||
        context.state
      : "",
    context.locality,
    context.cycle,
  ]
    .filter(Boolean)
    .join(" · ");

  const headline =
    usefulSummaries[0] ||
    (
      scope
        ? `Executive intelligence for ${scope} is currently limited.`
        : "Executive intelligence coverage is currently limited."
    );

  const findings = usefulSummaries
    .slice(0, 6)
    .map((summary, index) => ({
      rank: index + 1,
      finding: summary,
      support: successful[index]?.tool || null,
    }));

  if (!findings.length) {
    findings.push({
      rank: 1,
      finding:
        "No tool returned a usable current result. The platform preserved the failed-provider diagnostics instead of generating unsupported political claims.",
      support: null,
    });
  }

  const gaps = failed.map((item) => ({
    tool: item.tool,
    issue:
      item.warnings[0] ||
      item.summary ||
      "No usable result.",
  }));

  const nextActions = [];

  if (
    !context.office &&
    context.state
  ) {
    nextActions.push(
      `Narrow the next request to a specific ${STATE_NAMES[context.state] || context.state} office or district.`
    );
  }

  if (
    !context.candidate &&
    ["candidate", "finance"].includes(context.intent)
  ) {
    nextActions.push(
      "Provide the candidate's full name, candidate ID, or committee ID."
    );
  }

  if (
    coverage.successful_tools <
    coverage.attempted_tools
  ) {
    nextActions.push(
      "Review provider diagnostics and retry unavailable live sources while retaining current database results."
    );
  }

  if (!nextActions.length) {
    nextActions.push(
      "Continue monitoring and rerun the briefing when new filings, polling, or verified reporting is published."
    );
  }

  return {
    headline,
    executive_summary:
      usefulSummaries.length
        ? usefulSummaries.join(" ")
        : (
            `The orchestrator attempted ${coverage.attempted_tools} intelligence tools, ` +
            `but none returned enough verified data to support a race assessment.`
          ),
    key_findings: findings,
    risks_and_gaps: gaps,
    recommended_actions: nextActions,
    confidence,
    source_count: sources.length,
    answer:
      [
        headline,
        "",
        ...findings.map(
          (item) =>
            `${item.rank}. ${item.finding}`
        ),
        "",
        `Confidence: ${confidence}%. Coverage: ${coverage.successful_tools}/${coverage.attempted_tools} tools successful. Sources: ${sources.length}.`,
        gaps.length
          ? `Data gaps: ${gaps
              .slice(0, 4)
              .map(
                (item) =>
                  `${item.tool} — ${item.issue}`
              )
              .join("; ")}`
          : "No major tool failures were reported.",
        `Next action: ${nextActions[0]}`,
      ].join("\n"),
  };
}

async function synthesizeWithOpenAI({
  question,
  context,
  evidence,
  coverage,
  confidence,
  sources,
}) {
  if (!openai) {
    return null;
  }

  const response = await withTimeout(
    openai.responses.create(
      {
        model:
          process.env.EXECUTIVE_ORCHESTRATOR_MODEL ||
          "gpt-5-mini",

        input:
          "You are the VoterSpheres Executive Intelligence Orchestrator. " +
          "Create a concise, fact-grounded executive political briefing using only the supplied tool evidence. " +
          "Never invent candidates, polling, fundraising totals, dates, race status, or source claims. " +
          "Explicitly distinguish verified findings from missing data. " +
          "When one tool fails but another succeeds, use the successful evidence and identify the gap. " +
          "Return ONLY valid JSON using this exact structure: " +
          '{"headline":"","executive_summary":"","key_findings":[{"rank":1,"finding":"","support":""}],"risks_and_gaps":[{"tool":"","issue":""}],"recommended_actions":[""],"answer":""}. ' +
          `Question: ${question}\n` +
          `Resolved context: ${JSON.stringify(context)}\n` +
          `Coverage: ${JSON.stringify(coverage)}\n` +
          `Calculated confidence: ${confidence}\n` +
          `Sources: ${JSON.stringify(sources.slice(0, 30))}\n` +
          `Tool evidence: ${JSON.stringify(evidence).slice(0, 90000)}`,
      },
      {
        timeout: SYNTHESIS_TIMEOUT_MS,
        maxRetries: 0,
      }
    ),
    SYNTHESIS_TIMEOUT_MS,
    "Executive briefing synthesis"
  );

  return extractJsonObject(
    response?.output_text || ""
  );
}

function resolveContext(payload = {}) {
  const question = clean(
    payload.question ||
      payload.query ||
      payload.prompt
  );

  const state = detectState(
    question,
    payload.state
  );

  const office = detectOffice(
    question,
    payload.office
  );

  const candidate = detectCandidate(
    question,
    payload.candidate
  );

  const locality = detectLocality(
    question,
    payload.locality
  );

  const cycle = detectCycle(
    question,
    payload.cycle
  );

  const context = {
    question,
    state,
    state_name:
      STATE_NAMES[state] ||
      null,
    office,
    candidate,
    locality,
    cycle,
    candidateId: clean(
      payload.candidate_id ||
        payload.fec_candidate_id
    ),
    committeeId: clean(
      payload.committee_id
    ),
    latitude:
      payload.latitude,
    longitude:
      payload.longitude,
  };

  return {
    ...context,
    intent: classifyIntent(
      question,
      context
    ),
  };
}

export function getExecutiveOrchestratorConfiguration() {
  return {
    ok: true,
    build: BUILD,
    model:
      process.env.EXECUTIVE_ORCHESTRATOR_MODEL ||
      "gpt-5-mini",
    openai_synthesis_configured:
      Boolean(openai),
    orchestrator_timeout_ms:
      ORCHESTRATOR_TIMEOUT_MS,
    tool_timeout_ms:
      TOOL_TIMEOUT_MS,
    synthesis_timeout_ms:
      SYNTHESIS_TIMEOUT_MS,
    max_tools:
      MAX_TOOLS,
    available_tool_interface:
      "executeExecutiveVoiceTool",
    generated_at: now(),
  };
}

export function createExecutiveIntelligencePlan({
  payload = {},
} = {}) {
  const question = clean(
    payload.question ||
      payload.query ||
      payload.prompt
  );

  if (!question) {
    const error = new Error(
      "A question, query, or prompt is required."
    );
    error.status = 400;
    throw error;
  }

  const context =
    resolveContext(payload);

  const workspaceId = Number(
    payload.workspace_id ||
      payload.workspaceId ||
      1
  );

  const limit = clamp(
    payload.limit,
    10,
    1,
    20
  );

  const toolPlan =
    buildToolPlan({
      question,
      context,
      workspaceId,
      limit,
    });

  return {
    ok: true,
    build: BUILD,
    question,
    context,
    workspace_id:
      workspaceId,
    limit,
    tool_plan:
      toolPlan,
    generated_at:
      now(),
  };
}

export async function runExecutiveIntelligenceOrchestrator({
  user = {},
  payload = {},
} = {}) {
  const startedAt =
    Date.now();

  const plan =
    createExecutiveIntelligencePlan({
      payload,
    });

  const executionPromise =
    Promise.all(
      plan.tool_plan.map(
        (call) =>
          executePlannedTool(
            call,
            user
          )
      )
    );

  const results =
    await withTimeout(
      executionPromise,
      ORCHESTRATOR_TIMEOUT_MS,
      "Executive Intelligence Orchestrator"
    );

  const sources =
    mergeSources(results);

  const warnings =
    flattenWarnings(results);

  const diagnostics =
    flattenDiagnostics(results);

  const coverage =
    calculateCoverage(results);

  const confidence =
    calculateConfidence({
      coverage,
      sources,
      results,
    });

  const evidence =
    collectEvidence(results);

  let briefing =
    buildDeterministicBriefing({
      question:
        plan.question,
      context:
        plan.context,
      results,
      coverage,
      confidence,
      sources,
    });

  let synthesisProvider =
    "deterministic";

  try {
    const aiBriefing =
      await synthesizeWithOpenAI({
        question:
          plan.question,
        context:
          plan.context,
        evidence,
        coverage,
        confidence,
        sources,
      });

    if (
      aiBriefing &&
      clean(
        aiBriefing.answer ||
          aiBriefing.executive_summary
      )
    ) {
      briefing = {
        ...briefing,
        ...aiBriefing,
        confidence,
        source_count:
          sources.length,
      };

      synthesisProvider =
        "openai";
    }
  } catch (error) {
    warnings.push(
      `briefing_synthesis: ${
        error?.message ||
        "OpenAI synthesis failed."
      }`
    );

    diagnostics.push({
      provider:
        "executive_briefing_synthesis",
      ok:
        false,
      error:
        error?.message ||
        "OpenAI synthesis failed.",
      checked_at:
        now(),
    });
  }

  const ok =
    coverage.successful_tools > 0;

  return {
    ok,
    build:
      BUILD,
    provider:
      "executive_intelligence_orchestrator",
    degraded:
      coverage.successful_tools <
      coverage.attempted_tools,
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
        new Date(startedAt).toISOString(),
      completed_at:
        now(),
      latency_ms:
        Date.now() - startedAt,
      coverage,
      confidence,
      synthesis_provider:
        synthesisProvider,
    },
    briefing,
    answer:
      briefing.answer ||
      briefing.executive_summary ||
      briefing.headline,
    tool_results:
      results,
    evidence,
    sources,
    warnings:
      uniqueStrings(warnings),
    diagnostics,
    generated_at:
      now(),
  };
}
