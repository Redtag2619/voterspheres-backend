import { pool } from "../db/pool.js";
import { getDemoCampaignBundle, isDemoModeEnabled } from "./demo.service.js";
import { ensureFundraisingLiveTable } from "./fec.service.js"; 

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoneyShort(value) {
  const num = toNumber(value, 0);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toLocaleString()}`;
}

function buildLeaderboardResponse(leaderboard, deltaLabel = "FEC-backed candidates") {
  const totalReceipts = leaderboard.reduce((sum, row) => sum + toNumber(row.receipts), 0);
  const totalCash = leaderboard.reduce((sum, row) => sum + toNumber(row.cash_on_hand), 0);
  const averageReceipts = leaderboard.length ? Math.round(totalReceipts / leaderboard.length) : 0;

  return {
    leaderboard,
    summary: {
      tracked_candidates: leaderboard.length,
      total_receipts: totalReceipts,
      total_cash_on_hand: totalCash,
      average_receipts: averageReceipts
    },
    metrics: [
      {
        label: "Tracked Finance Leaders",
        value: String(leaderboard.length),
        delta: deltaLabel,
        tone: "up"
      },
      {
        label: "Modeled Receipts",
        value: formatMoneyShort(totalReceipts),
        delta: "Leaderboard total",
        tone: "up"
      },
      {
        label: "Average Raise",
        value: formatMoneyShort(averageReceipts),
        delta: "Across leaders",
        tone: "up"
      },
      {
        label: "Cash On Hand",
        value: formatMoneyShort(totalCash),
        delta: "Competitive reserves",
        tone: "up"
      }
    ]
  };
}

function buildEmptyLeaderboardResponse(lastSyncedAt = null) {
  return {
    leaderboard: [],
    summary: {
      tracked_candidates: 0,
      total_receipts: 0,
      total_cash_on_hand: 0,
      average_receipts: 0,
      last_synced_at: lastSyncedAt
    },
    metrics: [
      {
        label: "Tracked Finance Leaders",
        value: "0",
        delta: "No live rows loaded",
        tone: "down"
      },
      {
        label: "Modeled Receipts",
        value: "$0",
        delta: "No live rows loaded",
        tone: "down"
      },
      {
        label: "Average Raise",
        value: "$0",
        delta: "No live rows loaded",
        tone: "down"
      },
      {
        label: "Cash On Hand",
        value: "$0",
        delta: "No live rows loaded",
        tone: "down"
      }
    ]
  };
}

function getOverlayTier(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "elevated";
  if (score >= 40) return "watch";
  return "monitor";
}

export async function getFundraisingLeaderboard(limit = 12) {
  await ensureFundraisingLiveTable();

  const latestSyncResult = await pool.query(`
    select max(source_updated_at) as last_synced_at
    from fundraising_live
  `);

  const lastSyncedAt = latestSyncResult.rows?.[0]?.last_synced_at || null;

  const result = await pool.query(
    `
      with ranked as (
        select
          row_number() over (
            order by
              coalesce(receipts, 0) desc,
              coalesce(cash_on_hand, 0) desc,
              coalesce(name, '') asc
          ) as rank,
          candidate_id,
          name,
          state,
          office,
          party,
          coalesce(receipts, 0) as receipts,
          coalesce(cash_on_hand, 0) as cash_on_hand
        from fundraising_live
      )
      select *
      from ranked
      order by rank asc
      limit $1
    `,
    [limit]
  );

  const leaderboard = result.rows || [];

  if (!leaderboard.length) {
    return buildEmptyLeaderboardResponse(lastSyncedAt);
  }

  const response = buildLeaderboardResponse(leaderboard, "FEC-backed candidates");

  return {
    ...response,
    summary: {
      ...response.summary,
      last_synced_at: lastSyncedAt
    }
  };
}

export async function getLiveFundraising(limit = 12) {
  const leaderboard = await getFundraisingLeaderboard(limit);

  return {
    results: (leaderboard.leaderboard || []).map((row) => ({
      candidate_id: row.candidate_id,
      name: row.name,
      state: row.state,
      office: row.office,
      party: row.party,
      totals: {
        receipts: Number(row.receipts || 0),
        cash_on_hand_end_period: Number(row.cash_on_hand || 0)
      }
    })),
    summary: leaderboard.summary || {}
  };
}

export async function getIntelligenceSummary() {
  const fundraising = await getFundraisingLeaderboard(12);

  return {
    metrics: [
      {
        label: "Signals Tracked",
        value: "24",
        delta: "Live intelligence",
        tone: "up"
      },
      {
        label: "Forecast States",
        value: "12",
        delta: "Modeled map",
        tone: "up"
      },
      {
        label: "Finance Leaders",
        value: String(fundraising.summary?.tracked_candidates || 0),
        delta: "Live fundraising table",
        tone: "up"
      },
      {
        label: "Threat Pressure",
        value: "Elevated",
        delta: "War Room aware",
        tone: "down"
      }
    ]
  };
}

export async function getIntelligenceDashboard() {
  const fundraising = await getFundraisingLeaderboard(8);

  return {
    metrics: [
      {
        label: "Fundraising Leaders",
        value: String(fundraising.summary?.tracked_candidates || 0),
        delta: "Dashboard finance layer",
        tone: "up"
      },
      {
        label: "Receipts Modeled",
        value: formatMoneyShort(fundraising.summary?.total_receipts || 0),
        delta: "Top candidates",
        tone: "up"
      },
      {
        label: "Cash On Hand",
        value: formatMoneyShort(fundraising.summary?.total_cash_on_hand || 0),
        delta: "Reserve strength",
        tone: "up"
      },
      {
        label: "Average Raise",
        value: formatMoneyShort(fundraising.summary?.average_receipts || 0),
        delta: "Per leader",
        tone: "up"
      }
    ],
    leaderboard: fundraising.leaderboard || [],
    fundraisingSummary: fundraising.summary || {}
  };
}

export async function getIntelligenceForecast() {
  if (isDemoModeEnabled()) {
    return getDemoCampaignBundle().forecast;
  }

  return {
    metrics: [
      { label: "Tracked Races", value: "10", delta: "Forecasted", tone: "up" },
      { label: "High Confidence", value: "4", delta: "Stable map", tone: "up" },
      { label: "Toss-ups", value: "3", delta: "Competitive", tone: "down" },
      { label: "Battlegrounds", value: "6", delta: "Priority zones", tone: "up" }
    ],
    races: []
  };
}

export async function getIntelligenceRankings() {
  const fundraising = await getFundraisingLeaderboard(10);

  return {
    metrics: [
      {
        label: "Tracked Leaders",
        value: String(fundraising.summary?.tracked_candidates || 0),
        delta: "Ranked finance field",
        tone: "up"
      },
      {
        label: "Top Raise",
        value: formatMoneyShort(fundraising.summary?.total_receipts || 0),
        delta: "Aggregate receipts",
        tone: "up"
      },
      {
        label: "Median Signal",
        value: "53%",
        delta: "Balanced field",
        tone: "up"
      },
      {
        label: "Volatility",
        value: "Moderate",
        delta: "Watch list",
        tone: "down"
      }
    ],
    campaigns: fundraising.leaderboard || []
  };
}

export async function getIntelligenceMap() {
  await ensureFundraisingLiveTable();

  const latestSyncResult = await pool.query(`
    select max(source_updated_at) as last_synced_at
    from fundraising_live
  `);

  const lastSyncedAt = latestSyncResult.rows?.[0]?.last_synced_at || null;

  const result = await pool.query(`
    with ranked as (
      select
        candidate_id,
        name,
        state,
        office,
        party,
        coalesce(receipts, 0) as receipts,
        coalesce(cash_on_hand, 0) as cash_on_hand,
        row_number() over (
          partition by state, office
          order by
            coalesce(receipts, 0) desc,
            coalesce(cash_on_hand, 0) desc,
            coalesce(name, '') asc
        ) as state_office_rank
      from fundraising_live
      where state is not null
        and state <> ''
        and office is not null
        and office <> ''
    )
    select *
    from ranked
    order by state asc, office asc, state_office_rank asc
  `);

  const rows = result.rows || [];
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.state}__${row.office}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        state: row.state,
        office: row.office,
        candidates: [],
        totalReceipts: 0,
        totalCash: 0
      });
    }

    const entry = grouped.get(key);

    entry.candidates.push({
      candidate_id: row.candidate_id,
      name: row.name,
      party: row.party || "N/A",
      receipts: Number(row.receipts || 0),
      cash_on_hand: Number(row.cash_on_hand || 0),
      rank: Number(row.state_office_rank || 0)
    });

    entry.totalReceipts += Number(row.receipts || 0);
    entry.totalCash += Number(row.cash_on_hand || 0);
  }

  const battlegrounds = Array.from(grouped.values())
    .map((entry) => {
      const overlayScore = Math.min(
        100,
        Math.round((entry.totalReceipts / 1_000_000) * 3 + (entry.candidates.length * 8))
      );

      return {
        state: entry.state,
        office: entry.office,
        overlayScore,
        overlayTier: getOverlayTier(overlayScore),
        candidates: entry.candidates.slice(0, 5),
        totalReceipts: entry.totalReceipts,
        totalCashOnHand: entry.totalCash
      };
    })
    .sort((a, b) => b.overlayScore - a.overlayScore);

  const trackedStates = new Set(battlegrounds.map((item) => item.state)).size;

  return {
    summary: {
      trackedStates,
      overlays: battlegrounds.length,
      last_synced_at: lastSyncedAt
    },
    battlegrounds
  };
}
