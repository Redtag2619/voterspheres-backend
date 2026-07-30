import {
  DOMAIN_CONFIG,
  FEED_CONFIG,
  SCORING_RULES,
} from "../constants/liveIntelligence.constants.js";

import {
  readFeedStats,
} from "../repositories/liveIntelligence.repository.js";

import {
  buildBlocker,
  buildDomainScores,
  clamp,
  readinessStatus,
  scoreFeed,
} from "./liveIntelligenceScoring.service.js";

const clean = (value = "") =>
  String(value ?? "").trim();

function buildFeedResult(
  feed,
  stats,
  scored
) {
  return {
    key: feed.key,
    label: feed.label,
    description: feed.description,

    domain_key: feed.domain,
    domain:
      DOMAIN_CONFIG[feed.domain]?.label ||
      feed.domain,

    criticality: feed.criticality,
    required_for_launch:
      Boolean(feed.requiredForLaunch),

    weight: Number(feed.weight || 0),
    score: Number(scored.score.toFixed(1)),
    weighted_score: Number(
      (
        (
          scored.score *
          Number(feed.weight || 0)
        ) /
        100
      ).toFixed(1)
    ),

    status: scored.status,

    connectivity_score: Number(
      scored.connectivityScore.toFixed(1)
    ),
    freshness_score: Number(
      scored.freshnessScore.toFixed(1)
    ),
    coverage_score: Number(
      scored.coverageScore.toFixed(1)
    ),
    quality_score: Number(
      scored.qualityScore.toFixed(1)
    ),

    count: Number(stats.count || 0),
    target_count: Number(
      feed.targetCount || 0
    ),

    invalid_count: Number(
      stats.invalidCount || 0
    ),
    duplicate_count: Number(
      stats.duplicateCount || 0
    ),

    last_seen: stats.lastSeen || null,
    last_success_at:
      stats.lastSeen || null,
    last_attempt_at:
      new Date().toISOString(),

    failure_reason:
      clean(stats.failureReason),

    remediation: feed.remediation,
    owner: feed.owner,
    route: feed.route,

    freshness_threshold_hours:
      Number(
        feed.freshnessThresholdHours || 0
      ),
    stale_threshold_hours:
      Number(
        feed.staleThresholdHours || 0
      ),

    environment:
      process.env.NODE_ENV === "production"
        ? "production"
        : "development",

    source_table:
      stats.tableName || null,
  };
}

async function evaluateFeed(feed) {
  let stats;

  try {
    stats = await readFeedStats(feed);
  } catch (error) {
    stats = {
      connected: false,
      tableName: null,
      count: 0,
      lastSeen: null,
      invalidCount: 0,
      duplicateCount: 0,
      failureReason:
        clean(error?.message) ||
        "Feed health query failed.",
    };
  }

  const scored = scoreFeed(feed, stats);

  return buildFeedResult(
    feed,
    stats,
    scored
  );
}

function buildSummary(
  feeds,
  blockers,
  domains
) {
  const readinessScore = clamp(
    domains.reduce(
      (sum, domain) =>
        sum + domain.weighted_score,
      0
    )
  );

  const readyFeeds = feeds.filter(
    (feed) =>
      ["live", "fresh", "ready"].includes(
        feed.status
      )
  );

  const coreFeeds = feeds.filter(
    (feed) =>
      feed.criticality === "core"
  );

  const coreReady = coreFeeds.filter(
    (feed) =>
      ["live", "fresh", "ready"].includes(
        feed.status
      )
  );

  const projectedScore = clamp(
    readinessScore +
      blockers.reduce(
        (sum, blocker) =>
          sum + blocker.score_impact,
        0
      )
  );

  return {
    readiness_score: Number(
      readinessScore.toFixed(1)
    ),
    readiness_status:
      readinessStatus(readinessScore),
    projected_score: Number(
      projectedScore.toFixed(1)
    ),

    total_feeds: feeds.length,
    ready_feeds: readyFeeds.length,
    review_feeds:
      feeds.length - readyFeeds.length,
    blocker_count: blockers.length,

    live: feeds.filter(
      (feed) => feed.status === "live"
    ).length,
    fresh: feeds.filter(
      (feed) => feed.status === "fresh"
    ).length,
    stale: feeds.filter(
      (feed) => feed.status === "stale"
    ).length,
    critical: feeds.filter(
      (feed) =>
        feed.status === "critical"
    ).length,
    missing: feeds.filter(
      (feed) => feed.status === "missing"
    ).length,
    degraded: feeds.filter(
      (feed) =>
        feed.status === "degraded"
    ).length,
    disconnected: feeds.filter(
      (feed) =>
        feed.status === "disconnected"
    ).length,

    core_ready: coreReady.length,
    core_total: coreFeeds.length,

    score_change_24h: 0,
    last_scan_at:
      new Date().toISOString(),
  };
}

function addProjectedScores(
  blockers,
  readinessScore
) {
  let runningProjection =
    Number(readinessScore || 0);

  return blockers.map((blocker) => {
    runningProjection = clamp(
      runningProjection +
        blocker.score_impact
    );

    return {
      ...blocker,
      estimated_score_after_fix:
        Number(
          runningProjection.toFixed(1)
        ),
    };
  });
}

export async function buildLiveIntelligenceReadiness() {
  const feeds = [];

  for (const feed of FEED_CONFIG) {
    feeds.push(
      await evaluateFeed(feed)
    );
  }

  const domains =
    buildDomainScores(feeds);

  const initialBlockers = feeds
    .map(buildBlocker)
    .filter(Boolean)
    .sort((a, b) => {
      const priorityRank = {
        high: 0,
        critical: 0,
        medium: 1,
        low: 2,
      };

      return (
        (
          priorityRank[a.priority] ??
          3
        ) -
          (
            priorityRank[b.priority] ??
            3
          ) ||
        b.score_impact -
          a.score_impact
      );
    });

  const preliminarySummary =
    buildSummary(
      feeds,
      initialBlockers,
      domains
    );

  const blockers =
    addProjectedScores(
      initialBlockers,
      preliminarySummary.readiness_score
    );

  const summary = buildSummary(
    feeds,
    blockers,
    domains
  );

  return {
    summary,
    domains,
    feeds,
    blockers,

    // Backward compatibility with the
    // original Live Intelligence page.
    recommendations: blockers,

    history: [],
    rules: SCORING_RULES,
  };
}
