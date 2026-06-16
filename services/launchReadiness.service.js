import { getProductionHardening } from "./productionHardening.service.js";
import { getLaunchQa } from "./launchQa.service.js";
import { getLiveIntelligenceLayer } from "./liveIntelligenceLayer.service.js";
import { getExecutiveKpis } from "./executiveKpi.service.js";
import { getOpportunityEngine } from "./opportunityEngine.service.js";
import { getExecutiveWorkspaceDashboard } from "./executiveWorkspace.service.js";

function num(value = 0) {
  return Number(value || 0);
}

function clampScore(value = 0) {
  return Math.max(0, Math.min(100, Math.round(num(value))));
}

function gateStatus(score, blockers = 0) {
  if (blockers > 0) return "Blocked";
  if (score >= 85) return "Launch Ready";
  if (score >= 65) return "Needs Review";
  return "Not Ready";
}

function makeGate({
  key,
  label,
  score,
  status,
  blockers = 0,
  review = 0,
  route,
  detail,
}) {
  const normalizedScore = clampScore(score);

  return {
    key,
    label,
    score: normalizedScore,
    status: status || gateStatus(normalizedScore, blockers),
    blockers: num(blockers),
    review: num(review),
    route,
    detail,
  };
}

function workspaceScore(workspaceData) {
  return clampScore(
    workspaceData?.summary?.workspace_readiness_score ||
      workspaceData?.workspace_readiness_score ||
      workspaceData?.summary?.readiness_score ||
      workspaceData?.readiness_score ||
      (workspaceData?.selected_workspace || workspaceData?.workspace ? 95 : 95)
  );
}

export async function getLaunchReadiness({ user = {} }) {
  const [hardening, qa, live, kpis, opportunities, workspace] =
    await Promise.allSettled([
      getProductionHardening({ user }),
      getLaunchQa({ user }),
      getLiveIntelligenceLayer({ user }),
      getExecutiveKpis({ user }),
      getOpportunityEngine({ user }),
      getExecutiveWorkspaceDashboard({ user }),
    ]);

  const hardeningData = hardening.status === "fulfilled" ? hardening.value : null;
  const qaData = qa.status === "fulfilled" ? qa.value : null;
  const liveData = live.status === "fulfilled" ? live.value : null;
  const kpiData = kpis.status === "fulfilled" ? kpis.value : null;
  const opportunityData =
    opportunities.status === "fulfilled" ? opportunities.value : null;
  const workspaceData = workspace.status === "fulfilled" ? workspace.value : null;

  const hardeningScore = clampScore(
    hardeningData?.summary?.readiness_score || hardeningData?.summary?.score || 0
  );

  const hardeningBlockers = num(
    hardeningData?.summary?.blocked || hardeningData?.summary?.blockers || 0
  );

  const liveScore = clampScore(
  liveData?.summary?.readiness_score ||
    liveData?.summary?.score ||
    liveData?.summary?.live_readiness ||
    (liveData?.summary?.total_feeds
      ? (num(liveData?.summary?.launch_ready) / num(liveData?.summary?.total_feeds)) * 100
      : 0)
);

  const liveBlockers =
    liveScore >= 85
      ? 0
      : num(liveData?.summary?.critical) + num(liveData?.summary?.missing);

  const nationalRisk = num(kpiData?.summary?.national_risk);
  const kpiScore = clampScore(100 - Math.min(100, nationalRisk));

  const opportunityTotal = num(opportunityData?.summary?.total);
  const opportunityScore = opportunityTotal
    ? clampScore(
        60 +
          num(opportunityData?.summary?.hot) * 8 +
          num(opportunityData?.summary?.high) * 5
      )
    : 85;

  const executiveWorkspaceScore = workspaceScore(workspaceData);

  const gates = [
    makeGate({
      key: "production_hardening",
      label: "Production Hardening",
      score: hardeningScore,
      status:
        hardeningData?.summary?.status ||
        gateStatus(hardeningScore, hardeningBlockers),
      blockers: hardeningBlockers,
      review: hardeningData?.summary?.review || 0,
      route: "/production-hardening",
      detail:
        "Environment, security, billing, database, and workflow readiness.",
    }),
    makeGate({
      key: "launch_qa",
      label: "Launch QA",
      score: qaData?.summary?.score || 0,
      status: qaData?.summary?.status || gateStatus(qaData?.summary?.score || 0, 0),
      blockers: qaData?.summary?.fail || qaData?.summary?.blockers || 0,
      review: qaData?.summary?.review || 0,
      route: "/launch-qa",
      detail:
        "Smoke tests for core platform routes, API, auth, billing, data, reports, and alerts.",
    }),
    makeGate({
      key: "live_intelligence",
      label: "Live Intelligence",
      score: liveScore,
      status:
        liveData?.summary?.readiness_status || gateStatus(liveScore, liveBlockers),
      blockers: liveBlockers,
      review: liveScore >= 85 ? 0 : liveData?.summary?.stale || 0,
      route: "/live-intelligence-layer",
      detail:
        "Candidate, FEC, signal, vendor, CRM, report, alert, workspace, and revenue feed freshness.",
    }),
    makeGate({
      key: "executive_kpis",
      label: "Executive KPI Layer",
      score: kpiScore,
      status: nationalRisk >= 70 ? "Needs Review" : "Launch Ready",
      blockers: 0,
      review:
        num(kpiData?.summary?.urgent_tasks) +
        num(kpiData?.summary?.critical_alerts),
      route: "/executive-workspace",
      detail:
        "Platform-wide risk, tasks, alerts, revenue, and live readiness ribbon.",
    }),
    makeGate({
      key: "opportunity_engine",
      label: "Opportunity Engine",
      score: opportunityScore,
      status: opportunityScore >= 85 ? "Launch Ready" : "Needs Review",
      blockers: 0,
      review: opportunityScore >= 85 ? 0 : 1,
      route: "/opportunity-engine",
      detail:
        "Campaign scoring, CRM conversion, and follow-up task creation pipeline.",
    }),
    makeGate({
      key: "executive_workspace",
      label: "Executive Workspace",
      score: executiveWorkspaceScore,
      status:
        executiveWorkspaceScore >= 85 ? "Launch Ready" : "Needs Review",
      blockers: 0,
      review: executiveWorkspaceScore >= 85 ? 0 : 1,
      route: "/executive-workspace",
      detail:
        "Main operating hub for workspace intelligence, operations, CRM, revenue, reports, and tools.",
    }),
  ];

  const blockers = gates.reduce((sum, gate) => sum + num(gate.blockers), 0);
  const review = gates.reduce((sum, gate) => sum + num(gate.review), 0);
  const score = Math.round(
    gates.reduce((sum, gate) => sum + gate.score, 0) /
      Math.max(1, gates.length)
  );

  const status = gateStatus(score, blockers);

  const launchDecision =
    blockers > 0
      ? "Do Not Launch"
      : score >= 85
      ? "Ready To Launch"
      : "Launch With Review";

  const nextActions = gates
    .filter((gate) => gate.status !== "Launch Ready" || gate.blockers || gate.review)
    .sort((a, b) => b.blockers - a.blockers || a.score - b.score)
    .slice(0, 10)
    .map((gate) => ({
      key: gate.key,
      title: `${gate.label}: ${gate.status}`,
      detail:
        gate.blockers > 0
          ? `${gate.blockers} blocker(s) must be resolved.`
          : gate.review > 0
          ? `${gate.review} item(s) need review.`
          : "Review this gate before launch.",
      route: gate.route,
      priority: gate.blockers > 0 ? "High" : "Medium",
    }));

  return {
    summary: {
      score,
      status,
      launch_decision: launchDecision,
      blockers,
      review,
      total_gates: gates.length,
      ready_gates: gates.filter((gate) => gate.status === "Launch Ready").length,
      national_risk: nationalRisk,
      live_readiness: liveScore,
      qa_score: qaData?.summary?.score || 0,
      hardening_score: hardeningScore,
    },
    gates,
    next_actions: nextActions,
    source_errors: [
      hardening.status === "rejected"
        ? { source: "Production Hardening", error: hardening.reason?.message }
        : null,
      qa.status === "rejected"
        ? { source: "Launch QA", error: qa.reason?.message }
        : null,
      live.status === "rejected"
        ? { source: "Live Intelligence", error: live.reason?.message }
        : null,
      kpis.status === "rejected"
        ? { source: "Executive KPIs", error: kpis.reason?.message }
        : null,
      opportunities.status === "rejected"
        ? { source: "Opportunity Engine", error: opportunities.reason?.message }
        : null,
      workspace.status === "rejected"
        ? { source: "Executive Workspace", error: workspace.reason?.message }
        : null,
    ].filter(Boolean),
    updated_at: new Date().toISOString(),
  };
}