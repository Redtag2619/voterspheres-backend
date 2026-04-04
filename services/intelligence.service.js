import { pool } from "../db/pool.js";

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
}

function fallbackFundraisingLeaderboard() {
  return {
    leaderboard: [
      {
        rank: 1,
        candidate_id: 101,
        name: "Jane Thompson",
        state: "Georgia",
        office: "Senate",
        party: "Democratic",
        receipts: 12850000,
        cash_on_hand: 6100000
      },
      {
        rank: 2,
        candidate_id: 102,
        name: "Robert Gaines",
        state: "Pennsylvania",
        office: "Governor",
        party: "Republican",
        receipts: 11120000,
        cash_on_hand: 5400000
      },
      {
        rank: 3,
        candidate_id: 103,
        name: "Maria Ellis",
        state: "Arizona",
        office: "Senate",
        party: "Democratic",
        receipts: 9875000,
        cash_on_hand: 4200000
      },
      {
        rank: 4,
        candidate_id: 104,
        name: "Daniel Brooks",
        state: "Michigan",
        office: "House",
        party: "Republican",
        receipts: 8420000,
        cash_on_hand: 3150000
      }
    ],
    summary: {
      tracked_candidates: 4,
      total_receipts: 41165000,
      total_cash_on_hand: 18850000,
      average_receipts: 10291250
    },
    metrics: [
      {
        label: "Tracked Finance Leaders",
        value: "4",
        delta: "FEC-backed candidates",
        tone: "up"
      },
      {
        label: "Modeled Receipts",
        value: "$41.2M",
        delta: "Leaderboard total",
        tone: "up"
      },
      {
        label: "Average Raise",
        value: "$10.3M",
        delta: "Across leaders",
        tone: "up"
      },
      {
        label: "Cash On Hand",
        value: "$18.9M",
        delta: "Competitive reserves",
        tone: "up"
      }
    ]
  };
}

export async function getFundraisingLeaderboard(limit = 12) {
  try {
    const hasLiveTable = await tableExists("fundraising_live");

    if (!hasLiveTable) {
      return fallbackFundraisingLeaderboard();
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
      return fallbackFundraisingLeaderboard();
    }

    const totalReceipts = leaderboard.reduce(
      (sum, row) => sum + toNumber(row.receipts),
      0
    );

    const totalCash = leaderboard.reduce(
      (sum, row) => sum + toNumber(row.cash_on_hand),
      0
    );

    const averageReceipts =
      leaderboard.length > 0 ? Math.round(totalReceipts / leaderboard.length) : 0;

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
  } catch (error) {
    console.error("getFundraisingLeaderboard error:", error);
    return fallbackFundraisingLeaderboard();
  }
}

export async function getLiveFundraising(limit = 12) {
  try {
    const hasLiveTable = await tableExists("fundraising_live");

    if (!hasLiveTable) {
      const fallback = fallbackFundraisingLeaderboard().leaderboard.map((row) => ({
        candidate_id: row.candidate_id,
        name: row.name,
        state: row.state,
        office: row.office,
        party: row.party,
        totals: {
          receipts: row.receipts,
          cash_on_hand_end_period: row.cash_on_hand
        }
      }));

      return {
        results: fallback.slice(0, limit)
      };
    }

    const result = await pool.query(
      `
        select
          candidate_id,
          name,
          state,
          office,
          party,
          coalesce(receipts, 0) as receipts,
          coalesce(cash_on_hand, 0) as cash_on_hand
        from fundraising_live
        order by coalesce(receipts, 0) desc, coalesce(cash_on_hand, 0) desc
        limit $1
      `,
      [limit]
    );

    return {
      results: (result.rows || []).map((row) => ({
        candidate_id: row.candidate_id,
        name: row.name,
        state: row.state,
        office: row.office,
        party: row.party,
        totals: {
          receipts: toNumber(row.receipts),
          cash_on_hand_end_period: toNumber(row.cash_on_hand)
        }
      }))
    };
  } catch (error) {
    console.error("getLiveFundraising error:", error);

    const fallback = fallbackFundraisingLeaderboard().leaderboard.map((row) => ({
      candidate_id: row.candidate_id,
      name: row.name,
      state: row.state,
      office: row.office,
      party: row.party,
      totals: {
        receipts: row.receipts,
        cash_on_hand_end_period: row.cash_on_hand
      }
    }));

    return {
      results: fallback.slice(0, limit)
    };
  }
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
        value: String(fundraising.summary.tracked_candidates || 0),
        delta: "Dashboard finance layer",
        tone: "up"
      },
      {
        label: "Receipts Modeled",
        value: formatMoneyShort(fundraising.summary.total_receipts || 0),
        delta: "Top candidates",
        tone: "up"
      },
      {
        label: "Cash On Hand",
        value: formatMoneyShort(fundraising.summary.total_cash_on_hand || 0),
        delta: "Reserve strength",
        tone: "up"
      },
      {
        label: "Average Raise",
        value: formatMoneyShort(fundraising.summary.average_receipts || 0),
        delta: "Per leader",
        tone: "up"
      }
    ],
    leaderboard: fundraising.leaderboard
  };
}

export async function getIntelligenceForecast() {
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
