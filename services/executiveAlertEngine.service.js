import { getRelationshipGraph } from "./relationshipGraph.service.js";
import { getDarkMoneyExposure } from "./darkMoneyExposure.service.js";
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
  const type = String(item.type || item.event_type || "").toLowerCase();
  const source = String(item.source || "").toLowerCase();
  const title = String(item.title || "").toLowerCase();

  if (type.includes("dark") || source.includes("dark") || title.includes("dark money")) return "dark_money";
  if (type.includes("consultant") || source.includes("consultant") || title.includes("consultant")) return "consultant_exposure";
  if (type.includes("vendor") || source.includes("vendor")) return "vendor_gap";
  if (type.includes("relationship") || source.includes("relationship")) return "relationship_signal";
  if (type.includes("poll") || source.includes("poll")) return "polling_signal";
  if (type.includes("news") || source.includes("news") || source.includes("media")) return "news_signal";
  if (type.includes("fundraising") || type.includes("finance") || source.includes("fec") || source.includes("finance")) return "finance_signal";

  return "executive_signal";
}

function hasFamily(alerts = [], familyType = "") {
  return alerts.some((alert) =>
    String(alert.type || "").toLowerCase().includes(familyType)
  );
}

function addFallbackFamilyAlerts(alerts = []) {
  const now = new Date().toISOString();

  if (!hasFamily(alerts, "consultant")) {
    alerts.push({
      id: "fallback-consultant-watch",
      type: "consultant_exposure",
      severity: "medium",
      title: "Consultant exposure watch active",
      state: "National",
      office: "Consulting",
      risk: "Watch",
      score: 55,
      source: "Consultant Risk Engine",
      recommendation: "No high-risk consultant exposure is currently detected. Continue monitoring consultant relationships.",
      metadata: { generated_fallback: true, timestamp: now },
    });
  }

  if (!hasFamily(alerts, "finance")) {
    alerts.push({
      id: "fallback-finance-watch",
      type: "finance_signal",
      severity: "medium",
      title: "Finance monitoring active",
      state: "National",
      office: "Finance",
      risk: "Monitor",
      score: 52,
      source: "Finance Intelligence",
      recommendation: "No active fundraising spike is currently detected. Continue monitoring receipts, burn rate, and race pressure.",
      metadata: { generated_fallback: true, timestamp: now },
    });
  }

  if (!hasFamily(alerts, "polling")) {
    alerts.push({
      id: "fallback-polling-watch",
      type: "polling_signal",
      severity: "medium",
      title: "Polling movement monitor active",
      state: "National",
      office: "Polling",
      risk: "Watch",
      score: 50,
      source: "Polling Intelligence",
      recommendation: "No active polling movement is currently detected. Continue monitoring margin shifts and battleground changes.",
      metadata: { generated_fallback: true, timestamp: now },
    });
  }

  if (!hasFamily(alerts, "news")) {
    alerts.push({
      id: "fallback-news-watch",
      type: "news_signal",
      severity: "medium",
      title: "News and media monitoring active",
      state: "National",
      office: "Media",
      risk: "Monitor",
      score: 50,
      source: "News Intelligence",
      recommendation: "No active news escalation is currently detected. Continue monitoring attack narratives and media velocity.",
      metadata: { generated_fallback: true, timestamp: now },
    });
  }

  return alerts;
}

export async function buildExecutiveAlertFeed(options = {}) {
  const [
    relationshipGraph,
    consultantRisk,
    darkMoney,
    executiveFeed
  ] = await Promise.all([
    getRelationshipGraph({
      limit: options.limit || 100,
      minAmount: options.minAmount || 25000
    }),

    getConsultantRiskDashboard({
      limit: options.limit || 25
    }),

    getDarkMoneyExposure({
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
  for (const consultant of consultantRisk?.top_exposure || consultantRisk?.results || []) {
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
 * FINANCE / FUNDRAISING ALERTS
 */
for (const feed of executiveFeed || []) {
  const type = String(feed.type || feed.event_type || "").toLowerCase();
  const source = String(feed.source || "").toLowerCase();
  const title = String(feed.title || "").toLowerCase();

  const isFinance =
    type.includes("fundraising") ||
    type.includes("finance") ||
    type.includes("fec") ||
    source.includes("fundraising") ||
    source.includes("finance") ||
    source.includes("fec") ||
    title.includes("fundraising") ||
    title.includes("finance") ||
    title.includes("receipts");

  if (!isFinance) continue;

  alerts.push({
    id: `finance-${feed.id || alerts.length}`,
    type: "finance_signal",
    severity: String(feed.severity || "medium").toLowerCase(),
    title: feed.title || "Finance signal detected",
    state: feed.state || "National",
    office: feed.office || "Finance",
    risk: feed.risk || "Monitor",
    score: 65,
    source: feed.source || "Finance Intelligence",
    recommendation: "Review fundraising movement and compare against race pressure.",
    metadata: feed,
  });
}

/**
 * POLLING ALERTS
 */
for (const feed of executiveFeed || []) {
  const type = String(feed.type || feed.event_type || "").toLowerCase();
  const source = String(feed.source || "").toLowerCase();
  const title = String(feed.title || "").toLowerCase();

  const isPolling =
    type.includes("poll") ||
    source.includes("poll") ||
    title.includes("poll") ||
    title.includes("survey") ||
    title.includes("margin");

  if (!isPolling) continue;

  alerts.push({
    id: `polling-${feed.id || alerts.length}`,
    type: "polling_signal",
    severity: String(feed.severity || "medium").toLowerCase(),
    title: feed.title || "Polling movement detected",
    state: feed.state || "National",
    office: feed.office || "Polling",
    risk: feed.risk || "Watch",
    score: 60,
    source: feed.source || "Polling Intelligence",
    recommendation: "Review polling movement and update battleground pressure.",
    metadata: feed,
  });
}

/**
 * NEWS / MEDIA ALERTS
 */
for (const feed of executiveFeed || []) {
  const type = String(feed.type || feed.event_type || "").toLowerCase();
  const source = String(feed.source || "").toLowerCase();
  const title = String(feed.title || "").toLowerCase();

  const isNews =
    type.includes("news") ||
    type.includes("media") ||
    source.includes("news") ||
    source.includes("media") ||
    source.includes("war room") ||
    title.includes("attack") ||
    title.includes("story") ||
    title.includes("headline");

  if (!isNews) continue;

  alerts.push({
    id: `news-${feed.id || alerts.length}`,
    type: "news_signal",
    severity: String(feed.severity || "medium").toLowerCase(),
    title: feed.title || "News signal detected",
    state: feed.state || "National",
    office: feed.office || "Media",
    risk: feed.risk || "Monitor",
    score: 60,
    source: feed.source || "News Intelligence",
    recommendation: "Review media movement and prepare response guidance.",
    metadata: feed,
  });
}

  /**
 * DARK MONEY ALERTS
 */
for (const item of darkMoney?.top_exposure || darkMoney?.results || []) {
  const exposure = Number(item.exposure_score || 0);

  if (exposure < 50) continue;

  alerts.push({
    id: `dark-money-${item.committee_id || item.committee_name}`,
    type: "dark_money",
    severity: buildSeverity(exposure),
    title: `${item.committee_name || item.committee_id || "Committee"} dark money exposure elevated`,
    state: Array.isArray(item.states) ? item.states.join(", ") : "National",
    office: "Committee Network",
    risk: item.exposure_tier || item.severity || "Watch",
    score: exposure,
    source: "Dark Money Exposure Layer",
    recommendation: item.narrative || "Review committee relationships and consultant overlap.",
    metadata: item
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

  addFallbackFamilyAlerts(alerts);
  
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
