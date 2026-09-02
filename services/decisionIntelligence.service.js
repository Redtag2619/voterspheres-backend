import { pool } from "../db/pool.js";

 

import { getUnifiedExecutiveIntelligence } from "./unifiedExecutiveIntelligence.service.js";

import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";

import { getExecutiveWorkspaceDashboard } from "./executiveWorkspace.service.js";

import { getStrategyRecommendations } from "./strategyRecommendation.service.js";

import { getForecastBattlegrounds, getForecastSummary } from "./forecast.service.js";

import { getCoalitionActions, getCoalitionRankings } from "./coalitionIntelligence.service.js";

import { getInfluenceAlerts, getInfluenceRankings } from "./influence.service.js";

 

/**

 * VoterSpheres Executive Decision Intelligence 2.0

 *

 * This service replaces the old seeded/fallback architecture with live synthesis.

 * It intentionally does NOT read from executive_decisions / executive_decision_*.

 * Empty authoritative evidence may legitimately produce zero decisions.

 */

 

const BUILD = "2.0.0-live-synthesis";

const SOURCE_TIMEOUT_MS = Number(process.env.DECISION_INTELLIGENCE_SOURCE_TIMEOUT_MS || 12000);

const MAX_DECISIONS = Number(process.env.DECISION_INTELLIGENCE_MAX_DECISIONS || 8);

const MAX_SIGNALS = Number(process.env.DECISION_INTELLIGENCE_MAX_SIGNALS || 20);

const MATERIALITY_THRESHOLD = Number(process.env.DECISION_INTELLIGENCE_MATERIALITY_THRESHOLD || 68);

 

const NATIONAL_VALUES = new Set([

  "",

  "national",

  "nationwide",

  "us",

  "u.s.",

  "u.s",

  "united states",

]);

 

const clean = (value = "") => String(value ?? "").trim();

const lower = (value = "") => clean(value).toLowerCase();

const arr = (value) => (Array.isArray(value) ? value : []);

const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const nowIso = () => new Date().toISOString();

 

function number(value, fallback = 0) {

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;

}

 

function integer(value, fallback = 0) {

  return Math.round(number(value, fallback));

}

 

function clamp(value, min = 0, max = 100) {

  return Math.max(min, Math.min(max, number(value, 0)));

}

 

function average(values = []) {

  const valid = arr(values).map(Number).filter(Number.isFinite);

  if (!valid.length) return 0;

  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);

}

 

function unique(values = []) {

  return [...new Set(arr(values).filter(Boolean))];

}

 

function firstDefined(...values) {

  for (const value of values) {

    if (value !== undefined && value !== null && value !== "") return value;

  }

  return null;

}

 

function firstText(...values) {

  for (const value of values) {

    const text = clean(value);

    if (text) return text;

  }

  return "";

}

 

function safeDate(value) {

  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();

}

 

function isNational(value = "") {

  return NATIONAL_VALUES.has(lower(value));

}

 

function normalizeState(value = "") {

  const text = clean(value);

  if (!text || isNational(text)) return "";

  return text.toUpperCase();

}

 

function getFirmId(user = {}) {

  return Number(

    user?.firm_id ||

      user?.firmId ||

      user?.workspace?.firm_id ||

      user?.organization?.firm_id ||

      0

  );

}

 

function canonicalPriority(value = "") {

  const normalized = lower(value);

  if (["critical", "urgent", "severe"].includes(normalized)) return "critical";

  if (["high", "elevated"].includes(normalized)) return "high";

  if (["medium", "moderate", "normal"].includes(normalized)) return "medium";

  if (["low", "stable", "monitor"].includes(normalized)) return "low";

  return normalized || "medium";

}

 

function priorityWeight(priority = "") {

  switch (canonicalPriority(priority)) {

    case "critical": return 100;

    case "high": return 86;

    case "medium": return 66;

    case "low": return 42;

    default: return 55;

  }

}

 

function canonicalRisk(value = "") {

  const normalized = lower(value);

  if (["critical", "severe"].includes(normalized)) return "Critical";

  if (["high", "elevated"].includes(normalized)) return "High";

  if (["medium", "moderate"].includes(normalized)) return "Medium";

  if (["low", "stable"].includes(normalized)) return "Stable";

  return clean(value) || "Stable";

}

 

function statusFromPriority(priority = "") {

  const normalized = canonicalPriority(priority);

  if (["critical", "high"].includes(normalized)) return "open";

  if (normalized === "medium") return "review";

  return "monitoring";

}

 

function smartRoute(text = "", explicitRoute = "") {

  const explicit = clean(explicitRoute);

  if (explicit.startsWith("/")) return explicit;

 

  const value = lower(text);

  if (/relationship|network|influence graph/.test(value)) return "/relationship-graph";

  if (/dark money|fec|pac|campaign finance/.test(value)) return "/dark-money-exposure";

  if (/consultant/.test(value)) return "/consultant-intel";

  if (/vendor|media|direct mail|capacity/.test(value)) return "/vendors";

  if (/fundrais|donor|finance|receivable/.test(value)) return "/fundraising-dashboard";

  if (/crm|client|follow.?up|contact/.test(value)) return "/campaign-crm";

  if (/county|field|gotv|operation|execution|task|backlog/.test(value)) return "/operations-map";

  if (/coalition|strategy|path to victory/.test(value)) return "/strategy";

  if (/battleground|forecast|race pressure|race/.test(value)) return "/national-command";

  if (/political signal|narrative|news|signal/.test(value)) return "/political-signals";

  if (/candidate|opponent/.test(value)) return "/candidates";

  return "/command-center";

}

 

function withTimeout(promise, timeoutMs, label) {

  let timeoutId;

  const timeout = new Promise((_, reject) => {

    timeoutId = setTimeout(() => {

      const error = new Error(`${label} timed out after ${timeoutMs}ms.`);

      error.code = "SOURCE_TIMEOUT";

      reject(error);

    }, timeoutMs);

  });

 

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));

}

 

async function runSource(key, loader, { optional = false } = {}) {

  const startedAt = Date.now();

  try {

    const data = await withTimeout(Promise.resolve().then(loader), SOURCE_TIMEOUT_MS, key);

    return {

      key,

      ok: true,

      status: "available",

      optional,

      duration_ms: Date.now() - startedAt,

      error: "",

      data,

    };

  } catch (error) {

    console.warn(`[decision-intelligence] ${key} unavailable:`, error.message);

    return {

      key,

      ok: false,

      status: optional ? "unavailable" : "degraded",

      optional,

      duration_ms: Date.now() - startedAt,

      error: clean(error?.message).slice(0, 500),

      data: null,

    };

  }

}

 

async function resolveWorkspace(workspaceId) {

  const id = Number(workspaceId);

  if (!Number.isFinite(id) || id <= 0) return null;

 

  const result = await pool.query(

    `

      SELECT

        id,

        firm_id,

        name,

        slug,

        candidate_name,

        state,

        office,

        cycle,

        status,

        description,

        metadata,

        created_at,

        updated_at

      FROM workspaces

      WHERE id = $1

      LIMIT 1

    `,

    [id]

  );

 

  return result.rows?.[0] || null;

}

 

function normalizeRequest(input = {}) {

  if (typeof input === "number" || typeof input === "string") {

    return {

      workspaceId: Number(input) || null,

      user: {},

      state: "",

      office: "",

      risk: "",

      legacyControllerCall: true,

    };

  }

 

  const source = obj(input);

  return {

    workspaceId: Number(source.workspaceId || source.workspace_id || source.user?.workspace_id || 0) || null,

    user: obj(source.user),

    state: clean(source.state),

    office: clean(source.office),

    risk: clean(source.risk),

    legacyControllerCall: false,

  };

}

 

async function resolveExecutionContext(input = {}) {

  const request = normalizeRequest(input);

  const requestedWorkspace = request.workspaceId ? await resolveWorkspace(request.workspaceId) : null;

 

  if (request.workspaceId && !requestedWorkspace) {

    const error = new Error("Workspace not found.");

    error.statusCode = 404;

    throw error;

  }

 

  const authenticatedFirmId = getFirmId(request.user);

  const workspaceFirmId = Number(requestedWorkspace?.firm_id || 0);

 

  if (authenticatedFirmId && workspaceFirmId && authenticatedFirmId !== workspaceFirmId) {

    const error = new Error("Workspace is outside the authenticated firm.");

    error.statusCode = 403;

    throw error;

  }

 

  const firmId = authenticatedFirmId || workspaceFirmId;

  if (!firmId) {

    const error = new Error("Missing firm context.");

    error.statusCode = 401;

    throw error;

  }

 

  // Backward compatibility for the existing controller, which historically

  // passed only workspaceId. A controller update should later pass req.user.

  const user = authenticatedFirmId

    ? request.user

    : {

        ...request.user,

        firm_id: firmId,

        workspace_id: request.workspaceId || undefined,

      };

 

  return {

    ...request,

    user,

    firmId,

    requestedWorkspace,

    state: request.state || (isNational(requestedWorkspace?.state) ? "" : clean(requestedWorkspace?.state)),

    office: request.office || clean(requestedWorkspace?.office),

  };

}

 

function normalizeSourceStatus(sourceResults = [], uei = {}) {

  const map = new Map();

 

  for (const item of arr(uei?.source_status)) {

    const key = clean(item?.key);

    if (!key) continue;

    map.set(key, {

      key,

      ok: Boolean(item?.ok),

      status: clean(item?.status) || (item?.ok ? "available" : "unavailable"),

      freshness: clean(item?.freshness),

      last_seen: safeDate(item?.last_seen),

      error: clean(item?.error),

      duration_ms: null,

      origin: "unified-executive-intelligence",

    });

  }

 

  for (const item of arr(sourceResults)) {

    map.set(item.key, {

      key: item.key,

      ok: item.ok,

      status: item.status,

      freshness: item.ok ? "request-live" : "",

      last_seen: item.ok ? nowIso() : null,

      error: item.error,

      duration_ms: item.duration_ms,

      origin: "decision-intelligence",

    });

  }

 

  return [...map.values()];

}

 

function normalizeSignals(uei = {}, workspace = {}) {

  const output = [];

 

  for (const item of arr(uei?.signals)) {

    const severity = canonicalPriority(firstText(item?.severity, item?.risk, "low"));

    output.push({

      id: `political-signal-${item?.id ?? output.length + 1}`,

      raw_id: item?.id ?? null,

      workspace_id: item?.workspace_id ?? null,

      signal_type: clean(item?.signal_type) || "political_signal",

      title: firstText(item?.title, "Political signal"),

      description: firstText(item?.summary, item?.description),

      severity,

      signal_score: clamp(item?.signal_score),

      source_module: "political_signals",

      source_name: clean(item?.source),

      state_code: normalizeState(item?.state),

      route: "/political-signals",

      metadata: {

        risk: canonicalRisk(item?.risk),

        county: clean(item?.county),

        url: clean(item?.url),

        observed_at: safeDate(item?.observed_at),

        original_workspace_id: item?.workspace_id ?? null,

      },

      created_at: safeDate(item?.observed_at) || safeDate(item?.updated_at) || safeDate(item?.created_at),

    });

  }

 

  for (const item of arr(workspace?.material_alerts)) {

    const severity = canonicalPriority(firstText(item?.severity, item?.priority, item?.risk, "high"));

    output.push({

      id: `workspace-alert-${item?.id ?? output.length + 1}`,

      raw_id: item?.id ?? null,

      workspace_id: item?.workspace_id ?? workspace?.selected_workspace?.id ?? null,

      signal_type: "material_alert",

      title: firstText(item?.title, item?.label, "Material workspace alert"),

      description: firstText(item?.detail, item?.description, item?.summary),

      severity,

      signal_score: clamp(firstDefined(item?.signal_score, item?.score, priorityWeight(severity))),

      source_module: "executive_workspace",

      source_name: firstText(item?.source, "Executive Workspace"),

      state_code: normalizeState(firstText(item?.state, workspace?.selected_workspace?.state)),

      route: smartRoute(`${item?.title || ""} ${item?.detail || ""}`, item?.route || item?.path),

      metadata: {

        source_scope: clean(item?.scope),

        risk: canonicalRisk(item?.risk),

      },

      created_at: safeDate(item?.updated_at) || safeDate(item?.created_at) || nowIso(),

    });

  }

 

  const seen = new Set();

  return output.filter((item) => {

    const key = `${lower(item.title)}|${item.state_code}|${item.signal_type}`;

    if (seen.has(key)) return false;

    seen.add(key);

    return true;

  });

}

 

function materialSignals(signals = []) {

  return arr(signals).filter((item) => {

    const severity = canonicalPriority(item?.severity);

    const score = number(item?.signal_score);

    return severity === "critical" || severity === "high" || score >= 60;

  });

}

 

function evidenceRef({ source, id = null, title = "", detail = "", route = "", state = "", score = null, priority = "", observedAt = null }) {

  return {

    source: clean(source),

    id,

    title: clean(title),

    detail: clean(detail),

    route: clean(route),

    state: normalizeState(state),

    score: score === null || score === undefined ? null : clamp(score),

    priority: canonicalPriority(priority),

    observed_at: safeDate(observedAt),

  };

}

 

function createCandidate({

  key,

  title,

  decisionType,

  priority = "medium",

  recommendation,

  rationale,

  sourceModules = [],

  route = "",

  evidence = [],

  confidence = 70,

  risk = 40,

  impact = 65,

  urgency = 60,

  state = "",

  metadata = {},

}) {

  const normalizedPriority = canonicalPriority(priority);

  const normalizedEvidence = arr(evidence).filter(Boolean);

  const corroborationBonus = Math.min(12, Math.max(0, unique(sourceModules).length - 1) * 4);

  const materiality = clamp(

    impact * 0.3 +

      urgency * 0.25 +

      confidence * 0.2 +

      risk * 0.15 +

      priorityWeight(normalizedPriority) * 0.1 +

      corroborationBonus

  );

 

  return {

    key: clean(key),

    title: clean(title),

    decision_type: clean(decisionType) || "executive_review",

    priority: normalizedPriority,

    status: statusFromPriority(normalizedPriority),

    confidence_score: clamp(confidence),

    risk_score: clamp(risk),

    impact_score: clamp(impact),

    urgency_score: clamp(urgency),

    materiality_score: Math.round(materiality),

    recommendation: clean(recommendation),

    rationale: clean(rationale),

    source_modules: unique(sourceModules),

    route: smartRoute(`${title} ${recommendation} ${rationale}`, route),

    state: normalizeState(state),

    evidence: normalizedEvidence,

    metadata: {

      ...obj(metadata),

      evidence_count: normalizedEvidence.length,

      corroborating_sources: unique(sourceModules).length,

    },

  };

}

 

function buildWorkspaceExecutionCandidate(workspace = {}) {

  const summary = obj(workspace?.summary);

  const urgentTasks = integer(summary?.urgent_tasks);

  const openTasks = integer(summary?.open_tasks);

  const pressure = clamp(summary?.pressure_score);

  const readiness = clamp(summary?.workspace_readiness_score);

 

  if (urgentTasks <= 0 && pressure < 75) return null;

 

  const evidence = arr(workspace?.executive_actions).slice(0, 5).map((item) =>

    evidenceRef({

      source: firstText(item?.source, "executive_workspace"),

      id: item?.id,

      title: item?.title,

      detail: item?.detail,

      route: firstText(item?.path, item?.route, "/command-center"),

      state: item?.state,

      priority: item?.priority,

    })

  );

 

  evidence.unshift(

    evidenceRef({

      source: "executive_workspace",

      id: "workspace-summary",

      title: "Workspace execution posture",

      detail: `${openTasks} open tasks, ${urgentTasks} urgent tasks, pressure ${Math.round(pressure)}%, readiness ${Math.round(readiness)}%.`,

      route: "/command-center",

      priority: pressure >= 90 || urgentTasks >= 8 ? "critical" : "high",

      score: pressure,

    })

  );

 

  const priority = pressure >= 90 || urgentTasks >= 8

    ? "critical"

    : pressure >= 75 || urgentTasks >= 3

      ? "high"

      : "medium";

 

  return createCandidate({

    key: "workspace-execution-pressure",

    title: "Stabilize workspace execution pressure",

    decisionType: "execution_control",

    priority,

    recommendation: "Review the urgent execution backlog, confirm owners and sequencing, and resolve the highest-pressure operational dependencies before adding new commitments.",

    rationale: `Executive Workspace reports ${openTasks} open tasks, ${urgentTasks} urgent tasks, ${Math.round(pressure)}% pressure, and ${Math.round(readiness)}% readiness.`,

    sourceModules: ["executive_workspace", "command_center"],

    route: "/command-center",

    evidence,

    confidence: clamp(70 + Math.min(20, urgentTasks * 2)),

    risk: clamp(Math.max(pressure, urgentTasks * 8)),

    impact: clamp(70 + Math.min(25, urgentTasks * 2)),

    urgency: clamp(Math.max(pressure, 65 + urgentTasks * 3)),

    state: workspace?.selected_workspace?.state,

    metadata: {

      open_tasks: openTasks,

      urgent_tasks: urgentTasks,

      pressure_score: pressure,

      readiness_score: readiness,

    },

  });

}

 

function buildClientRiskCandidate(workspace = {}) {

  const summary = obj(workspace?.summary);

  const clients = integer(summary?.clients);

  const atRiskClients = integer(summary?.at_risk_clients);

  if (atRiskClients <= 0) return null;

 

  const ratio = clients > 0 ? atRiskClients / clients : 0;

  const risk = clamp(50 + ratio * 45);

  const impact = clamp(60 + atRiskClients * 6);

  const urgency = clamp(55 + atRiskClients * 7);

 

  const evidence = [

    evidenceRef({

      source: "executive_workspace",

      id: "client-risk-summary",

      title: "Client risk exposure",

      detail: `${atRiskClients} of ${clients || atRiskClients} scoped clients are currently at risk.`,

      route: "/campaign-crm",

      priority: ratio >= 0.3 ? "high" : "medium",

      score: risk,

    }),

  ];

 

  return createCandidate({

    key: "client-risk-exposure",

    title: "Resolve material client risk exposure",

    decisionType: "client_risk_control",

    priority: ratio >= 0.3 || atRiskClients >= 4 ? "high" : "medium",

    recommendation: "Review at-risk client accounts, confirm ownership of each recovery action, and sequence client-facing follow-up before risk compounds.",

    rationale: `Executive Workspace reports ${atRiskClients} at-risk clients across ${clients || atRiskClients} scoped client records.`,

    sourceModules: ["executive_workspace", "crm"],

    route: "/campaign-crm",

    evidence,

    confidence: 84,

    risk,

    impact,

    urgency,

    state: workspace?.selected_workspace?.state,

    metadata: {

      clients,

      at_risk_clients: atRiskClients,

      at_risk_ratio: ratio,

    },

  });

}

 

function buildMaterialAlertCandidate(workspace = {}, signals = []) {

  const alerts = arr(workspace?.material_alerts);

  const material = materialSignals(signals).filter((item) => item.signal_type === "material_alert");

  if (!alerts.length && !material.length) return null;

 

  const top = [...material].sort((a, b) => number(b.signal_score) - number(a.signal_score)).slice(0, 6);

  const evidence = top.map((item) =>

    evidenceRef({

      source: item.source_module,

      id: item.raw_id || item.id,

      title: item.title,

      detail: item.description,

      route: item.route,

      state: item.state_code,

      priority: item.severity,

      score: item.signal_score,

      observedAt: item.created_at,

    })

  );

 

  return createCandidate({

    key: "material-alert-response",

    title: "Resolve material workspace alerts",

    decisionType: "material_alert_response",

    priority: top.some((item) => item.severity === "critical") ? "critical" : "high",

    recommendation: "Review each material alert, validate the underlying evidence, and assign an accountable response path for every unresolved high-severity item.",

    rationale: `${Math.max(alerts.length, material.length)} material workspace alerts require executive review.`,

    sourceModules: ["executive_workspace", "political_signals"],

    route: top[0]?.route || "/command-center",

    evidence,

    confidence: top.length ? 88 : 78,

    risk: top.length ? Math.max(...top.map((item) => number(item.signal_score))) : 75,

    impact: 82,

    urgency: 88,

    state: workspace?.selected_workspace?.state,

  });

}

 

function buildPoliticalSignalCandidate(uei = {}, signals = []) {

  const scopedSummary = obj(uei?.scoped_summary || uei?.summary);

  const material = materialSignals(signals).filter((item) => item.signal_type !== "material_alert");

  const criticalCount = integer(scopedSummary?.critical_signals);

  const totalSignals = integer(scopedSummary?.political_signals);

 

  // Signal volume by itself is not a decision. Material evidence is required.

  if (!material.length && criticalCount <= 0) return null;

 

  const top = [...material]

    .sort((a, b) => {

      const severityDelta = priorityWeight(b.severity) - priorityWeight(a.severity);

      return severityDelta || number(b.signal_score) - number(a.signal_score);

    })

    .slice(0, 6);

 

  const evidence = top.map((item) =>

    evidenceRef({

      source: firstText(item.source_name, item.source_module),

      id: item.raw_id || item.id,

      title: item.title,

      detail: item.description,

      route: item.route,

      state: item.state_code,

      priority: item.severity,

      score: item.signal_score,

      observedAt: item.created_at,

    })

  );

 

  const topScore = top.length ? Math.max(...top.map((item) => number(item.signal_score))) : 70;

 

  return createCandidate({

    key: "political-signal-review",

    title: "Review material political signal changes",

    decisionType: "intelligence_review",

    priority: top.some((item) => item.severity === "critical") || criticalCount > 0 ? "critical" : "high",

    recommendation: "Validate the highest-severity political signals against corroborating evidence and determine whether the current operating posture should change.",

    rationale: `${material.length || criticalCount} material signals are present within ${totalSignals} scoped political signals.`,

    sourceModules: ["political_signals", "unified_executive_intelligence"],

    route: "/political-signals",

    evidence,

    confidence: clamp(72 + Math.min(20, evidence.length * 3)),

    risk: clamp(Math.max(65, topScore)),

    impact: clamp(70 + Math.min(20, evidence.length * 3)),

    urgency: clamp(68 + Math.min(25, evidence.length * 4)),

    state: uei?.scope?.effective_state || uei?.scope?.workspace_state,

    metadata: {

      scoped_signal_count: totalSignals,

      material_signal_count: material.length,

      critical_signal_count: criticalCount,

    },

  });

}

 

function buildUeiRecommendationCandidate(uei = {}) {

  const recommendations = [

    ...arr(uei?.recommendations),

    ...arr(uei?.strategy?.recommendations),

  ].filter(Boolean);

 

  const material = recommendations.filter((item) => {

    const priority = canonicalPriority(firstText(item?.priority, item?.severity, item?.risk));

    return priority === "critical" || priority === "high";

  });

 

  const briefingRecommendation = clean(uei?.briefing?.recommended_action);

  if (!material.length && !briefingRecommendation) return null;

 

  const evidence = material.slice(0, 5).map((item) =>

    evidenceRef({

      source: firstText(item?.source, "unified_executive_intelligence"),

      id: item?.id,

      title: item?.title,

      detail: firstText(item?.detail, item?.recommendation, item?.summary),

      route: item?.route,

      state: item?.state,

      priority: item?.priority,

      score: item?.score,

      observedAt: item?.updated_at || item?.created_at,

    })

  );

 

  const explicitPriority = material.length

    ? material.map((item) => canonicalPriority(item?.priority)).sort((a, b) => priorityWeight(b) - priorityWeight(a))[0]

    : "medium";

 

  return createCandidate({

    key: "uei-recommended-review",

    title: "Review unified executive recommendation",

    decisionType: "strategic_review",

    priority: explicitPriority,

    recommendation: briefingRecommendation || firstText(material[0]?.detail, material[0]?.recommendation, "Review the highest-priority unified executive recommendation."),

    rationale: clean(uei?.briefing?.strategic_summary) || `${material.length} material Unified Executive Intelligence recommendations are active.`,

    sourceModules: [

      "unified_executive_intelligence",

      ...material.map((item) => clean(item?.source)).filter(Boolean),

    ],

    route: smartRoute(`${briefingRecommendation} ${material[0]?.title || ""}`, material[0]?.route),

    evidence,

    confidence: clamp(firstDefined(uei?.briefing?.confidence_percentage, 82)),

    risk: clamp(firstDefined(uei?.health?.national_risk, uei?.summary?.national_pressure_score, 45)),

    impact: material.length ? 78 : 64,

    urgency: material.length ? 76 : 60,

    state: firstText(uei?.scope?.effective_state, uei?.scope?.workspace_state),

    metadata: {

      briefing_headline: clean(uei?.briefing?.headline),

      recommendation_count: material.length,

    },

  });

}

 

function buildStrategyCandidate(strategyResult = {}, uei = {}) {

  const direct = arr(strategyResult);

  const scoped = arr(uei?.strategy?.recommendations);

  const recommendations = scoped.length ? scoped : direct;

 

  const material = recommendations

    .filter((item) => ["critical", "high"].includes(canonicalPriority(firstText(item?.priority, item?.severity))))

    .slice(0, 5);

 

  if (!material.length) return null;

 

  const evidence = material.map((item) =>

    evidenceRef({

      source: "strategy_recommendations",

      id: firstDefined(item?.id, item?.key, item?.recommendation_key),

      title: firstText(item?.title, item?.recommendation),

      detail: firstText(item?.detail, item?.rationale, item?.summary),

      route: firstText(item?.route, "/strategy"),

      state: item?.state,

      priority: item?.priority,

      score: firstDefined(item?.score, item?.confidence),

      observedAt: item?.updated_at || item?.created_at,

    })

  );

 

  return createCandidate({

    key: "strategy-recommendation-review",

    title: "Resolve high-priority strategy recommendations",

    decisionType: "strategy_review",

    priority: material.some((item) => canonicalPriority(item?.priority) === "critical") ? "critical" : "high",

    recommendation: "Review the active high-priority strategy recommendations, validate their evidence, and select which recommendations should be converted into accountable execution.",

    rationale: `${material.length} high-priority strategy recommendations are active in the current evidence set.`,

    sourceModules: ["strategy_recommendations", "unified_executive_intelligence"],

    route: "/strategy",

    evidence,

    confidence: 82,

    risk: 62,

    impact: 82,

    urgency: 76,

    state: firstText(uei?.scope?.effective_state, uei?.scope?.workspace_state),

  });

}

 

function buildForecastCandidate(forecastSummary = {}, battlegrounds = [], state = "") {

  const summary = obj(forecastSummary);

  const rows = arr(battlegrounds);

 

  const materialRows = rows

    .filter((item) => {

      const volatility = number(firstDefined(item?.volatility_score, item?.volatility, item?.pressure_score, item?.risk_score, item?.score));

      const risk = canonicalPriority(firstText(item?.risk, item?.severity, item?.status));

      return volatility >= 70 || risk === "critical" || risk === "high";

    })

    .slice(0, 5);

 

  const summaryRisk = number(firstDefined(summary?.risk_score, summary?.national_risk, summary?.volatility_score, 0));

  if (!materialRows.length && summaryRisk < 70) return null;

 

  const evidence = materialRows.map((item) =>

    evidenceRef({

      source: "forecast",

      id: firstDefined(item?.id, item?.key),

      title: firstText(item?.title, item?.race_name, item?.state_name, item?.state, "Forecast battleground"),

      detail: firstText(item?.summary, item?.detail, item?.rationale, item?.status),

      route: "/national-command",

      state: firstText(item?.state, item?.state_code),

      priority: firstText(item?.risk, item?.severity, "high"),

      score: firstDefined(item?.volatility_score, item?.pressure_score, item?.risk_score, item?.score),

      observedAt: item?.updated_at || item?.created_at,

    })

  );

 

  return createCandidate({

    key: "forecast-volatility-review",

    title: "Review material forecast volatility",

    decisionType: "forecast_review",

    priority: "high",

    recommendation: "Review material forecast changes and validate whether current resource and execution assumptions remain aligned with the latest evidence.",

    rationale: `${materialRows.length || 1} forecast indicators exceed the materiality threshold.`,

    sourceModules: ["forecast"],

    route: "/national-command",

    evidence,

    confidence: 78,

    risk: clamp(Math.max(summaryRisk, 70)),

    impact: 80,

    urgency: 72,

    state,

  });

}

 

function buildCoalitionCandidate(rankings = [], actions = [], state = "") {

  const materialActions = arr(actions)

    .filter((item) => ["critical", "high"].includes(canonicalPriority(firstText(item?.priority, item?.severity, item?.risk))))

    .slice(0, 5);

 

  if (!materialActions.length) return null;

 

  const evidence = materialActions.map((item) =>

    evidenceRef({

      source: "coalitions",

      id: firstDefined(item?.id, item?.key, item?.coalition_key),

      title: firstText(item?.title, item?.action, item?.coalition_name),

      detail: firstText(item?.detail, item?.rationale, item?.summary),

      route: "/strategy",

      state: item?.state,

      priority: item?.priority,

      score: firstDefined(item?.score, item?.urgency_score),

      observedAt: item?.updated_at || item?.created_at,

    })

  );

 

  const topRanking = arr(rankings)[0];

  if (topRanking) {

    evidence.push(

      evidenceRef({

        source: "coalitions",

        id: firstDefined(topRanking?.id, topRanking?.coalition_key),

        title: firstText(topRanking?.coalition_name, topRanking?.title, "Coalition ranking context"),

        detail: firstText(topRanking?.summary, topRanking?.detail),

        route: "/strategy",

        state: topRanking?.state,

        priority: firstText(topRanking?.priority, topRanking?.risk, "medium"),

        score: firstDefined(topRanking?.score, topRanking?.movement_score),

      })

    );

  }

 

  return createCandidate({

    key: "coalition-action-review",

    title: "Review high-priority coalition actions",

    decisionType: "coalition_review",

    priority: materialActions.some((item) => canonicalPriority(item?.priority) === "critical") ? "critical" : "high",

    recommendation: "Review the highest-priority coalition actions and determine which items warrant accountable execution within the current operating plan.",

    rationale: `${materialActions.length} coalition actions are currently high priority.`,

    sourceModules: ["coalitions", "strategy"],

    route: "/strategy",

    evidence,

    confidence: 80,

    risk: 64,

    impact: 78,

    urgency: 76,

    state,

  });

}

 

function buildInfluenceCandidate(rankings = [], alerts = [], state = "") {

  const materialAlerts = arr(alerts)

    .filter((item) => ["critical", "high"].includes(canonicalPriority(firstText(item?.severity, item?.priority, item?.risk))))

    .slice(0, 5);

 

  if (!materialAlerts.length) return null;

 

  const evidence = materialAlerts.map((item) =>

    evidenceRef({

      source: "influence",

      id: firstDefined(item?.id, item?.key),

      title: firstText(item?.title, item?.entity_name, "Influence alert"),

      detail: firstText(item?.detail, item?.summary, item?.description),

      route: "/relationship-graph",

      state: item?.state,

      priority: firstText(item?.severity, item?.priority),

      score: firstDefined(item?.score, item?.influence_score, item?.risk_score),

      observedAt: item?.updated_at || item?.created_at,

    })

  );

 

  const topRanking = arr(rankings)[0];

  if (topRanking) {

    evidence.push(

      evidenceRef({

        source: "influence",

        id: firstDefined(topRanking?.id, topRanking?.entity_key),

        title: firstText(topRanking?.entity_name, topRanking?.title, "Influence ranking context"),

        detail: firstText(topRanking?.summary, topRanking?.detail),

        route: "/relationship-graph",

        state: topRanking?.state,

        priority: firstText(topRanking?.risk, "medium"),

        score: firstDefined(topRanking?.score, topRanking?.influence_score),

      })

    );

  }

 

  return createCandidate({

    key: "influence-alert-review",

    title: "Review material influence-network alerts",

    decisionType: "influence_review",

    priority: materialAlerts.some((item) => canonicalPriority(item?.severity || item?.priority) === "critical") ? "critical" : "high",

    recommendation: "Review the material influence alerts, validate the affected relationships, and determine whether operational or relationship-management action is required.",

    rationale: `${materialAlerts.length} influence alerts exceed the high-severity threshold.`,

    sourceModules: ["influence", "relationship_graph"],

    route: "/relationship-graph",

    evidence,

    confidence: 80,

    risk: 70,

    impact: 76,

    urgency: 72,

    state,

  });

}

 

function candidateSimilarityKey(candidate = {}) {

  const title = lower(candidate?.title)

    .replace(/\b(review|resolve|material|high-priority|workspace)\b/g, "")

    .replace(/\s+/g, " ")

    .trim();

  return `${clean(candidate?.decision_type)}|${title}`;

}

 

function mergeCandidates(candidates = []) {

  const map = new Map();

 

  for (const candidate of arr(candidates).filter(Boolean)) {

    const key = candidateSimilarityKey(candidate);

    if (!map.has(key)) {

      map.set(key, candidate);

      continue;

    }

 

    const existing = map.get(key);

    const preferred = number(candidate?.materiality_score) > number(existing?.materiality_score) ? candidate : existing;

    const secondary = preferred === candidate ? existing : candidate;

 

    map.set(key, {

      ...preferred,

      source_modules: unique([...arr(preferred?.source_modules), ...arr(secondary?.source_modules)]),

      evidence: [...arr(preferred?.evidence), ...arr(secondary?.evidence)].slice(0, 10),

      metadata: { ...obj(secondary?.metadata), ...obj(preferred?.metadata) },

    });

  }

 

  return [...map.values()];

}

 

function materialCandidates(candidates = []) {

  return arr(candidates).filter((candidate) => {

    const priority = canonicalPriority(candidate?.priority);

    const score = number(candidate?.materiality_score);

    const evidenceCount = arr(candidate?.evidence).length;

    if (evidenceCount <= 0) return false;

 

    return (

      priority === "critical" ||

      (priority === "high" && score >= MATERIALITY_THRESHOLD - 5) ||

      score >= MATERIALITY_THRESHOLD

    );

  });

}

 

function decisionOptions(candidate = {}) {

  const baseImpact = clamp(candidate?.impact_score);

  const baseRisk = clamp(candidate?.risk_score);

  const baseConfidence = clamp(candidate?.confidence_score);

 

  return [

    {

      id: `${candidate.key}-option-1`,

      label: "Act on the recommended path",

      description: "Convert the recommendation into accountable execution now using the linked executive workflow.",

      projected_impact: baseImpact,

      projected_risk: baseRisk,

      confidence: baseConfidence,

      cost_level: "context-dependent",

      timeline: candidate.urgency_score >= 85 ? "Immediate" : candidate.urgency_score >= 70 ? "24-72 hours" : "Next executive review",

      rank_order: 1,

    },

    {

      id: `${candidate.key}-option-2`,

      label: "Validate before committing",

      description: "Run a focused evidence and ownership review before committing additional resources or changing operating posture.",

      projected_impact: clamp(baseImpact - 8),

      projected_risk: clamp(baseRisk - 12),

      confidence: clamp(baseConfidence + 4),

      cost_level: "low",

      timeline: "24-72 hours",

      rank_order: 2,

    },

    {

      id: `${candidate.key}-option-3`,

      label: "Monitor without changing posture",

      description: "Keep the current operating posture and increase monitoring until the evidence crosses a stronger threshold.",

      projected_impact: clamp(baseImpact - 25),

      projected_risk: clamp(baseRisk - 22),

      confidence: clamp(baseConfidence - 5),

      cost_level: "low",

      timeline: "Next review cycle",

      rank_order: 3,

    },

  ];

}

 

function decisionActions(candidate = {}, workspaceId = null) {

  return [

    {

      id: `${candidate.key}-action-1`,

      action_label: firstText(candidate?.recommendation, `Review ${candidate?.title}`),

      owner: "Executive Operations",

      status: "pending",

      due_window: candidate?.urgency_score >= 85 ? "24 hours" : candidate?.urgency_score >= 70 ? "72 hours" : "Next executive review",

      route: candidate?.route || "/command-center",

      workspace_id: workspaceId,

    },

  ];

}

 

function finalizeDecisions(candidates = [], workspaceId = null) {

  return materialCandidates(mergeCandidates(candidates))

    .sort((a, b) => {

      const materialityDelta = number(b?.materiality_score) - number(a?.materiality_score);

      if (materialityDelta) return materialityDelta;

      const urgencyDelta = number(b?.urgency_score) - number(a?.urgency_score);

      if (urgencyDelta) return urgencyDelta;

      return number(b?.confidence_score) - number(a?.confidence_score);

    })

    .slice(0, MAX_DECISIONS)

    .map((candidate, index) => ({

      id: `live-${workspaceId || "firm"}-${candidate.key}`,

      workspace_id: workspaceId,

      rank_order: index + 1,

      title: candidate.title,

      decision_type: candidate.decision_type,

      priority: candidate.priority,

      status: candidate.status,

      confidence_score: Math.round(candidate.confidence_score),

      risk_score: Math.round(candidate.risk_score),

      impact_score: Math.round(candidate.impact_score),

      urgency_score: Math.round(candidate.urgency_score),

      materiality_score: Math.round(candidate.materiality_score),

      recommendation: candidate.recommendation,

      rationale: candidate.rationale,

      source_modules: candidate.source_modules,

      route: candidate.route,

      state: candidate.state,

      evidence: candidate.evidence,

      metadata: {

        ...candidate.metadata,

        synthesis_mode: "live-evidence",

        build: BUILD,

      },

      options: decisionOptions(candidate),

      actions: decisionActions(candidate, workspaceId),

      created_at: null,

      updated_at: nowIso(),

    }));

}

 

export async function getDecisionIntelligence(input = {}) {

  const context = await resolveExecutionContext(input);

  const {

    workspaceId,

    user,

    firmId,

    requestedWorkspace,

    state,

    office,

    risk,

    legacyControllerCall,

  } = context;

 

  const sourceResults = await Promise.all([

    runSource("unified_executive_intelligence", () =>

      getUnifiedExecutiveIntelligence({ user, workspaceId, state, office, risk })

    ),

    runSource("executive_workspace", () =>

      getExecutiveWorkspaceDashboard({ user, workspaceId })

    ),

    runSource("executive_mission_control", () =>

      getExecutiveMissionControl({ user }),

      { optional: true }

    ),

    runSource("strategy_recommendations", () =>

      getStrategyRecommendations({ state, limit: 40 }),

      { optional: true }

    ),

    runSource("forecast_summary", () => getForecastSummary(), { optional: true }),

    runSource("forecast_battlegrounds", () => getForecastBattlegrounds(), { optional: true }),

    runSource("coalition_rankings", () => getCoalitionRankings({ state, limit: 30 }), { optional: true }),

    runSource("coalition_actions", () => getCoalitionActions({ state, limit: 30 }), { optional: true }),

    runSource("influence_rankings", () => getInfluenceRankings({ state, limit: 30 }), { optional: true }),

    runSource("influence_alerts", () => getInfluenceAlerts({ state, limit: 30 }), { optional: true }),

  ]);

 

  const sourceMap = Object.fromEntries(sourceResults.map((item) => [item.key, item]));

  const uei = obj(sourceMap.unified_executive_intelligence?.data);

  const workspace = obj(sourceMap.executive_workspace?.data);

  const missionControl = obj(sourceMap.executive_mission_control?.data);

 

  if (!sourceMap.unified_executive_intelligence?.ok) {

    const error = new Error("Unified Executive Intelligence is unavailable; Decision Intelligence cannot synthesize authoritative decisions.");

    error.statusCode = 503;

    error.detail = sourceMap.unified_executive_intelligence?.error || "";

    throw error;

  }

 

  if (!sourceMap.executive_workspace?.ok) {

    const error = new Error("Executive Workspace is unavailable; Decision Intelligence cannot validate workspace execution context.");

    error.statusCode = 503;

    error.detail = sourceMap.executive_workspace?.error || "";

    throw error;

  }

 

  const selectedWorkspace = obj(workspace?.selected_workspace).id

    ? obj(workspace?.selected_workspace)

    : requestedWorkspace || {};

 

  const effectiveWorkspaceId = Number(selectedWorkspace?.id || workspaceId || 0) || null;

 

  if (workspaceId && effectiveWorkspaceId && Number(workspaceId) !== Number(effectiveWorkspaceId)) {

    const error = new Error("Resolved Executive Workspace does not match the requested workspace.");

    error.statusCode = 409;

    throw error;

  }

 

  const signals = normalizeSignals(uei, workspace);

  const materialSignalRows = materialSignals(signals);

 

  const candidates = [

    buildWorkspaceExecutionCandidate(workspace),

    buildClientRiskCandidate(workspace),

    buildMaterialAlertCandidate(workspace, signals),

    buildPoliticalSignalCandidate(uei, signals),

    buildUeiRecommendationCandidate(uei),

    buildStrategyCandidate(sourceMap.strategy_recommendations?.data, uei),

    buildForecastCandidate(sourceMap.forecast_summary?.data, sourceMap.forecast_battlegrounds?.data, state),

    buildCoalitionCandidate(sourceMap.coalition_rankings?.data, sourceMap.coalition_actions?.data, state),

    buildInfluenceCandidate(sourceMap.influence_rankings?.data, sourceMap.influence_alerts?.data, state),

  ].filter(Boolean);

 

  const decisions = finalizeDecisions(candidates, effectiveWorkspaceId);

  const sourceStatus = normalizeSourceStatus(sourceResults, uei);

 

  const availableSources = sourceStatus.filter((item) => item.status === "available").length;

  const degradedSources = sourceStatus.filter((item) => item.status === "degraded").length;

  const unavailableSources = sourceStatus.filter((item) => item.status === "unavailable").length;

 

  const summary = {

    openDecisions: decisions.filter((item) => ["open", "review"].includes(lower(item?.status))).length,

    highPriority: decisions.filter((item) => ["critical", "high"].includes(canonicalPriority(item?.priority))).length,

    avgConfidence: average(decisions.map((item) => item.confidence_score)),

    avgRisk: average(decisions.map((item) => item.risk_score)),

    liveSignals: materialSignalRows.length,

    totalDecisions: decisions.length,

    criticalDecisions: decisions.filter((item) => canonicalPriority(item?.priority) === "critical").length,

    materialSignals: materialSignalRows.length,

    scopedSignals: signals.length,

    sourceCount: sourceStatus.length,

    availableSources,

    degradedSources,

    unavailableSources,

  };

 

  const primaryDecision = decisions[0] || null;

  const mode = decisions.length > 0 ? "live-synthesis" : "live-no-material-decisions";

 

  return {

    ok: true,

    build: BUILD,

    mode,

    source: "live-authoritative-synthesis",

    generated_at: nowIso(),

    workspace_id: effectiveWorkspaceId,

    firm_id: firmId,

    scope: {

      firm_id: firmId,

      workspace_id: effectiveWorkspaceId,

      workspace_name: firstText(selectedWorkspace?.name, uei?.scope?.workspace_name),

      workspace_state: firstText(selectedWorkspace?.state, uei?.scope?.workspace_state),

      workspace_office: firstText(selectedWorkspace?.office, uei?.scope?.workspace_office),

      workspace_cycle: firstText(selectedWorkspace?.cycle, uei?.scope?.workspace_cycle),

      effective_state: firstText(uei?.scope?.effective_state, state, selectedWorkspace?.state),

      effective_office: firstText(uei?.scope?.effective_office, office, selectedWorkspace?.office),

      risk: clean(risk || uei?.scope?.risk),

      workspace_scope_mode: clean(workspace?.scope?.mode),

      legacy_controller_context: legacyControllerCall,

    },

    summary,

    briefing: {

      headline: primaryDecision?.title || "No material executive decision is currently required.",

      strategic_summary: primaryDecision?.rationale || "Authoritative sources were reviewed and no evidence-backed decision crossed the current materiality threshold.",

      recommended_action: primaryDecision?.recommendation || "Maintain the current operating posture and continue monitoring authoritative intelligence sources.",

      decision_window: primaryDecision?.urgency_score >= 85

        ? "24 hours"

        : primaryDecision?.urgency_score >= 70

          ? "72 hours"

          : "Next executive review",

      confidence_percentage: primaryDecision?.confidence_score ?? clamp(uei?.briefing?.confidence_percentage),

    },

    decisions,

    signals: [...materialSignalRows]

      .sort((a, b) => {

        const priorityDelta = priorityWeight(b?.severity) - priorityWeight(a?.severity);

        return priorityDelta || number(b?.signal_score) - number(a?.signal_score);

      })

      .slice(0, MAX_SIGNALS),

    evidence: {

      source_status: sourceStatus,

      materiality_threshold: MATERIALITY_THRESHOLD,

      candidates_evaluated: candidates.length,

      candidates_materialized: decisions.length,

      authoritative_zero_preserved: true,

      auto_seed_enabled: false,

      fallback_decisions_enabled: false,

      legacy_seed_tables_used: false,

    },

    context: {

      unified_executive_intelligence: {

        health: obj(uei?.health),

        scoped_summary: obj(uei?.scoped_summary || uei?.summary),

        briefing: obj(uei?.briefing),

      },

      executive_workspace: {

        summary: obj(workspace?.summary),

        portfolio_summary: obj(workspace?.portfolio_summary),

        scope: obj(workspace?.scope),

      },

      executive_mission_control: {

        available: sourceMap.executive_mission_control?.ok || false,

        summary: obj(missionControl?.summary || missionControl?.portfolio_summary),

      },

    },

  };

}

 

/**

 * Production seeding is intentionally disabled.

 * This export remains only for compatibility with the existing controller.

 */

export async function seedDecisionIntelligence(workspaceId = null) {

  return {

    ok: false,

    seeded: false,

    workspace_id: Number(workspaceId) || null,

    mode: "disabled",

    reason: "Automatic Executive Decision Intelligence seeding is disabled. Decisions are synthesized from authoritative live evidence.",

    build: BUILD,

  };

}

 

export async function getDecisionIntelligenceHealth() {

  let legacySeedRows = 0;

  let legacyTablesPresent = false;

 

  try {

    const tableResult = await pool.query(`SELECT to_regclass('public.executive_decisions') AS table_name`);

    legacyTablesPresent = Boolean(tableResult.rows?.[0]?.table_name);

 

    if (legacyTablesPresent) {

      const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM executive_decisions`);

      legacySeedRows = integer(countResult.rows?.[0]?.count);

    }

  } catch (error) {

    console.warn("[decision-intelligence] health legacy-table check skipped:", error.message);

  }

 

  return {

    ok: true,

    build: BUILD,

    mode: "live-authoritative-synthesis",

    generated_at: nowIso(),

    auto_seed_enabled: false,

    fallback_decisions_enabled: false,

    legacy_seed_tables_used: false,

    legacy_seed_tables_present: legacyTablesPresent,

    legacy_seed_row_count: legacySeedRows,

    materiality_threshold: MATERIALITY_THRESHOLD,

    max_decisions: MAX_DECISIONS,

    max_signals: MAX_SIGNALS,

    source_timeout_ms: SOURCE_TIMEOUT_MS,

    primary_sources: [

      "unified_executive_intelligence",

      "executive_workspace",

    ],

    supporting_sources: [

      "executive_mission_control",

      "strategy_recommendations",

      "forecast",

      "coalitions",

      "influence",

    ],

  };

}

