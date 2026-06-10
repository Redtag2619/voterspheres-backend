import { getProductionHardening } from "./productionHardening.service.js";
import { getLaunchQa } from "./launchQa.service.js";
import { getLiveIntelligenceLayer } from "./liveIntelligenceLayer.service.js";
import { getExecutiveKpis } from "./executiveKpi.service.js";
import { getOpportunityEngine } from "./opportunityEngine.service.js";
import { getExecutiveWorkspaceDashboard } from "./executiveWorkspace.service.js";

function num(value = 0) {
  return Number(value || 0);
}

function gateStatus(score, blockers = 0) {
  if (blockers > 0) return "Blocked";
  if (score >= 85) return "Launch Ready";
  if (score >= 65) return "Needs Review";
  return "Not Ready";
}

function makeGate({ key, label, score, status, blockers = 0, review = 0, route, detail }) {
  return {
    key,
    label,
    score: Math.max(0, Math.min(100, Math.round(num(score)))),
    status,
    blockers: num(blockers),
    review: num(review),
    route,
    detail,
  };
}

export async function getLaunchReadiness({ user = {} }) {
  const [hardening, qa, live, kpis, opportunities, workspace] = await Promise.allSettled([
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
  const opportunityData = opportunities.status === "fulfilled" ? opportunities.value : null;
  const workspaceData = workspace.status === "fulfilled" ? workspace.value : null;

  const gates = [
    makeGate({
      key: "production_hardening",
      label: "Production Hardening",
      score: hardeningData?.summary?.readiness_score || 0,
      status: hardeningData?.summary?.readiness_status || "Not Ready",
      blockers: hardeningData?.summary?.blocked || 0,
      review: hardeningData?.summary?.review || 0,
      route: "/production-hardening",
      detail: "Environment, security, billing, database, and workflow readiness.",
    }),
    makeGate({
      key: "launch_qa",
      label: "Launch QA",
      score: qaData?.summary?.score || 0,
      status: qaData?.summary?.status || "Not Ready",
      blockers: qaData?.summary?.fail || 0,
      review: qaData?.summary?.review || 0,
      route: "/launch-qa",
      detail: "Smoke tests for core platform routes, API, auth, billing, data, reports, and alerts.",
    }),
    makeGate({
      key: "live_intelligence",
      label: "Live Intelligence",
      score: liveData?.summary?.readiness_score || 0,
      status: liveData?.summary?.readiness_status || "Not Ready",
      blockers: num(liveData?.summary?.critical) + num(liveData?.summary?.missing),
      review: liveData?.summary?.stale || 0,
      route: "/live-intelligence-layer",
      detail: "Candidate, FEC, signal, vendor, CRM, report, alert, workspace, and revenue feed freshness.",
    }),
    makeGate({
      key: "executive_kpis",
      label: "Executive KPI Layer",
      score: 100 - Math.min(100, num(kpiData?.summary?.national_risk)),
      status:
        num(kpiData?.summary?.national_risk) >= 70
          ? "Needs Review"
          : "Launch Ready",
      blockers: 0,
      review: num(kpiData?.summary?.urgent_tasks) + num(kpiData?.summary?.critical_alerts),
      route: "/executive-workspace",
      detail: "Platform-wide risk, tasks, alerts, revenue, and live readiness ribbon.",
    }),
    makeGate({
      key: "opportunity_engine",
      label: "Opportunity Engine",
      score: opportunityData?.summary?.total ? Math.min(100, 60 + num(opportunityData?.summary?.hot) * 8 + num(opportunityData?.summary?.high) * 5) : 35,
      status: opportunityData?.summary?.total ? "Launch Ready" : "Needs Review",
      blockers: 0,
      review: opportunityData?.summary?.total ? 0 : 1,
      route: "/opportunity-engine",
      detail: "Campaign scoring, CRM conversion, and follow-up task creation pipeline.",
    }),
    makeGate({
      key: "executive_workspace",
      label: "Executive Workspace",
      score: workspaceData?.selected_workspace ? 95 : 45,
      status: workspaceData?.selected_workspace ? "Launch Ready" : "Needs Review",
      blockers: 0,
      review: workspaceData?.selected_workspace ? 0 : 1,
      route: "/executive-workspace",
      detail: "Main operating hub for workspace intelligence, operations, CRM, revenue, reports, and tools.",
    }),
  ];

  const blockers = gates.reduce((sum, gate) => sum + num(gate.blockers), 0);
  const review = gates.reduce((sum, gate) => sum + num(gate.review), 0);
  const score = Math.round(gates.reduce((sum, gate) => sum + gate.score, 0) / Math.max(1, gates.length));
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
      national_risk: kpiData?.summary?.national_risk || 0,
      live_readiness: liveData?.summary?.readiness_score || 0,
      qa_score: qaData?.summary?.score || 0,
      hardening_score: hardeningData?.summary?.readiness_score || 0,
    },
    gates,
    next_actions: nextActions,
    source_errors: [
      hardening.status === "rejected" ? { source: "Production Hardening", error: hardening.reason?.message } : null,
      qa.status === "rejected" ? { source: "Launch QA", error: qa.reason?.message } : null,
      live.status === "rejected" ? { source: "Live Intelligence", error: live.reason?.message } : null,
      kpis.status === "rejected" ? { source: "Executive KPIs", error: kpis.reason?.message } : null,
      opportunities.status === "rejected" ? { source: "Opportunity Engine", error: opportunities.reason?.message } : null,
      workspace.status === "rejected" ? { source: "Executive Workspace", error: workspace.reason?.message } : null,
    ].filter(Boolean),
    updated_at: new Date().toISOString(),
  };
}
