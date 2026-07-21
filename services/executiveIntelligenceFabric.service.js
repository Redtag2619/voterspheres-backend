import OpenAI from "openai";

import crypto from "node:crypto";


const MODEL = process.env.EXECUTIVE_FABRIC_MODEL || "gpt-4.1-mini";

const TOOL_TIMEOUT_MS = Number(process.env.EXECUTIVE_FABRIC_TOOL_TIMEOUT_MS || 7000);

const SYNTHESIS_TIMEOUT_MS = Number(process.env.EXECUTIVE_FABRIC_TIMEOUT_MS || 18000);

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;


const clean = (v = "") => String(v ?? "").trim();

const arr = (v) => Array.isArray(v) ? v : [];

const obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};

const clamp = (v, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min));

const now = () => new Date().toISOString();

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;


function timeout(promise, ms, name) {

  return Promise.race([

    promise,

    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)),

  ]);

}


function intentOf(question) {

  const q = clean(question).toLowerCase();

  if (/(fundrais|donor|fec|cash on hand|contribution|spending)/.test(q)) return "fundraising";

  if (/(poll|forecast|probability|margin|race rating|win)/.test(q)) return "forecast";

  if (/(vendor|consultant|firm|agency|media buyer|direct mail)/.test(q)) return "consultant";

  if (/(county|parish|state|district|locality)/.test(q)) return "state";

  if (/(news|headline|media|narrative|press)/.test(q)) return "news";

  if (/(simulate|scenario|what if|predict|model)/.test(q)) return "simulation";

  return "general";

}


function entitiesOf(question, context = {}) {

  const state = clean(context.state || question.match(/(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)/i)?.[1]);

  return {

    candidate: clean(context.candidate || context.candidate_name) || null,

    candidate_id: context.candidate_id || context.fec_candidate_id || null,

    state: state ? state.toUpperCase() : null,

    office: clean(context.office) || null,

    locality: clean(context.locality || context.county || context.parish) || null,

    cycle: clean(context.cycle) || String(new Date().getFullYear()),

  };

}


function authority(provider) {

  const p = clean(provider).toLowerCase();

  if (/(fec|census|secretary of state|election authority)/.test(p)) return 98;

  if (/(reuters|associated press|ap|pew|gallup|cook political|inside elections)/.test(p)) return 90;

  if (/(poll|newsapi|gnews)/.test(p)) return 76;

  return 62;

}


function freshness(source) {

  const raw = source.published_at || source.updated_at || source.generated_at || source.date;

  if (!raw) return 45;

  const timestamp = new Date(raw).getTime();

  if (!Number.isFinite(timestamp)) return 45;

  const hours = Math.max(0, (Date.now() - timestamp) / 3600000);

  if (hours <= 6) return 100;

  if (hours <= 24) return 92;

  if (hours <= 72) return 82;

  if (hours <= 168) return 70;

  if (hours <= 720) return 55;

  return 35;

}


function rankSources(input) {

  return arr(input).map((raw, index) => {

    const source = typeof raw === "string" ? { name: raw } : obj(raw);

    const provider = clean(source.provider || source.publisher || source.source || source.name || `Source ${index + 1}`);

    const reliability_score = clamp(source.reliability_score ?? authority(provider));

    const freshness_score = clamp(source.freshness_score ?? freshness(source));

    const relevance_score = clamp(source.relevance_score ?? 72);

    return {

      ...source,

      id: source.id || uid("source"),

      provider,

      name: clean(source.name || source.title || provider),

      title: clean(source.title || source.name || provider),

      url: clean(source.url || source.link || source.source_url) || null,

      published_at: source.published_at || source.updated_at || source.date || null,

      reliability_score,

      freshness_score,

      relevance_score,

      rank_score: Math.round(reliability_score * .45 + freshness_score * .25 + relevance_score * .30),

    };

  }).sort((a, b) => b.rank_score - a.rank_score).slice(0, 30);

}


async function runTool(name, adapter, context) {

  const started = Date.now();

  try {

    const response = obj(await timeout(Promise.resolve(adapter(context)), TOOL_TIMEOUT_MS, name));

    const sources = rankSources(arr(response.sources).map((source) => ({ ...obj(source), tool: name })));

    return {

      tool: name,

      ok: response.ok !== false,

      meaningful: response.meaningful ?? Boolean(sources.length || clean(response.summary) || Object.keys(obj(response.data)).length),

      degraded: Boolean(response.degraded),

      summary: clean(response.summary),

      data: response.data ?? null,

      sources,

      warning: clean(response.warning) || null,

      error: null,

      latency_ms: Date.now() - started,

      generated_at: now(),

    };

  } catch (error) {

    return { tool: name, ok: false, meaningful: false, degraded: true, summary: "", data: null, sources: [], warning: null, error: clean(error?.message || error), latency_ms: Date.now() - started, generated_at: now() };

  }

}


function selectedTools(intent, adapters) {

  const map = {

    fundraising: ["candidate", "fec", "news", "forecast"],

    forecast: ["polling", "forecast", "candidate", "news", "state"],

    consultant: ["consultant", "candidate", "state", "news"],

    state: ["state", "polling", "forecast", "news"],

    news: ["news", "candidate", "forecast", "state"],

    simulation: ["forecast", "polling", "candidate", "state", "news"],

    general: ["candidate", "fec", "polling", "forecast", "news", "state", "consultant"],

  };

  return (map[intent] || map.general).filter((name) => typeof adapters[name] === "function");

}


function metrics(results, sources) {

  const attempted = results.length;

  const successful = results.filter((x) => x.ok).length;

  const meaningful = results.filter((x) => x.meaningful).length;

  const degraded = results.filter((x) => x.degraded).length;

  const coverage = attempted ? Math.round(meaningful / attempted * 100) : 0;

  const sourceRank = sources.length ? sources.reduce((sum, x) => sum + x.rank_score, 0) / sources.length : 0;

  return {

    coverage: { attempted_tools: attempted, successful_tools: successful, meaningful_tools: meaningful, degraded_tools: degraded, failed_tools: attempted - successful, coverage_score: coverage },

    confidence: clamp(Math.round(coverage * .55 + sourceRank * .45)),

  };

}


function fallbackBrief({ intent, results, coverage, confidence, entities }) {

  const findings = results.filter((x) => x.meaningful).slice(0, 5).map((x, index) => ({ rank: index + 1, finding: x.summary || `${x.tool} returned usable evidence.`, support: x.tool }));

  const risks = results.filter((x) => !x.ok || x.degraded).slice(0, 5).map((x) => ({ id: uid("risk"), tool: x.tool, issue: x.error || x.warning || `${x.tool} returned degraded data.` }));

  return {

    headline: `Executive intelligence assessment: ${intent}`,

    executive_summary: findings.length ? `The fabric completed ${coverage.successful_tools} of ${coverage.attempted_tools} retrievals and produced ${coverage.meaningful_tools} usable evidence streams at ${confidence}% confidence.` : "The fabric could not retrieve enough live evidence for a grounded recommendation.",

    key_findings: findings,

    risks_and_gaps: risks,

    recommended_actions: ["Validate the highest-ranked evidence before operational execution.", "Refresh degraded providers before making an irreversible decision.", entities.state ? `Compare ${entities.state} movement with national movement.` : "Resolve the relevant state or district for localized guidance."],

    answer: findings.map((x) => `${x.rank}. ${x.finding}`).join("\n"),

") || "No grounded answer is available because live evidence was unavailable.",

  };

}


async function synthesize(context) {

  if (!openai || !context.coverage.meaningful_tools) return null;

  const response = await timeout(openai.responses.create({

    model: MODEL,

    input: [{ role: "system", content: "You are the VoterSpheres Executive Intelligence Fabric. Use only supplied evidence. Separate facts, inference, uncertainty, and recommendations. Return concise JSON with headline, executive_summary, key_findings, risks_and_gaps, recommended_actions, answer." }, { role: "user", content: JSON.stringify(context) }],

    text: { format: { type: "json_schema", name: "executive_brief", strict: true, schema: { type: "object", additionalProperties: false, properties: { headline: { type: "string" }, executive_summary: { type: "string" }, key_findings: { type: "array", items: { type: "object", additionalProperties: false, properties: { rank: { type: "number" }, finding: { type: "string" }, support: { type: ["string", "null"] } }, required: ["rank", "finding", "support"] } }, risks_and_gaps: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, tool: { type: ["string", "null"] }, issue: { type: "string" } }, required: ["id", "tool", "issue"] } }, recommended_actions: { type: "array", items: { type: "string" } }, answer: { type: "string" } }, required: ["headline", "executive_summary", "key_findings", "risks_and_gaps", "recommended_actions", "answer"] } } },

  }), SYNTHESIS_TIMEOUT_MS, "OpenAI synthesis");

  return response.output_text ? JSON.parse(response.output_text) : null;

}


export function createExecutiveIntelligenceFabric({ adapters = {}, memory = null } = {}) {

  return {

    async plan({ question, context = {} }) {

      const intent = intentOf(question);

      return { ok: true, intent, entities: entitiesOf(question, context), tools: selectedTools(intent, adapters), generated_at: now() };

    },

    async brief({ question, workspace_id = 1, user_id = null, context = {} }) {

      const started = Date.now();

      const plan = await this.plan({ question, context });

      const memory_context = memory?.read ? await memory.read({ workspace_id, user_id, question, entities: plan.entities }) : null;

      const executionContext = { question, workspace_id, user_id, context, intent: plan.intent, entities: plan.entities, memory: memory_context };

      const tool_results = await Promise.all(plan.tools.map((name) => runTool(name, adapters[name], executionContext)));

      const sources = rankSources(tool_results.flatMap((x) => x.sources));

      const { coverage, confidence } = metrics(tool_results, sources);

      const evidence_status = !coverage.meaningful_tools && !sources.length ? "unavailable" : coverage.failed_tools || coverage.degraded_tools || coverage.coverage_score < 70 ? "partial" : "live";

      const synthesisContext = { question, intent: plan.intent, entities: plan.entities, coverage, confidence, evidence_status, sources, tool_results };

      let briefing = null;

      let synthesis_mode = "deterministic";

      try { briefing = await synthesize(synthesisContext); if (briefing) synthesis_mode = "openai"; } catch { briefing = null; }

      briefing ||= fallbackBrief({ intent: plan.intent, results: tool_results, coverage, confidence, entities: plan.entities });

      const result = { ok: true, build: "4.2.0", service: "executive-intelligence-fabric", question, workspace_id: Number(workspace_id || 1), intent: plan.intent, entities: plan.entities, briefing, answer: briefing.answer, headline: briefing.headline, executive_summary: briefing.executive_summary, confidence, confidence_percentage: confidence, evidence_status, live_data_available: evidence_status !== "unavailable", grounded: coverage.meaningful_tools > 0, coverage, ranked_sources: sources, sources, citations: sources, tool_results, diagnostics: tool_results.map((x) => ({ provider: x.tool, tool: x.tool, ok: x.ok, degraded: x.degraded, latency_ms: x.latency_ms, item_count: x.sources.length, error: x.error, checked_at: x.generated_at })), memory_context, synthesis_mode, latency_ms: Date.now() - started, generated_at: now() };

      if (memory?.write) await memory.write({ workspace_id, user_id, question, result });

      return result;

    },

    async simulate({ question, workspace_id = 1, context = {}, scenarios = [] }) {

      const base = await this.brief({ question, workspace_id, context });

      return { ok: true, build: "4.2.0", service: "executive-intelligence-fabric", base, scenarios: arr(scenarios).slice(0, 6).map((raw, index) => { const x = obj(raw); const probability = clamp(x.probability ?? 50); const impact = clamp(x.impact ?? 50); return { id: x.id || uid("scenario"), name: clean(x.name || `Scenario ${index + 1}`), assumptions: arr(x.assumptions).map(clean).filter(Boolean), probability, impact, risk_score: Math.round((100 - probability) * .45 + impact * .55), recommendation: impact >= 70 ? "Prepare an immediate contingency plan." : impact >= 40 ? "Monitor and establish decision triggers." : "Track as a secondary scenario." }; }), generated_at: now() };

    },

    async health() { return { ok: true, build: "4.2.0", service: "executive-intelligence-fabric", openai_configured: Boolean(openai), model: MODEL, tools: Object.keys(adapters), generated_at: now() }; },

  };

}


export default createExecutiveIntelligenceFabric;
