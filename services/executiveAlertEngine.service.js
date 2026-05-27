import { getRelationshipGraph } from "./relationshipGraph.service.js";
import { getConsultantRiskDashboard } from "./consultantRisk.service.js";
import { getExecutiveFeedEvents } from "./intelligenceRefresh.service.js";

function severityFromScore(score = 0) {
  const value = Number(score || 0);
  if (value >= 85) return "critical";
  if (value >= 70) return "high";
  if (value >= 50) return "medium";
  return "low";
}

function severityRank(value = "low") {
  const v = String(value || "low").toLowerCase();
  if (v === "critical") return 4;
  if (v === "high") return 3;
  if (v === "medium") return 2;
  return 1;
}

export async function buildExecutiveAlertFeed(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 100);

  const [relationshipGraph, consultantRisk, executiveFeed] = await Promise.all([
    getRelationshipGraph({ limit: 100, minAmount: options.minAmount || 25000 }),
    getConsultantRiskDashboard({ limit: 25 }),
    getExecutiveFeedEvents(limit),
  ]);

  const alerts = [];

  for (const consultant of consultantRisk?.top_exposure || []) {
    const score = Number(consultant.exposure_score || 0);
    if (score < 60) continue;

    alerts.push({
      id: `consultant-${consultant.id}`,
      type: "consultant_exposure",
      severity: severityFromScore(score),
      title: `${consultant.name || consultant.firm_name || "Consultant"} exposure elevated`,
      source: "Consultant Risk Engine",
      state: consultant.state || "National",
      office: "Consulting",
      risk: consultant.risk_label || "Watch",
      score,
      recommendation: "Review consultant overlap and candidate relationships.",
      metadata: consultant,
    });
  }

  for (const link of relationshipGraph?.links || []) {
    const score = Number(link.strength || 0);
    if (score < 75) continue;

    alerts.push({
      id: `relationship-${link.id}`,
      type: "relationship_signal",
      severity: severityFromScore(score),
      title: `${link.label || "Relationship"} strength spike`,
      source: "Relationship Graph",
      state: "National",
      office: "Network",
      risk: "Monitor",
      score,
      recommendation: "Open Relationship Graph and inspect source/target pathway.",
      metadata: link,
    });
  }

  for (const feed of executiveFeed || []) {
    alerts.push({
      id: `feed-${feed.id}`,
      type: feed.type || "executive_feed",
      severity: String(feed.severity || "medium").toLowerCase(),
      title: feed.title || "Executive signal detected",
      source: feed.source || "Executive Feed",
      state: feed.state || "National",
      office: feed.office || "N/A",
      risk: feed.risk || "Monitor",
      score: severityRank(feed.severity) * 25,
      recommendation: feed.metadata?.recommendation || "Review and assign owner.",
      metadata: feed,
    });
  }

  alerts.sort((a, b) => {
    const rankDiff = severityRank(b.severity) - severityRank(a.severity);
    if (rankDiff !== 0) return rankDiff;
    return Number(b.score || 0) - Number(a.score || 0);
  });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    counts: {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      high: alerts.filter((a) => a.severity === "high").length,
      medium: alerts.filter((a) => a.severity === "medium").length,
      low: alerts.filter((a) => a.severity === "low").length,
    },
    alerts: alerts.slice(0, limit),
  };
}
