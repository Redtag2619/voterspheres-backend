import OpenAI from "openai";
import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

const BUILD = "4.1.0-part1";
const ORCHESTRATOR_TIMEOUT_MS = Number(process.env.EXECUTIVE_ORCHESTRATOR_TIMEOUT_MS) || 35000;
const TOOL_TIMEOUT_MS = Number(process.env.EXECUTIVE_ORCHESTRATOR_TOOL_TIMEOUT_MS) || 20000;
const SYNTHESIS_TIMEOUT_MS = Number(process.env.EXECUTIVE_ORCHESTRATOR_SYNTHESIS_TIMEOUT_MS) || 18000;
const MAX_TOOLS = Number(process.env.EXECUTIVE_ORCHESTRATOR_MAX_TOOLS) || 9;
const MODEL = process.env.EXECUTIVE_ORCHESTRATOR_MODEL || "gpt-5-mini";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: SYNTHESIS_TIMEOUT_MS, maxRetries: 1 })
  : null;

const STATE_NAMES = Object.freeze({
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia"
});
const STATE_CODES = Object.fromEntries(Object.entries(STATE_NAMES).map(([code,name]) => [name.toLowerCase(), code]));
const now = () => new Date().toISOString();
const clean = (value = "") => String(value ?? "").trim();
const unique = (values = []) => [...new Set(values.map(clean).filter(Boolean))];
const clamp = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms.`), { code: "ORCHESTRATOR_TIMEOUT" })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safeJson(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function extractJsonObject(value) {
  const text = clean(value);
  if (!text) return null;
  const direct = safeJson(text);
  if (direct) return direct;
  const unfenced = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = safeJson(unfenced);
  if (parsed) return parsed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? safeJson(text.slice(start, end + 1)) : null;
}

function detectState(question, suppliedState = "") {
  const explicit = clean(suppliedState).toUpperCase();
  if (STATE_NAMES[explicit]) return explicit;
  const lower = clean(question).toLowerCase();
  for (const [name, code] of Object.entries(STATE_CODES)) if (lower.includes(name)) return code;
  const match = clean(question).match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function detectCycle(question, suppliedCycle = "") {
  const explicit = clean(suppliedCycle);
  if (/^20\d{2}$/.test(explicit)) return explicit;
  const match = clean(question).match(/\b(20\d{2})\b/);
  return match?.[1] || String(new Date().getFullYear());
}

function detectOffice(question, suppliedOffice = "") {
  const explicit = clean(suppliedOffice);
  if (explicit) return explicit;
  const lower = clean(question).toLowerCase();
  const pairs = [["president","President"],["governor","Governor"],["u.s. senate","U.S. Senate"],["us senate","U.S. Senate"],["senate","U.S. Senate"],["u.s. house","U.S. House"],["congress","U.S. House"],["attorney general","Attorney General"],["secretary of state","Secretary of State"],["mayor","Mayor"]];
  return pairs.find(([needle]) => lower.includes(needle))?.[1] || "";
}

function detectCandidate(question, suppliedCandidate = "") {
  const explicit = clean(suppliedCandidate);
  if (explicit) return explicit;
  const text = clean(question);
  const quoted = text.match(/["“]([^"”]{3,80})["”]/);
  if (quoted) return clean(quoted[1]);
  const patterns = [
    /(?:about|candidate|profile|statistics|polling|fundraising|finance|news on|news about|tell me about|show me)\s+(?:for\s+)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(?:campaign|polling|fundraising|finance|candidate|race|statistics|news)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && !Object.values(STATE_NAMES).includes(clean(match[1]))) return clean(match[1]);
  }
  return "";
}

function classifyIntent(question, context) {
  const lower = clean(question).toLowerCase();
  if (context.candidate || /\bcandidate\b|\bcampaign\b|\bprofile\b|\bbiograph/.test(lower)) return "candidate";
  if (/\bpoll|margin|horse race|leading/.test(lower)) return "polling";
  if (/\bfec\b|fundrais|donor|cash on hand|finance/.test(lower)) return "finance";
  if (/operations|field|county|parish|task|workspace|readiness/.test(lower)) return "operations";
  if (/deadline|ballot access|election administration|voting system|court ruling/.test(lower)) return "administration";
  if (/legislat|\bbill\b|committee hearing|congress\.gov/.test(lower)) return "legislative";
  if (/weather|storm|rain|heat|field risk/.test(lower)) return "weather";
  if (/race|election|political|statewide|district/.test(lower)) return "race_overview";
  return "executive_overview";
}

function resolveContext(payload = {}) {
  const question = clean(payload.question || payload.query || payload.prompt);
  const context = {
    question,
    state: detectState(question, payload.state),
    office: detectOffice(question, payload.office),
    candidate: detectCandidate(question, payload.candidate),
    cycle: detectCycle(question, payload.cycle),
    locality: clean(payload.locality),
    candidate_id: clean(payload.candidate_id || payload.fec_candidate_id),
    committee_id: clean(payload.committee_id),
    latitude: payload.latitude,
    longitude: payload.longitude,
  };
  context.state_name = STATE_NAMES[context.state] || null;
  context.intent = classifyIntent(question, context);
  return context;
}

function makeCall(name, args, reason, priority) { return { name, arguments: args, reason, priority }; }

function buildToolPlan({ question, context, workspaceId, limit }) {
  const common = { query: question, state: context.state, office: context.office, locality: context.locality, cycle: context.cycle, limit, workspace_id: workspaceId };
  const calls = [makeCall("get_unified_executive_intelligence", common, "Load the VoterSpheres executive operating picture.", 100)];
  const liveIntent = ["candidate","polling","finance","race_overview","administration","executive_overview"].includes(context.intent);
  if (liveIntent) calls.push(makeCall("search_live_news", { query: question, state: context.state, locality: context.locality, limit }, "Retrieve current political reporting from configured providers.", 98));
  if (context.candidate) calls.push(makeCall("get_candidate_live_intelligence", { candidate: context.candidate, candidate_id: context.candidate_id, committee_id: context.committee_id, state: context.state, office: context.office, locality: context.locality, cycle: context.cycle, limit }, "Resolve the candidate and combine profile, news, polling, and finance.", 99));
  if (context.candidate || context.state) calls.push(makeCall("get_candidate_statistics", { candidate: context.candidate, candidate_id: context.candidate_id, state: context.state, office: context.office, cycle: context.cycle }, "Load stored candidate records as verified internal evidence.", 90));
  if (["candidate","polling","race_overview","executive_overview"].includes(context.intent)) calls.push(makeCall("get_latest_polling", { candidate: context.candidate, state: context.state, office: context.office, locality: context.locality, limit }, "Retrieve external polling with local fallback.", 88));
  if (context.candidate || context.candidate_id || context.committee_id || context.intent === "finance") calls.push(makeCall("get_fec_finance", { candidate: context.candidate, candidate_id: context.candidate_id, committee_id: context.committee_id, cycle: context.cycle }, "Retrieve OpenFEC or synchronized FEC finance records.", 87));
  if (context.state) calls.push(makeCall("get_state_operations", { state: context.state, locality: context.locality, workspace_id: workspaceId }, "Load state and locality operational intelligence.", 86));
  if (context.state && ["administration","race_overview","executive_overview"].includes(context.intent)) calls.push(makeCall("get_election_administration_updates", { query: `${STATE_NAMES[context.state]} election administration deadlines ballot access voting systems court rulings`, state: context.state, locality: context.locality, limit }, "Check current election administration and legal developments.", 84));
  if (context.intent === "legislative") calls.push(makeCall("get_legislative_updates", { query: question, limit }, "Retrieve official legislative updates.", 92));
  if (context.intent === "weather" && context.latitude != null && context.longitude != null) calls.push(makeCall("get_weather_field_risk", { latitude: context.latitude, longitude: context.longitude, location: context.locality || context.state_name }, "Retrieve official field weather risk.", 92));
  return [...new Map(calls.map(call => [`${call.name}:${JSON.stringify(call.arguments)}`, call])).values()].sort((a,b) => b.priority-a.priority).slice(0, clamp(MAX_TOOLS, 9, 1, 12));
}

function countItems(value, depth = 0) {
  if (value == null || depth > 5) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + (typeof item === "object" ? countItems(item, depth + 1) : 1), 0);
  if (typeof value !== "object") return clean(value) ? 1 : 0;
  return Object.values(value).reduce((sum, child) => sum + countItems(child, depth + 1), 0);
}

function normalizeToolResult(call, result, latencyMs) {
  const value = result && typeof result === "object" ? result : {};
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const meaningful_item_count = countItems(value.data);
  const usable = Boolean(value.ok && (meaningful_item_count > 0 || sources.length > 0));
  return { tool: call.name, reason: call.reason, arguments: call.arguments, ok: Boolean(value.ok), usable, degraded: Boolean(value.degraded), summary: clean(value.summary), data: value.data ?? null, sources, warnings: Array.isArray(value.warnings) ? value.warnings.filter(Boolean) : [], diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : [], generated_at: value.generated_at || value.fetched_at || null, latency_ms: latencyMs, meaningful_item_count };
}

async function executePlannedTool(call, user) {
  const started = Date.now();
  try {
    const output = await withTimeout(executeExecutiveVoiceTool({ name: call.name, arguments: call.arguments, user }), TOOL_TIMEOUT_MS, call.name);
    return normalizeToolResult(call, output, Date.now() - started);
  } catch (error) {
    return { tool: call.name, reason: call.reason, arguments: call.arguments, ok: false, usable: false, degraded: true, summary: `${call.name} failed.`, data: null, sources: [], warnings: [error?.message || "Unknown tool failure."], diagnostics: [{ provider: call.name, ok: false, error: error?.message || "Unknown tool failure.", latency_ms: Date.now() - started, checked_at: now() }], generated_at: null, latency_ms: Date.now() - started, meaningful_item_count: 0 };
  }
}

function mergeSources(results) {
  const map = new Map();
  for (const result of results) for (const source of result.sources) {
    const key = clean(source?.url || source?.source_url || source?.source || source?.name || source?.provider).toLowerCase() || `${result.tool}:${map.size}`;
    if (!map.has(key)) map.set(key, { ...source, tool: result.tool });
  }
  return [...map.values()];
}

function buildCoverage(results, sources) {
  const attempted = results.length;
  const successful = results.filter(item => item.ok).length;
  const useful = results.filter(item => item.usable).length;
  const degraded = results.filter(item => item.degraded).length;
  const currentEvidence = sources.filter(source => source.published_at || source.reporting_period || source.freshness).length;
  const score = attempted ? Math.round((useful / attempted) * 65 + Math.min(25, sources.length * 3) + Math.min(10, currentEvidence * 2)) : 0;
  return { attempted_tools: attempted, successful_tools: successful, useful_tools: useful, degraded_tools: degraded, source_count: sources.length, dated_source_count: currentEvidence, coverage_score: Math.min(100, score), evidence_status: useful > 0 ? (degraded ? "partial" : "live") : "unavailable" };
}

function calculateConfidence(coverage) {
  if (!coverage.useful_tools) return 0;
  return Math.min(100, Math.round(coverage.coverage_score * 0.7 + Math.min(30, coverage.source_count * 4)));
}

function deterministicBrief({ question, context, results, coverage, confidence, sources }) {
  const usable = results.filter(item => item.usable);
  const findings = usable.slice(0, 8).map((item, index) => ({ rank: index + 1, finding: item.summary || `${item.tool} returned verified evidence.`, support: item.tool }));
  const gaps = results.filter(item => !item.usable).map(item => ({ tool: item.tool, issue: item.warnings[0] || item.summary || "No usable evidence returned." }));
  const scope = [context.candidate, context.office, context.state_name, context.locality, context.cycle].filter(Boolean).join(" - ");
  const headline = findings[0]?.finding || `No verified live intelligence is currently available${scope ? ` for ${scope}` : ""}.`;
  const answer = findings.length
    ? [headline, "", ...findings.map(item => `${item.rank}. ${item.finding}`), "", `Evidence status: ${coverage.evidence_status}. Confidence: ${confidence}%. Tools with usable evidence: ${coverage.useful_tools}/${coverage.attempted_tools}. Sources: ${sources.length}.`, gaps.length ? `Data gaps: ${gaps.slice(0,5).map(item => `${item.tool}: ${item.issue}`).join("; ")}` : "No major provider gaps were reported."].join("\n")
    : `VoterSpheres could not retrieve enough verified evidence to answer: "${question}". The system will not substitute generic model knowledge for unavailable live political data. Review provider diagnostics, authentication, and API-key configuration.`;
  return { headline, executive_summary: findings.map(item => item.finding).join(" ") || answer, key_findings: findings, risks_and_gaps: gaps, recommended_actions: gaps.length ? ["Review provider diagnostics and environment variables, then rerun the briefing."] : ["Continue monitoring for new verified filings, polls, and reporting."], answer, confidence, source_count: sources.length };
}

async function synthesizeWithOpenAI({ question, context, results, coverage, confidence, sources, deterministic }) {
  if (!openai || coverage.useful_tools === 0) return null;
  const evidence = results.filter(item => item.usable).map(item => ({ tool: item.tool, summary: item.summary, data: item.data, sources: item.sources, warnings: item.warnings }));
  const response = await withTimeout(openai.responses.create({
    model: MODEL,
    input: [
      "You are the VoterSpheres Executive Intelligence Orchestrator.",
      "Use only the supplied retrieved evidence. Do not use unsupported model memory as current political fact.",
      "State exact publication dates, field dates, filing periods, and reporting periods when present.",
      "If evidence is partial, say so. Never invent candidates, polling values, finance totals, offices, race status, or state developments.",
      "Return only valid JSON with: headline, executive_summary, key_findings, risks_and_gaps, recommended_actions, answer.",
      `Question: ${question}`,
      `Context: ${JSON.stringify(context)}`,
      `Coverage: ${JSON.stringify(coverage)}`,
      `Confidence: ${confidence}`,
      `Sources: ${JSON.stringify(sources.slice(0,40))}`,
      `Retrieved evidence: ${JSON.stringify(evidence).slice(0,110000)}`,
      `Deterministic fallback: ${JSON.stringify(deterministic)}`
    ].join("\n")
  }), SYNTHESIS_TIMEOUT_MS, "Executive briefing synthesis");
  return extractJsonObject(response?.output_text || "");
}

export function getExecutiveOrchestratorConfiguration() {
  return { ok: true, build: BUILD, model: MODEL, openai_synthesis_configured: Boolean(openai), live_intelligence_policy: "retrieved-evidence-required", orchestrator_timeout_ms: ORCHESTRATOR_TIMEOUT_MS, tool_timeout_ms: TOOL_TIMEOUT_MS, synthesis_timeout_ms: SYNTHESIS_TIMEOUT_MS, max_tools: MAX_TOOLS, generated_at: now() };
}

export function createExecutiveIntelligencePlan({ payload = {} } = {}) {
  const question = clean(payload.question || payload.query || payload.prompt);
  if (!question) throw Object.assign(new Error("A question, query, or prompt is required."), { status: 400 });
  const context = resolveContext(payload);
  const workspaceId = Number(payload.workspace_id || payload.workspaceId || 1);
  const limit = clamp(payload.limit, 12, 1, 20);
  return { ok: true, build: BUILD, question, context, workspace_id: workspaceId, limit, tool_plan: buildToolPlan({ question, context, workspaceId, limit }), generated_at: now() };
}

export async function runExecutiveIntelligenceOrchestrator({ user = {}, payload = {} } = {}) {
  const startedAt = Date.now();
  const plan = createExecutiveIntelligencePlan({ payload });
  const results = await withTimeout(Promise.all(plan.tool_plan.map(call => executePlannedTool(call, user))), ORCHESTRATOR_TIMEOUT_MS, "Executive Intelligence Orchestrator");
  const sources = mergeSources(results);
  const coverage = buildCoverage(results, sources);
  const confidence = calculateConfidence(coverage);
  const warnings = unique(results.flatMap(item => item.warnings.map(warning => `${item.tool}: ${warning}`)));
  const diagnostics = results.flatMap(item => item.diagnostics.map(diagnostic => ({ ...diagnostic, tool: item.tool })));
  let briefing = deterministicBrief({ question: plan.question, context: plan.context, results, coverage, confidence, sources });
  let synthesisProvider = "deterministic";
  try {
    const ai = await synthesizeWithOpenAI({ question: plan.question, context: plan.context, results, coverage, confidence, sources, deterministic: briefing });
    if (ai && clean(ai.answer || ai.executive_summary)) {
      briefing = { ...briefing, ...ai, confidence, source_count: sources.length };
      synthesisProvider = "openai-grounded";
    }
  } catch (error) {
    warnings.push(`briefing_synthesis: ${error?.message || "OpenAI synthesis failed."}`);
    diagnostics.push({ provider: "openai", tool: "briefing_synthesis", ok: false, error: error?.message || "OpenAI synthesis failed.", checked_at: now() });
  }
  return {
    ok: coverage.useful_tools > 0,
    build: BUILD,
    provider: "executive_intelligence_orchestrator",
    degraded: coverage.evidence_status !== "live",
    live_data_available: coverage.useful_tools > 0,
    question: plan.question,
    context: plan.context,
    workspace_id: plan.workspace_id,
    plan: { tool_count: plan.tool_plan.length, tools: plan.tool_plan },
    execution: { started_at: new Date(startedAt).toISOString(), completed_at: now(), latency_ms: Date.now() - startedAt, coverage, confidence, synthesis_provider: synthesisProvider },
    briefing,
    answer: briefing.answer || briefing.executive_summary || briefing.headline,
    tool_results: results,
    evidence: results.filter(item => item.usable),
    sources,
    warnings: unique(warnings),
    diagnostics,
    generated_at: now()
  };
}
