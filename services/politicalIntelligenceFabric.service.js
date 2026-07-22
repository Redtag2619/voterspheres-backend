import { collectPoliticalSignals } from "../adapters/politicalIntelligenceFabric.adapters.js";

import {

  savePoliticalBrief,

  saveSnapshot,

  listPoliticalBriefs,

  getPoliticalBrief,

  listWatchlist,

  upsertWatchlist,

  deleteWatchlist,

  saveScenario

} from "./politicalIntelligenceMemory.service.js";

 

const clean = (value = "") => String(value ?? "").trim();

const clamp = (value, min = 0, max = 100) =>

  Math.max(min, Math.min(max, Number(value) || 0));

 

function severityFromScore(score) {

  if (score >= 85) return "critical";

  if (score >= 70) return "high";

  if (score >= 45) return "medium";

  return "low";

}

 

function urgencyWeight(value = "") {

  const normalized = clean(value).toLowerCase();

  if (["critical", "urgent", "immediate"].includes(normalized)) return 95;

  if (["high", "elevated"].includes(normalized)) return 78;

  if (["medium", "moderate"].includes(normalized)) return 55;

  return 30;

}

 

function daysUntil(value) {

  if (!value) return null;

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) return null;

  return Math.ceil((time - Date.now()) / 86400000);

}

 

function evidence(source, record, label) {

  return {

    source,

    source_id: record?.id ?? record?.entity_id ?? null,

    label,

    observed_at: record?.updated_at || record?.created_at || new Date().toISOString(),

    record

  };

}

 

function candidateFindings(rows = []) {

  return rows.flatMap((candidate) => {

    const cash = Number(candidate.cash_on_hand) || 0;

    const raised = Number(candidate.total_raised) || 0;

    const ratio = raised > 0 ? cash / raised : 0;

    if (raised <= 0 && cash <= 0) return [];

 

    const score = clamp(

      35 +

      (raised > 1000000 ? 25 : raised > 250000 ? 15 : 5) +

      (ratio < 0.12 ? 25 : ratio < 0.25 ? 12 : 0)

    );

 

    return [{

      category: "candidate_finance",

      entity_type: "candidate",

      entity_id: candidate.id,

      entity_name: candidate.name,

      state_code: candidate.state,

      title: `${candidate.name}: financial posture requires review`,

      summary:

        ratio < 0.12

          ? "Cash-on-hand is low relative to reported fundraising."

          : "Fundraising activity is material enough to affect competitive posture.",

      score,

      severity: severityFromScore(score),

      confidence: raised > 0 ? 82 : 58,

      metrics: { total_raised: raised, cash_on_hand: cash, liquidity_ratio: ratio },

      evidence: [evidence("candidates", candidate, "Candidate financial record")]

    }];

  });

}

 

function taskFindings(rows = []) {

  return rows.flatMap((task) => {

    const days = daysUntil(task.due_date);

    const incomplete = !["complete", "completed", "closed"].includes(

      clean(task.status).toLowerCase()

    );

    if (!incomplete) return [];

 

    const overdue = days !== null && days < 0;

    const score = clamp(

      urgencyWeight(task.priority) +

      (overdue ? 20 : days !== null && days <= 3 ? 12 : 0)

    );

 

    if (score < 50) return [];

    return [{

      category: "execution",

      entity_type: "task",

      entity_id: task.id,

      entity_name: task.title,

      state_code: task.state,

      title: overdue ? `Overdue execution item: ${task.title}` : `Execution pressure: ${task.title}`,

      summary: overdue

        ? `The task is ${Math.abs(days)} day(s) overdue.`

        : `The task is due within ${days ?? "an unknown number of"} day(s).`,

      score,

      severity: severityFromScore(score),

      confidence: 92,

      metrics: { status: task.status, priority: task.priority, days_until_due: days },

      evidence: [evidence("tasks", task, "Execution task")]

    }];

  });

}

 

function vendorFindings(rows = []) {

  return rows.flatMap((vendor) => {

    const coverage = Number(vendor.coverage_score) || 0;

    const riskText = clean(vendor.risk).toLowerCase();

    const risky = ["high", "critical", "elevated"].includes(riskText);

    if (coverage >= 65 && !risky) return [];

 

    const score = clamp((100 - coverage) * 0.75 + (risky ? 25 : 5));

    return [{

      category: "vendor_capacity",

      entity_type: "vendor",

      entity_id: vendor.id,

      entity_name: vendor.name,

      state_code: vendor.state,

      title: `Vendor capacity risk: ${vendor.name}`,

      summary: `Coverage score ${coverage}; risk ${vendor.risk || "Unknown"}; tier ${vendor.tier || "Unrated"}.`,

      score,

      severity: severityFromScore(score),

      confidence: coverage > 0 ? 84 : 55,

      metrics: { coverage_score: coverage, risk: vendor.risk, tier: vendor.tier },

      evidence: [evidence("vendors", vendor, "Vendor capacity record")]

    }];

  });

}

 

function stateFindings(rows = []) {

  return rows.flatMap((state) => {

    const readiness = Number(state.readiness_score) || 0;

    const gaps = Number(state.vendor_gaps) || 0;

    const open = Number(state.open_tasks) || 0;

    const score = clamp((100 - readiness) * 0.7 + Math.min(gaps * 8, 24) + Math.min(open * 2, 16));

    if (score < 45) return [];

 

    return [{

      category: "state_operations",

      entity_type: "state",

      entity_id: state.state_code,

      entity_name: state.state_name || state.state_code,

      state_code: state.state_code,

      title: `${state.state_code}: operating readiness below target`,

      summary: `Readiness ${readiness}; open tasks ${open}; vendor gaps ${gaps}.`,

      score,

      severity: severityFromScore(score),

      confidence: 88,

      metrics: { readiness_score: readiness, open_tasks: open, vendor_gaps: gaps },

      evidence: [evidence("state_operations_summary", state, "State operations summary")]

    }];

  });

}

 

function strategyFindings(rows = []) {

  return rows.flatMap((item) => {

    const status = clean(item.status).toLowerCase();

    if (["completed", "closed", "implemented"].includes(status)) return [];

    const score = clamp(urgencyWeight(item.priority) * 0.8 + (Number(item.confidence) || 50) * 0.2);

    return [{

      category: "strategy",

      entity_type: "strategy_recommendation",

      entity_id: item.id,

      entity_name: item.title,

      state_code: item.state_code,

      title: `Open strategic recommendation: ${item.title}`,

      summary: item.rationale || "An active recommendation remains open.",

      score,

      severity: severityFromScore(score),

      confidence: clamp(item.confidence || 65),

      metrics: { priority: item.priority, status: item.status },

      evidence: [evidence("strategy_recommendations", item, "Strategy recommendation")]

    }];

  });

}

 

function decisionFindings(rows = []) {

  return rows.flatMap((item) => {

    const status = clean(item.status).toLowerCase();

    if (["completed", "closed", "resolved"].includes(status)) return [];

    const score = clamp(urgencyWeight(item.urgency) * 0.75 + (Number(item.confidence) || 50) * 0.25);

    return [{

      category: "decision",

      entity_type: "executive_decision",

      entity_id: item.id,

      entity_name: item.title,

      state_code: item.state_code,

      title: `Executive decision pending: ${item.title}`,

      summary: item.summary || "An executive decision remains unresolved.",

      score,

      severity: severityFromScore(score),

      confidence: clamp(item.confidence || 70),

      metrics: { urgency: item.urgency, status: item.status },

      evidence: [evidence("executive_decisions", item, "Executive decision")]

    }];

  });

}

 

function influenceFindings(rows = []) {

  return rows.flatMap((item) => {

    const influence = Number(item.influence_score) || 0;

    const risk = Number(item.risk_score) || 0;

    const momentum = Number(item.momentum_score) || 0;

    if (influence < 60 && risk < 60) return [];

    const score = clamp(influence * 0.45 + risk * 0.4 + Math.max(momentum, 0) * 0.15);

    return [{

      category: "influence",

      entity_type: item.entity_type || "influence_entity",

      entity_id: item.entity_id,

      entity_name: item.entity_name,

      state_code: item.state_code,

      title: `Influence movement: ${item.entity_name}`,

      summary: `Influence ${influence}; risk ${risk}; momentum ${momentum}.`,

      score,

      severity: severityFromScore(score),

      confidence: 78,

      metrics: { influence_score: influence, risk_score: risk, momentum_score: momentum },

      evidence: [evidence("influence_scores", item, "Influence score")]

    }];

  });

}

 

function coalitionFindings(rows = []) {

  return rows.flatMap((item) => {

    const support = Number(item.support_score) || 0;

    const mobilization = Number(item.mobilization_score) || 0;

    const fragmentation = Number(item.fragmentation_risk) || 0;

    if (fragmentation < 45 && support >= 55) return [];

    const score = clamp(fragmentation * 0.65 + (100 - support) * 0.25 + (100 - mobilization) * 0.1);

    return [{

      category: "coalition",

      entity_type: "coalition",

      entity_id: `${item.coalition_name}:${item.state_code || "US"}`,

      entity_name: item.coalition_name,

      state_code: item.state_code,

      title: `Coalition stability watch: ${item.coalition_name}`,

      summary: `Support ${support}; mobilization ${mobilization}; fragmentation risk ${fragmentation}.`,

      score,

      severity: severityFromScore(score),

      confidence: 76,

      metrics: {

        support_score: support,

        mobilization_score: mobilization,

        fragmentation_risk: fragmentation

      },

      evidence: [evidence("coalition_intelligence", item, "Coalition intelligence")]

    }];

  });

}

 

function deduplicate(findings = []) {

  const map = new Map();

  for (const finding of findings) {

    const key = `${finding.category}:${finding.entity_type}:${finding.entity_id || finding.entity_name}`;

    const existing = map.get(key);

    if (!existing || finding.score > existing.score) map.set(key, finding);

  }

  return [...map.values()];

}

 

function actionForFinding(finding) {

  const actions = {

    candidate_finance: "Review finance velocity, burn rate, and upcoming filing exposure.",

    execution: "Assign an owner, confirm deadline, and clear the blocking dependency.",

    vendor_capacity: "Validate coverage, identify a backup vendor, and resolve the capability gap.",

    state_operations: "Open a state recovery plan with county, staffing, vendor, and task owners.",

    strategy: "Accept, revise, or reject the recommendation and convert it into execution tasks.",

    decision: "Schedule an executive decision checkpoint and record the final disposition.",

    influence: "Validate the influence movement and prepare an engagement or containment response.",

    coalition: "Engage coalition leadership and address the highest fragmentation driver."

  };

  return {

    title: actions[finding.category] || "Review the finding and assign an accountable owner.",

    category: finding.category,

    entity_type: finding.entity_type,

    entity_id: finding.entity_id,

    state_code: finding.state_code || null,

    priority: finding.severity,

    due_window: finding.severity === "critical" ? "24h" : finding.severity === "high" ? "72h" : "7d"

  };

}

 

function summarize(findings, sourceHealth) {

  const critical = findings.filter((item) => item.severity === "critical").length;

  const high = findings.filter((item) => item.severity === "high").length;

  const healthySources = Object.values(sourceHealth).filter((item) => item.ok).length;

  const totalSources = Object.keys(sourceHealth).length;

 

  if (!findings.length) {

    return `No material political intelligence risks were detected across ${healthySources} of ${totalSources} available sources.`;

  }

 

  return `${findings.length} material finding(s) detected, including ${critical} critical and ${high} high-severity item(s). ` +

    `${healthySources} of ${totalSources} configured sources responded successfully.`;

}

 

export async function runPoliticalIntelligenceScan({

  workspaceId,

  scopeType = "national",

  scopeValue = null,

  stateCode = null,

  timeHorizon = "30d",

  limit = 50

}) {

  const scope = {

    scope_type: clean(scopeType) || "national",

    scope_value: clean(scopeValue) || null,

    state_code: clean(stateCode || (scopeType === "state" ? scopeValue : "")).toUpperCase() || null

  };

 

  const collected = await collectPoliticalSignals({ workspaceId, scope });

  const sources = collected.sources;

 

  const findings = deduplicate([

    ...candidateFindings(sources.candidates),

    ...taskFindings(sources.tasks),

    ...vendorFindings(sources.vendors),

    ...stateFindings(sources.state_operations_summary),

    ...strategyFindings(sources.strategy_recommendations),

    ...decisionFindings(sources.executive_decisions),

    ...influenceFindings(sources.influence_scores),

    ...coalitionFindings(sources.coalition_intelligence)

  ])

    .sort((a, b) => b.score - a.score)

    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)))

    .map((item, index) => ({ rank: index + 1, ...item }));

 

  const risks = findings

    .filter((item) => ["critical", "high"].includes(item.severity))

    .map((item) => ({

      title: item.title,

      severity: item.severity,

      score: item.score,

      state_code: item.state_code || null

    }));

 

  const opportunities = findings

    .filter((item) => ["influence", "coalition", "candidate_finance"].includes(item.category))

    .filter((item) => item.confidence >= 70)

    .map((item) => ({

      title: `Opportunity review: ${item.entity_name}`,

      rationale: item.summary,

      confidence: item.confidence,

      state_code: item.state_code || null

    }));

 

  const recommendedActions = findings.slice(0, 12).map(actionForFinding);

  const evidenceRecords = findings.flatMap((item) => item.evidence || []);

 

  const result = {

    scan_key: `pif:${workspaceId}:${scope.scope_type}:${scope.scope_value || "all"}:${Date.now()}`,

    scope,

    time_horizon: timeHorizon,

    generated_at: new Date().toISOString(),

    executive_summary: summarize(findings, collected.sourceHealth),

    metrics: {

      finding_count: findings.length,

      critical_count: findings.filter((item) => item.severity === "critical").length,

      high_count: findings.filter((item) => item.severity === "high").length,

      medium_count: findings.filter((item) => item.severity === "medium").length,

      source_count: Object.keys(collected.sourceHealth).length,

      healthy_source_count: Object.values(collected.sourceHealth).filter((item) => item.ok).length

    },

    findings,

    risks,

    opportunities,

    recommended_actions: recommendedActions,

    source_health: collected.sourceHealth,

    evidence: evidenceRecords

  };

 

  await saveSnapshot({

    workspaceId,

    scanKey: result.scan_key,

    scopeType: scope.scope_type,

    scopeValue: scope.scope_value,

    signalCount: findings.length,

    sourceHealth: collected.sourceHealth,

    payload: result

  });

 

  return result;

}

 

export async function getPoliticalFabricOverview({ workspaceId }) {

  const [scan, watchlist, briefs] = await Promise.all([

    runPoliticalIntelligenceScan({ workspaceId, limit: 20 }),

    listWatchlist({ workspaceId }),

    listPoliticalBriefs({ workspaceId, limit: 10 })

  ]);

 

  return {

    ...scan,

    watchlist,

    recent_briefs: briefs

  };

}

 

export async function createPoliticalBrief({

  workspaceId,

  userId,

  title,

  scopeType,

  scopeValue,

  stateCode,

  timeHorizon

}) {

  const scan = await runPoliticalIntelligenceScan({

    workspaceId,

    scopeType,

    scopeValue,

    stateCode,

    timeHorizon,

    limit: 75

  });

 

  const brief = await savePoliticalBrief({

    workspaceId,

    userId,

    title: title || `${scopeValue || "National"} Political Intelligence Brief`,

    scopeType: scan.scope.scope_type,

    scopeValue: scan.scope.scope_value,

    timeHorizon: scan.time_horizon,

    executiveSummary: scan.executive_summary,

    findings: scan.findings,

    risks: scan.risks,

    opportunities: scan.opportunities,

    recommendedActions: scan.recommended_actions,

    evidence: scan.evidence,

    metadata: { metrics: scan.metrics, source_health: scan.source_health }

  });

 

  return brief;

}

 

export async function runPoliticalScenario({

  workspaceId,

  userId,

  name,

  scenarioType = "custom",

  assumptions = {}

}) {

  const baseline = await runPoliticalIntelligenceScan({

    workspaceId,

    scopeType: assumptions.scope_type || "national",

    scopeValue: assumptions.scope_value || null,

    stateCode: assumptions.state_code || null,

    limit: 30

  });

 

  const turnoutShift = Number(assumptions.turnout_shift) || 0;

  const fundingShift = Number(assumptions.funding_shift) || 0;

  const vendorCapacityShift = Number(assumptions.vendor_capacity_shift) || 0;

  const coalitionShift = Number(assumptions.coalition_shift) || 0;

 

  const projectedOutcomes = baseline.findings.slice(0, 12).map((finding) => {

    let delta = 0;

    if (finding.category === "candidate_finance") delta -= fundingShift * 0.4;

    if (finding.category === "vendor_capacity") delta -= vendorCapacityShift * 0.5;

    if (finding.category === "coalition") delta -= coalitionShift * 0.45;

    if (["coalition", "state_operations"].includes(finding.category)) delta -= turnoutShift * 0.25;

 

    const projectedScore = clamp(finding.score - delta);

    return {

      entity_type: finding.entity_type,

      entity_id: finding.entity_id,

      entity_name: finding.entity_name,

      category: finding.category,

      baseline_score: finding.score,

      projected_score: projectedScore,

      projected_severity: severityFromScore(projectedScore),

      delta: projectedScore - finding.score

    };

  });

 

  const risks = projectedOutcomes

    .filter((item) => item.projected_score >= 70)

    .map((item) => ({

      title: `${item.entity_name} remains ${item.projected_severity}`,

      projected_score: item.projected_score,

      category: item.category

    }));

 

  const recommendedActions = projectedOutcomes

    .sort((a, b) => b.projected_score - a.projected_score)

    .slice(0, 8)

    .map((item) => ({

      title: `Mitigate ${item.category} exposure for ${item.entity_name}`,

      priority: item.projected_severity,

      expected_score_reduction: Math.max(5, Math.round(item.projected_score * 0.12))

    }));

 

  const confidence = clamp(

    55 +

    Object.keys(assumptions).length * 4 +

    baseline.metrics.healthy_source_count * 2,

    0,

    92

  );

 

  return saveScenario({

    workspaceId,

    userId,

    name,

    scenarioType,

    assumptions,

    baseline: {

      scan_key: baseline.scan_key,

      metrics: baseline.metrics,

      executive_summary: baseline.executive_summary

    },

    projectedOutcomes,

    risks,

    recommendedActions,

    confidence

  });

}

 

export {

  listPoliticalBriefs,

  getPoliticalBrief,

  listWatchlist,

  upsertWatchlist,

  deleteWatchlist

};
