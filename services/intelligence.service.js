import { pool } from "../db/pool.js";
import { getDemoCampaignBundle, isDemoModeEnabled } from "./demo.service.js";

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

async function tableExists(tableName) {
  try {
    const result = await pool.query(
      `
        select exists (
          select 1
          from information_schema.tables
          where table_schema = 'public'
            and table_name = $1
        ) as exists
      `,
      [tableName]
    );

    return Boolean(result.rows?.[0]?.exists);
  } catch {
    return false;
  }
}

export async function getFundraisingLeaderboard(limit = 12) {
  if (isDemoModeEnabled()) {
    const leaderboard = getDemoCampaignBundle().fundraising.leaderboard.slice(0, limit);
    const totalReceipts = leaderboard.reduce((sum, row) => sum + Number(row.receipts || 0), 0);
    const totalCash = leaderboard.reduce((sum, row) => sum + Number(row.cash_on_hand || 0), 0);

    return {
      leaderboard,
      summary: {
        tracked_candidates: leaderboard.length,
        total_receipts: totalReceipts,
        total_cash_on_hand: totalCash,
        average_receipts: leaderboard.length ? Math.round(totalReceipts / leaderboard.length) : 0
      },
      metrics: [
        {
          label: "Tracked Finance Leaders",
          value: String(leaderboard.length),
          delta: "Demo finance layer",
          tone: "up"
        },
        {
          label: "Modeled Receipts",
          value: formatMoneyShort(totalReceipts),
          delta: "Demo total",
          tone: "up"
        },
        {
          label: "Cash On Hand",
          value: formatMoneyShort(totalCash),
          delta: "Reserve strength",
          tone: "up"
        },
        {
          label: "Average Raise",
          value: formatMoneyShort(
            leaderboard.length ? Math.round(totalReceipts / leaderboard.length) : 0
          ),
          delta: "Per leader",
          tone: "up"
        }
      ]
    };
  }

  try {
    const hasLiveTable = await tableExists("fundraising_live");
    if (!hasLiveTable) {
      return getFundraisingLeaderboard(limit);
    }

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
      return getDemoCampaignBundle().fundraising;
    }

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
          delta: "FEC-backed candidates",
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
  } catch {
    return getFundraisingLeaderboard(limit);
  }
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
    }))
  };
}

export async function getIntelligenceSummary() {
  return {
    metrics: [
      { label: "Signals Tracked", value: "24", delta: "Live intelligence", tone: "up" },
      { label: "Forecast States", value: "12", delta: "Modeled map", tone: "up" },
      { label: "Finance Leaders", value: "12", delta: "Leaderboard ready", tone: "up" },
      { label: "Threat Pressure", value: "Elevated", delta: "War Room aware", tone: "down" }
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
    leaderboard: fundraising.leaderboard || []
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
  return {
    metrics: [
      { label: "Tracked Leaders", value: "10", delta: "Ranked races", tone: "up" },
      { label: "Top Probability", value: "61%", delta: "Strongest edge", tone: "up" },
      { label: "Median Probability", value: "53%", delta: "Balanced field", tone: "up" },
      { label: "Volatility", value: "Moderate", delta: "Watch list", tone: "down" }
    ],
    campaigns: []
  };
}

export async function getIntelligenceMap() {
  return {
    summary: {
      trackedStates: 2,
      overlays: 2
    },
    battlegrounds: [
      {
        state: "Georgia",
        office: "Senate",
        overlayScore: 82,
        overlayTier: "critical"
      },
      {
        state: "Pennsylvania",
        office: "Governor",
        overlayScore: 74,
        overlayTier: "watch"
      }
    ]
  };
}
