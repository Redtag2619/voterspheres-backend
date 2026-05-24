import { getRelationshipGraph } from "./relationshipGraph.service.js";
import {
  getConsultantRiskDashboard
} from "./consultantRisk.service.js";

import {
  getExecutiveFeedEvents
} from "./intelligenceRefresh.service.js";

function buildSeverity(score = 0) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function buildSignalType(item = {}) {
  if (item.type?.includes("dark")) return "dark_money";
  if (item.type?.includes("consultant")) return "consultant";
  if (item.type?.includes("vendor")) return "vendor_gap";
  if (item.type?.includes("relationship")) return "relationship";
  return "executive_signal";
}

export async function buildExecutiveAlertFeed(options = {}) {
  const [
    relationshipGraph,
    consultantRisk,
    executiveFeed
  ] = await Promise.all([
    getRelationshipGraph({
      limit: options.limit || 100,
      minAmount: options.minAmount || 25000
    }),

    getConsultantRiskDashboard({
      limit: options.limit || 25
    }),

    getExecutiveFeedEvents(
      options.limit || 20
    )
  ]);

  const alerts = [];

  /**
   * CONSULTANT RISK ALERTS
   */
  for (const consultant of consultantRisk.top_exposure || []) {
    const exposure =
      Number(consultant.exposure_score || 0);

    if (exposure < 60) continue;

    alerts.push({
      id: `consultant-${consultant.id}`,
      type: "consultant_exposure",
      severity: buildSeverity(exposure),
      title: `${consultant.name} exposure elevated`,
      state: consultant.state,
      risk_label: consultant.risk_label,
      score: exposure,
      source: "Consultant Risk Engine",
      metadata: consultant
    });
  }

  /**
   * RELATIONSHIP GRAPH ALERTS
   */
  for (const link of relationshipGraph.links || []) {
    const strength =
      Number(link.strength || 0);

    if (strength < 75) continue;

    alerts.push({
      id: `relationship-${link.id}`,
      type: "relationship_signal",
      severity: buildSeverity(strength),
      title: `${link.label} relationship spike`,
      score: strength,
      source: "Relationship Graph",
      metadata: link
    });
  }

  /**
   * EXECUTIVE FEED ALERTS
   */
  for (const feed of executiveFeed || []) {
    alerts.push({
      id: `feed-${feed.id}`,
      type: buildSignalType(feed),
      severity:
        String(feed.severity || "medium").toLowerCase(),
      title: feed.title,
      state: feed.state,
      office: feed.office,
      risk: feed.risk,
      source: feed.source,
      metadata: feed
    });
  }

  alerts.sort((a, b) => {
    const rank = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    return (
      rank[b.severity] - rank[a.severity]
    );
  });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    counts: {
      total: alerts.length,
      critical: alerts.filter(
        (a) => a.severity === "critical"
      ).length,
      high: alerts.filter(
        (a) => a.severity === "high"
      ).length
    },
    alerts
  };
}
