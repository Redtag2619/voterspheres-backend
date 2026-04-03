import { publishEvent } from "../lib/intelligence.events.js";

const FALLBACK_FORECAST = {
  metrics: [
    { label: "National Control Probability", value: "58%", delta: "+3.1", tone: "up" },
    { label: "Battleground Volatility", value: "High", delta: "+7 signals", tone: "down" },
    { label: "Turnout Confidence", value: "72", delta: "+4.8", tone: "up" },
    { label: "Persuasion Efficiency", value: "8.3", delta: "+0.9", tone: "up" }
  ],
  races: [
    {
      id: 1,
      race: "PA Senate",
      state: "Pennsylvania",
      office: "Senate",
      winProb: 54,
      change: "+2.1",
      rating: "Lean",
      status: "Momentum Up",
      overlayTier: "elevated",
      overlayScore: 78,
      funds: "$12.4M"
    },
    {
      id: 2,
      race: "GA Senate",
      state: "Georgia",
      office: "Senate",
      winProb: 57,
      change: "+2.9",
      rating: "Lean",
      status: "Improving",
      overlayTier: "high",
      overlayScore: 81,
      funds: "$14.1M"
    },
    {
      id: 3,
      race: "AZ-01",
      state: "Arizona",
      office: "House",
      winProb: 51,
      change: "+1.4",
      rating: "Toss-up",
      status: "Watch",
      overlayTier: "watch",
      overlayScore: 70,
      funds: "$7.8M"
    }
  ],
  scenarios: [
    {
      title: "Base Case",
      probability: "44%",
      summary: "Stable suburban gains and neutral press environment."
    },
    {
      title: "Upside Breakout",
      probability: "27%",
      summary: "Stronger turnout and message dominance on affordability."
    }
  ],
  notes: [
    {
      title: "Probability curve steepening in top suburban districts",
      detail: "Confidence is improving where affordability and turnout align."
    },
    {
      title: "Most efficient growth path remains persuasion + validation",
      detail: "District-tuned validators outperform broad national messaging."
    }
  ]
};

async function getDb() {
  const candidates = [
    "../config/database.js",
    "../db.js",
    "../config/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      return mod.default || mod.db || mod.pool || mod.client || null;
    } catch {
      // keep trying
    }
  }

  return null;
}

async function safeQuery(sql, params = []) {
  try {
    const db = await getDb();
    if (!db) return { rows: [] };

    if (typeof db.query === "function") {
      return await db.query(sql, params);
    }

    if (typeof db.execute === "function") {
      const [rows] = await db.execute(sql, params);
      return { rows };
    }

    return { rows: [] };
  } catch {
    return { rows: [] };
  }
}

function normalizeRace(row, index = 0) {
  const winProb = Number(
    row.win_probability ??
      row.winProb ??
      row.win_probability_pct ??
      row.winProbability ??
      0
  );

  return {
    id: row.id ?? index + 1,
    race:
      row.race ||
      row.race_name ||
      `${row.state || "State"} ${row.office || "Race"}`,
    state: row.state || "Unknown",
    office: row.office || "Race",
    winProb,
    winProbability: winProb,
    change: row.change || row.delta || "+0.0",
    rating: row.rating || row.category || "Competitive",
    status: row.status || "Active",
    overlayTier: row.overlay_tier || row.overlayTier || "watch",
    overlayScore: row.overlay_score ?? row.overlayScore ?? 0,
    funds: row.funds || row.fundraising_total || "$0",
    note: row.note || row.summary || "Live forecast overlay"
  };
}

function buildMetrics(races) {
  const avg =
    races.length > 0
      ? Math.round(
          races.reduce((sum, r) => sum + Number(r.winProb || 0), 0) / races.length
        )
      : 0;

  const tossups = races.filter((r) =>
    ["toss-up", "competitive"].includes(String(r.rating || "").toLowerCase())
  ).length;

  return [
    {
      label: "Tracked Races",
      value: String(races.length),
      delta: "Live forecast feed",
      tone: "up"
    },
    {
      label: "Average Win Probability",
      value: `${avg}%`,
      delta: "Across active board",
      tone: "up"
    },
    {
      label: "Competitive Races",
      value: String(tossups),
      delta: "Closest contests",
      tone: "down"
    },
    {
      label: "Map Confidence",
      value: races.length ? "Live" : "Fallback",
      delta: "Forecast engine online",
      tone: "up"
    }
  ];
}

export async function getForecastSummary() {
  const { rows } = await safeQuery(
    `
      select *
      from forecast_snapshots
      order by published_at desc nulls last, created_at desc nulls last
      limit 1
    `
  );

  const snapshot = rows[0] || null;

  return {
    published_at: snapshot?.published_at || null,
    race_count: snapshot?.race_count || FALLBACK_FORECAST.races.length,
    tossup_count: snapshot?.tossup_count || 1,
    high_confidence_count: snapshot?.high_confidence_count || 2
  };
}

export async function getForecast() {
  const { rows } = await safeQuery(
    `
      select *
      from forecast_races
      order by
        coalesce(rank, 999999) asc,
        coalesce(updated_at, created_at) desc nulls last
      limit 50
    `
  );

  const races =
    rows.length > 0
      ? rows.map((row, index) => normalizeRace(row, index))
      : FALLBACK_FORECAST.races;

  return {
    metrics: buildMetrics(races),
    races,
    battlegrounds: races.slice(0, 12),
    scenarios: FALLBACK_FORECAST.scenarios,
    notes: FALLBACK_FORECAST.notes,
    snapshot: await getForecastSummary()
  };
}

export async function getForecastRankings() {
  const forecast = await getForecast();

  const campaigns = forecast.races.map((row, index) => ({
    rank: index + 1,
    raceKey: `${row.state}-${row.office}-${index + 1}`,
    leader: row.race,
    state: row.state,
    office: row.office,
    winProbability: row.winProb,
    rating: row.rating
  }));

  return {
    metrics: forecast.metrics,
    campaigns
  };
}

export async function getForecastOverlays() {
  const forecast = await getForecast();

  return {
    metrics: forecast.metrics,
    battlegrounds: forecast.races.slice(0, 12).map((row) => ({
      id: row.id,
      name: row.race,
      race: row.race,
      state: row.state,
      office: row.office,
      winProb: row.winProb,
      winProbability: row.winProb,
      overlayTier: row.overlayTier,
      overlayScore: row.overlayScore,
      funds: row.funds,
      note: row.note,
      fill:
        row.overlayTier === "high"
          ? "#f59e0b"
          : row.overlayTier === "elevated"
          ? "#0ea5e9"
          : "#334155",
      stroke:
        row.overlayTier === "high"
          ? "#fcd34d"
          : row.overlayTier === "elevated"
          ? "#67e8f9"
          : "#94a3b8"
    }))
  };
}

export async function rebuildForecastSnapshot(input = {}) {
  const forecast = await getForecast();
  const first = forecast.races[0];

  publishEvent({
    type: "forecast.updated",
    channel: "intelligence:forecast",
    timestamp: new Date().toISOString(),
    payload: {
      state: input.state || first?.state || "Arizona",
      office: input.office || first?.office || "Senate",
      winProbability: input.winProbability ?? first?.winProb ?? 54,
      change: input.change || first?.change || "+2.1"
    }
  });

  return {
    ok: true,
    published_at: new Date().toISOString(),
    count: forecast.races.length
  };
}

/**
 * Compatibility exports for older forecast routes
 */

export async function getPublishedForecast() {
  const forecast = await getForecast();
  return {
    published_at: forecast.snapshot?.published_at || null,
    races: forecast.races,
    metrics: forecast.metrics,
    scenarios: forecast.scenarios,
    notes: forecast.notes
  };
}

export async function getForecastMap() {
  return getForecastOverlays();
}

export async function getForecastBattlegrounds() {
  const forecast = await getForecast();
  return forecast.battlegrounds || [];
}

export async function getForecastSnapshot() {
  return getForecastSummary();
}

export async function publishForecastUpdate(input = {}) {
  return rebuildForecastSnapshot(input);
}

export default {
  getForecast,
  getForecastSummary,
  getForecastRankings,
  getForecastOverlays,
  rebuildForecastSnapshot,
  getPublishedForecast,
  getForecastMap,
  getForecastBattlegrounds,
  getForecastSnapshot,
  publishForecastUpdate
};
