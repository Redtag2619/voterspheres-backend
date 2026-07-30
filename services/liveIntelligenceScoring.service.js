import {
  DOMAIN_CONFIG,
  READINESS_COMPONENT_WEIGHTS,
} from "../constants/liveIntelligence.constants.js";

export function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function hoursSince(value) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, (Date.now() - timestamp) / 3_600_000);
}

export function readinessStatus(score) {
  if (score >= 85) return "Launch Ready";
  if (score >= 65) return "Needs Review";
  return "Not Ready";
}

export function feedStatusFromScore(
  score,
  {
    count = 0,
    connected = true,
    lastSeen = null,
  } = {}
) {
  if (!connected) return "disconnected";
  if (!count) return "missing";
  if (!lastSeen) return "critical";
  if (score >= 90) return "live";
  if (score >= 75) return "fresh";
  if (score >= 55) return "stale";
  if (score >= 35) return "degraded";
  return "critical";
}

export function blockerPriority(status, requiredForLaunch) {
  const highRiskStatuses = [
    "missing",
    "critical",
    "failed",
    "disconnected",
  ];

  if (
    requiredForLaunch &&
    highRiskStatuses.includes(status)
  ) {
    return "high";
  }

  if (
    [
      ...highRiskStatuses,
      "degraded",
    ].includes(status)
  ) {
    return "medium";
  }

  return "low";
}

function calculateFreshnessScore(feed, stats) {
  if (!stats.connected || !stats.lastSeen) {
    return 0;
  }

  const ageHours = hoursSince(stats.lastSeen);

  if (ageHours === null) {
    return 0;
  }

  if (ageHours <= feed.freshnessThresholdHours) {
    return 100;
  }

  if (ageHours <= feed.staleThresholdHours) {
    const range =
      feed.staleThresholdHours -
      feed.freshnessThresholdHours;

    const elapsed =
      ageHours -
      feed.freshnessThresholdHours;

    return clamp(
      100 -
        (elapsed / Math.max(1, range)) * 55
    );
  }

  return clamp(
    45 -
      (
        (
          ageHours -
          feed.staleThresholdHours
        ) /
        Math.max(1, feed.staleThresholdHours)
      ) *
        45
  );
}

function calculateCoverageScore(feed, stats) {
  const targetCount = Math.max(
    1,
    Number(feed.targetCount || 1)
  );

  return clamp(
    (Number(stats.count || 0) / targetCount) * 100
  );
}

function calculateQualityScore(stats) {
  const count = Number(stats.count || 0);

  if (!count) {
    return stats.connected ? 100 : 0;
  }

  const invalidRate =
    Number(stats.invalidCount || 0) / count;

  const duplicateRate =
    Number(stats.duplicateCount || 0) / count;

  return clamp(
    100 -
      invalidRate * 100 -
      duplicateRate * 100
  );
}

export function scoreFeed(feed, stats) {
  const connectivityScore = stats.connected ? 100 : 0;
  const freshnessScore = calculateFreshnessScore(
    feed,
    stats
  );
  const coverageScore = calculateCoverageScore(
    feed,
    stats
  );
  const qualityScore = calculateQualityScore(stats);

  const score = clamp(
    connectivityScore *
      (
        READINESS_COMPONENT_WEIGHTS.connectivity /
        100
      ) +
      freshnessScore *
        (
          READINESS_COMPONENT_WEIGHTS.freshness /
          100
        ) +
      coverageScore *
        (
          READINESS_COMPONENT_WEIGHTS.coverage /
          100
        ) +
      qualityScore *
        (
          READINESS_COMPONENT_WEIGHTS.quality /
          100
        )
  );

  const status = feedStatusFromScore(score, {
    count: Number(stats.count || 0),
    connected: stats.connected,
    lastSeen: stats.lastSeen,
  });

  return {
    score,
    status,
    connectivityScore,
    freshnessScore,
    coverageScore,
    qualityScore,
    ageHours: hoursSince(stats.lastSeen),
  };
}

export function buildDomainScores(feeds) {
  return Object.entries(DOMAIN_CONFIG).map(
    ([key, config]) => {
      const domainFeeds = feeds.filter(
        (feed) => feed.domainKey === key
      );

      const totalWeight = domainFeeds.reduce(
        (sum, feed) => sum + feed.weight,
        0
      );

      const score = totalWeight
        ? domainFeeds.reduce(
            (sum, feed) =>
              sum + feed.score * feed.weight,
            0
          ) / totalWeight
        : 0;

      const readyFeeds = domainFeeds.filter(
        (feed) =>
          ["live", "fresh", "ready"].includes(
            feed.status
          )
      );

      const blockerCount =
        domainFeeds.length - readyFeeds.length;

      return {
        key,
        label: config.label,
        description: config.description,
        weight: config.weight,
        score: Number(score.toFixed(1)),
        weighted_score: Number(
          (
            (score * config.weight) /
            100
          ).toFixed(1)
        ),
        status: feedStatusFromScore(score, {
          count: domainFeeds.length,
          connected: domainFeeds.some(
            (feed) =>
              feed.connectivity_score > 0
          ),
          lastSeen:
            domainFeeds.find(
              (feed) => feed.last_success_at
            )?.last_success_at || null,
        }),
        ready_feeds: readyFeeds.length,
        total_feeds: domainFeeds.length,
        blocker_count: blockerCount,
      };
    }
  );
}

export function buildBlocker(feed) {
  if (
    ["live", "fresh", "ready"].includes(
      feed.status
    )
  ) {
    return null;
  }

  const scoreImpact = clamp(
    (
      feed.weight *
      (100 - feed.score)
    ) /
      100,
    0,
    feed.weight
  );

  return {
    key: `blocker:${feed.key}`,
    feed_key: feed.key,
    title: `${feed.label} requires remediation`,
    detail:
      feed.failure_reason ||
      `${feed.label} is ${feed.status} with ${Math.round(
        feed.score
      )}% health.`,
    status: feed.status,
    priority: blockerPriority(
      feed.status,
      feed.required_for_launch
    ),
    owner: feed.owner,
    route: feed.route,
    remediation: feed.remediation,
    score_impact: Number(
      scoreImpact.toFixed(1)
    ),
    estimated_score_after_fix: 0,
    last_success_at: feed.last_success_at,
  };
}
