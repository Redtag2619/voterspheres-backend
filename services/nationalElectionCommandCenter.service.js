import { getElectionWarRoom } from "./electionWarRoom.service.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";
import { getAiStrategicAdvisor } from "./aiStrategicAdvisor.service.js";
import { pool } from "../db/pool.js";

const BUILD = "2.0.0-authoritative-national-command";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[national-command] skipped query:", error.message);
    return [];
  }
}

function normalizeText(value = "") {
  return lower(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeState(value = "") {
  const state = clean(value);
  return state || "National";
}

function normalizePriority(value = "") {
  const priority = lower(value);

  if (["critical", "p0"].includes(priority)) return "critical";
  if (["high", "p1"].includes(priority)) return "high";
  if (["elevated", "medium", "p2"].includes(priority)) return "elevated";
  if (["normal", "low", "p3", "p4"].includes(priority)) return "normal";

  return priority || "normal";
}

function priorityRank(value = "") {
  switch (normalizePriority(value)) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "elevated":
      return 2;
    case "normal":
      return 1;
    default:
      return 0;
  }
}

function strongerPriority(a, b) {
  return priorityRank(b) > priorityRank(a)
    ? normalizePriority(b)
    : normalizePriority(a);
}

function isLegacyDemoSource(value = "") {
  const source = lower(value);

  return (
    source === "launch_seed" ||
    source === "launch seed" ||
    source === "demo" ||
    source === "demo_seed" ||
    source === "demo seed"
  );
}

function baseOriginId(value = "") {
  let id = clean(value);

  let previous = null;

  while (id && previous !== id) {
    previous = id;

    id = id
      .replace(/^advisor-/i, "")
      .replace(/^threat-/i, "")
      .replace(/^recommendation-/i, "");
  }

  return id;
}

function canonicalKey(item = {}) {
  const title = normalizeText(item.title);
  const state = normalizeText(item.state || "National");
  const workspace =
    clean(
      item.workspace_id ??
        item.workspaceId ??
        item.metadata?.workspace_id ??
        item.metadata?.workspaceId ??
        ""
    ) || "";

  if (title) {
    return [
      "title",
      title,
      state || "national",
      workspace || "portfolio",
    ].join("|");
  }

  const origin = normalizeText(baseOriginId(item.id));

  if (origin) {
    return ["origin", origin, state || "national", workspace || "portfolio"].join(
      "|"
    );
  }

  return [
    "anonymous",
    normalizeText(item.type || item.category),
    state || "national",
    workspace || "portfolio",
  ].join("|");
}

function semanticRoute(item = {}) {
  const explicitRoute =
    clean(item.route) ||
    clean(item.action_route) ||
    clean(item.metadata?.route) ||
    clean(item.metadata?.action_route);

  if (explicitRoute.startsWith("/")) {
    return explicitRoute;
  }

  const text = lower(
    [
      item.title,
      item.description,
      item.action,
      item.type,
      item.category,
      item.recommendation,
      item.why,
      item.expected_impact,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (
    text.includes("relationship") ||
    text.includes("network") ||
    text.includes("influence graph")
  ) {
    return "/relationship-graph";
  }

  if (
    text.includes("dark money") ||
    text.includes("fec") ||
    text.includes("pac")
  ) {
    return "/dark-money-exposure";
  }

  if (text.includes("consultant")) {
    return "/consultant-intel";
  }

  if (
    text.includes("vendor") ||
    text.includes("media buy") ||
    text.includes("direct mail")
  ) {
    return "/vendors";
  }

  if (
    text.includes("fundraising") ||
    text.includes("donor") ||
    text.includes("finance")
  ) {
    return "/fundraising-dashboard";
  }

  if (
    text.includes("crm") ||
    text.includes("client follow") ||
    text.includes("follow-up") ||
    text.includes("follow up") ||
    text.includes("contact")
  ) {
    return "/campaign-crm";
  }

  if (
    text.includes("county") ||
    text.includes("field") ||
    text.includes("gotv") ||
    text.includes("ground operation") ||
    text.includes("field operation")
  ) {
    return "/operations-map";
  }

  if (
    text.includes("coalition") ||
    text.includes("strategy") ||
    text.includes("path to victory")
  ) {
    return "/strategy";
  }

  if (
    text.includes("battleground") ||
    text.includes("race pressure") ||
    text.includes("national race")
  ) {
    return "/national-command";
  }

  if (
    text.includes("political signal") ||
    text.includes("narrative") ||
    text.includes("news") ||
    text.includes("threat")
  ) {
    return "/political-signals";
  }

  if (
    text.includes("candidate") ||
    text.includes("opponent")
  ) {
    return "/candidates";
  }

  if (
    lower(item.type).includes("execution task") ||
    lower(item.category).includes("execution task")
  ) {
    return "/command-center";
  }

  if (
    lower(item.type).includes("crm") ||
    lower(item.category).includes("crm")
  ) {
    return "/campaign-crm";
  }

  if (
    lower(item.type).includes("signal") ||
    lower(item.type).includes("threat") ||
    lower(item.category).includes("signal")
  ) {
    return "/political-signals";
  }

  return "/national-command";
}

function materialityScore(item = {}) {
  let score = 25;

  const priority = normalizePriority(item.priority);

  if (priority === "critical") score += 45;
  else if (priority === "high") score += 35;
  else if (priority === "elevated") score += 22;
  else score += 10;

  const type = lower(item.type || item.category);

  if (type.includes("execution")) score += 15;
  if (type.includes("threat")) score += 14;
  if (type.includes("political signal")) score += 12;
  if (type.includes("rapid response")) score += 12;
  if (type.includes("crm")) score += 8;

  if (item.threat_enrichment) score += 8;
  if (item.advisor_enrichment) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function sourceList(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map(clean)
        .filter(Boolean)
    ),
  ];
}

function idList(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map(clean)
        .filter(Boolean)
    ),
  ];
}

function normalizeMissionItem(item = {}, sequence = 0) {
  return {
    ...item,
    id: clean(item.id) || `mission-${sequence + 1}`,
    title: clean(item.title) || "Executive command item",
    description:
      clean(item.description) ||
      clean(item.summary) ||
      "Executive action requires review.",
    priority: normalizePriority(item.priority || item.severity || item.risk),
    state: normalizeState(item.state),
    source: clean(item.source) || "Executive Mission Control",
    type: clean(item.type) || "Mission Item",
    action:
      clean(item.action) ||
      clean(item.recommendation) ||
      "Review and execute the required response.",
    route: semanticRoute(item),
    sources: sourceList(item.sources, item.source, "Executive Mission Control"),
    origin_ids: idList(item.origin_ids, item.id),
    enriched_by: sourceList(item.enriched_by),
    authoritative_origin: "Executive Mission Control",
    _sequence: sequence,
  };
}

function normalizeThreat(item = {}, sequence = 0) {
  const originalId = clean(item.id) || `war-room-${sequence + 1}`;

  const normalized = {
    ...item,
    id: `threat-${originalId}`,
    title: clean(item.title) || "Election threat",
    description:
      clean(item.recommendation) ||
      clean(item.description) ||
      clean(item.summary) ||
      "Election War Room threat requires review.",
    priority: normalizePriority(item.severity || item.risk || item.priority),
    state: normalizeState(item.state),
    source: clean(item.source) || "Election War Room",
    type: "Threat",
    action:
      clean(item.recommendation) ||
      clean(item.action) ||
      "Review threat and coordinate response.",
    sources: sourceList(item.sources, item.source, "Election War Room"),
    origin_ids: idList(item.origin_ids, item.id, `threat-${originalId}`),
    enriched_by: ["Election War Room"],
    authoritative_origin: "Election War Room",
    threat_enrichment: {
      id: originalId,
      severity: clean(item.severity || item.risk || item.priority),
      recommendation:
        clean(item.recommendation) ||
        clean(item.action) ||
        clean(item.description),
      source: clean(item.source) || "Election War Room",
    },
    _sequence: 1000 + sequence,
  };

  normalized.route = semanticRoute(normalized);

  return normalized;
}

function normalizeAdvisorRecommendation(item = {}, sequence = 0) {
  const originalId = clean(item.id) || `advisor-${sequence + 1}`;

  const normalized = {
    ...item,
    id: `advisor-${originalId}`,
    title: clean(item.title) || "Strategic recommendation",
    description:
      clean(item.why) ||
      clean(item.expected_impact) ||
      clean(item.description) ||
      "AI Strategic Advisor recommendation requires review.",
    priority: normalizePriority(item.priority),
    state: normalizeState(item.state),
    source: "AI Strategic Advisor",
    type: clean(item.category) || "Recommendation",
    action:
      clean(item.action) ||
      clean(item.recommendation) ||
      clean(item.expected_impact) ||
      "Review strategic recommendation.",
    sources: sourceList(
      item.sources,
      item.source,
      "AI Strategic Advisor"
    ),
    origin_ids: idList(item.origin_ids, item.id, `advisor-${originalId}`),
    enriched_by: ["AI Strategic Advisor"],
    authoritative_origin: "AI Strategic Advisor",
    advisor_enrichment: {
      id: originalId,
      confidence:
        item.confidence ??
        item.confidence_score ??
        null,
      why: clean(item.why),
      expected_impact: clean(item.expected_impact),
      recommendation: clean(item.recommendation || item.action),
      source: clean(item.source),
    },
    _sequence: 2000 + sequence,
  };

  normalized.route = semanticRoute(normalized);

  return normalized;
}

function mergeCommandItem(existing, incoming) {
  const existingIsMission =
    existing.authoritative_origin === "Executive Mission Control";

  const incomingIsMission =
    incoming.authoritative_origin === "Executive Mission Control";

  let primary = existing;
  let secondary = incoming;

  if (!existingIsMission && incomingIsMission) {
    primary = incoming;
    secondary = existing;
  }

  const merged = {
    ...secondary,
    ...primary,

    priority: strongerPriority(primary.priority, secondary.priority),

    description:
      clean(primary.description) ||
      clean(secondary.description),

    action:
      clean(primary.action) ||
      clean(secondary.action),

    sources: sourceList(
      primary.sources,
      secondary.sources,
      primary.source,
      secondary.source
    ),

    origin_ids: idList(
      primary.origin_ids,
      secondary.origin_ids,
      primary.id,
      secondary.id
    ),

    enriched_by: sourceList(
      primary.enriched_by,
      secondary.enriched_by
    ),

    threat_enrichment:
      primary.threat_enrichment ||
      secondary.threat_enrichment ||
      null,

    advisor_enrichment:
      primary.advisor_enrichment ||
      secondary.advisor_enrichment ||
      null,

    _sequence: Math.min(
      Number(primary._sequence ?? 999999),
      Number(secondary._sequence ?? 999999)
    ),
  };

  if (
    existing.authoritative_origin === "Executive Mission Control" ||
    incoming.authoritative_origin === "Executive Mission Control"
  ) {
    merged.authoritative_origin = "Executive Mission Control";
  }

  merged.route = semanticRoute(merged);

  return merged;
}

function buildAuthoritativeCommandItems({
  missionItems = [],
  threats = [],
  recommendations = [],
}) {
  const normalized = [
    ...arr(missionItems).map(normalizeMissionItem),
    ...arr(threats).map(normalizeThreat),
    ...arr(recommendations).map(normalizeAdvisorRecommendation),
  ].filter((item) => !isLegacyDemoSource(item.source));

  const byKey = new Map();

  for (const item of normalized) {
    const key = canonicalKey(item);

    if (!byKey.has(key)) {
      byKey.set(key, item);
      continue;
    }

    byKey.set(key, mergeCommandItem(byKey.get(key), item));
  }

  return [...byKey.values()]
    .map((item) => ({
      ...item,
      route: semanticRoute(item),
      materiality_score: materialityScore(item),
    }))
    .sort((a, b) => {
      const priorityDifference =
        priorityRank(b.priority) - priorityRank(a.priority);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      const materialityDifference =
        Number(b.materiality_score || 0) -
        Number(a.materiality_score || 0);

      if (materialityDifference !== 0) {
        return materialityDifference;
      }

      return Number(a._sequence || 0) - Number(b._sequence || 0);
    })
    .slice(0, 18)
    .map(({ _sequence, ...item }) => item);
}

export async function getNationalElectionCommandCenter({ user = {} }) {
  const firmId = getFirmId(user);

  if (!firmId) {
    const error = new Error("Missing firm context.");
    error.status = 403;
    throw error;
  }

  const [mission, warRoom, advisor] = await Promise.all([
    getExecutiveMissionControl({ user }),
    getElectionWarRoom({ user }),
    getAiStrategicAdvisor({ user }),
  ]);

  const [reports, exports, clients] = await Promise.all([
    safeQuery(
      `
        SELECT
          id,
          title,
          report_type,
          state,
          status,
          executive_summary,
          created_at
        FROM intelligence_reports
        WHERE firm_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [firmId]
    ),

    safeQuery(
      `
        SELECT
          id,
          report_id,
          export_type,
          title,
          status,
          metadata,
          created_at
        FROM report_exports
        WHERE firm_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [firmId]
    ),

    safeQuery(
      `
        SELECT
          id,
          client_name,
          organization,
          email,
          access_level,
          status,
          workspace_id,
          last_viewed_at,
          created_at
        FROM client_portal_clients
        WHERE firm_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [firmId]
    ),
  ]);

  const missionItems = arr(mission?.mission_items);
  const threats = arr(warRoom?.threats);
  const recommendations = arr(advisor?.recommendations);

  const command_items = buildAuthoritativeCommandItems({
    missionItems,
    threats,
    recommendations,
  });

  const pressureScore =
    mission?.summary?.pressure_score ??
    warRoom?.summary?.pressure_score ??
    advisor?.summary?.pressure_score ??
    0;

  const missionRisk =
    mission?.summary?.mission_risk ||
    warRoom?.summary?.mission_risk ||
    advisor?.summary?.strategic_risk ||
    "Stable";

  const workspaceHealth =
    arr(mission?.workspace_health).length > 0
      ? arr(mission.workspace_health)
      : arr(warRoom?.command_cards);

  const responseQueue = arr(warRoom?.queue);

  const uniqueSources = sourceList(
    command_items.flatMap((item) => item.sources || item.source)
  );

  return {
    build: BUILD,
    mode: "authoritative-national-command",
    source: "mission-control-primary-with-enrichment",

    summary: {
      mission_risk: missionRisk,
      pressure_score: pressureScore,
      command_items: command_items.length,
      threats: threats.length,
      response_queue: responseQueue.length,
      recommendations: recommendations.length,
      reports: reports.length,
      exports: exports.length,
      client_portals: clients.length,
      active_clients: clients.filter(
        (client) => lower(client.status) === "active"
      ).length,
      workspaces: workspaceHealth.length,

      mission_items_ingested: missionItems.length,
      threats_ingested: threats.length,
      recommendations_ingested: recommendations.length,

      raw_command_candidates:
        missionItems.length +
        threats.length +
        recommendations.length,

      duplicates_collapsed:
        missionItems.length +
        threats.length +
        recommendations.length -
        command_items.length,

      authoritative_sources: uniqueSources.length,
      legacy_seed_items_in_command_queue: command_items.filter((item) =>
        isLegacyDemoSource(item.source)
      ).length,
    },

    safeguards: {
      mission_control_primary_identity: true,
      advisor_enrichment_only: true,
      war_room_threat_enrichment: true,
      canonical_deduplication: true,
      semantic_routing: true,
      legacy_launch_seed_excluded: true,
      authoritative_zero_preserved: true,
    },

    mission,
    war_room: warRoom,
    advisor,

    command_items,

    workspace_health: workspaceHealth,
    response_queue: responseQueue,

    reports,
    exports,
    clients,

    updated_at: new Date().toISOString(),
  };
}
