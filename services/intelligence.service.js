import { pool } from "../db/pool.js";
import { getDemoCampaignBundle, isDemoModeEnabled } from "./demo.service.js";
import { ensureFundraisingLiveTable } from "./fec.service.js";
import {
  getBattlegroundSignalRows,
  getExecutiveFeedEvents,
  runLiveIntelligenceRefresh
} from "./intelligenceRefresh.service.js";

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

function getOverlayTier(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "elevated";
  if (score >= 40) return "watch";
  return "monitor";
}

function normalizeStateName(value = "") {
  const raw = String(value || "").trim().toUpperCase();
  const map = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    DC: "District of Columbia"
  };

  return map[raw] || value || "";
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
  const totalReceipts = leaderboard.reduce((sum, row) => sum + toNumber(row.receipts), 0);
  const totalCash = leaderboard.reduce((sum, row) => sum + toNumber(row.cash_on_hand), 0);
  const averageReceipts = leaderboard.length ? Math.round(totalReceipts / leaderboard.length) : 0;

  return {
    leaderboard,
    summary: {
      tracked_candidates: leaderboard.length,
      total_receipts: totalReceipts,
      total_cash_on_hand: totalCash,
      average_receipts: averageReceipts,
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

export async function getCandidateIntelligenceSummary(filters = {}) {
  const params = [];
  const where = [];

  if (filters.state) {
    params.push(filters.state);
    where.push(`c.state = $${params.length}`);
  }

  if (filters.office) {
    params.push(filters.office);
    where.push(`c.office = $${params.length}`);
  }

  if (filters.party) {
    params.push(filters.party);
    where.push(`c.party = $${params.length}`);
  }

  if (filters.q) {
    params.push(filters.q);
    where.push(`(
      coalesce(c.full_name, '') ilike '%' || $${params.length} || '%'
      or coalesce(c.first_name, '') ilike '%' || $${params.length} || '%'
      or coalesce(c.last_name, '') ilike '%' || $${params.length} || '%'
      or coalesce(c.campaign_committee_name, '') ilike '%' || $${params.length} || '%'
    )`);
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const query = `
    select
      c.id,
      c.external_id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.state,
      c.office,
      c.district,
      c.party,
      c.website,
      c.campaign_committee_id,
      c.campaign_committee_name,
      c.election_year,
      c.status,
      c.source,
      c.last_imported_at,
      f.receipts,
      f.cash_on_hand
    from candidates c
    left join fundraising_live f
      on f.candidate_id = c.external_id
    ${whereSql}
    order by
      coalesce(f.receipts, 0) desc,
      c.state asc,
      c.office asc,
      c.full_name asc
    limit 500
  `;

  const { rows } = await pool.query(query, params);

  return {
    summary: {
      total: rows.length,
      withWebsite: rows.filter((r) => r.website).length,
      withCommittee: rows.filter((r) => r.campaign_committee_id || r.campaign_committee_name).length,
      withFundraising: rows.filter((r) => Number(r.receipts || 0) > 0).length,
      statesTracked: new Set(rows.map((r) => r.state).filter(Boolean)).size
    },
    results: rows
  };
}

export async function getBattlegroundDashboardData() {
  const results = await getBattlegroundSignalRows(12);
  return { results };
}

export async function getIntelligenceSummary() {
  const fundraising = await getFundraisingLeaderboard(12);
  const battlegrounds = await getBattlegroundDashboardData();

  return {
    metrics: [
      {
        label: "Signals Tracked",
        value: String((battlegrounds.results || []).length),
        delta: "Live candidate intelligence",
        tone: "up"
      },
      {
        label: "Forecast States",
        value: String(new Set((battlegrounds.results || []).map((row) => row.state)).size),
        delta: "Battleground map",
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
        value: (battlegrounds.results || []).some((row) => row.risk === "Elevated") ? "Elevated" : "Watch",
        delta: "Live race pressure",
        tone: "down"
      }
    ]
  };
}

export async function getIntelligenceDashboard() {
  if (isDemoModeEnabled()) {
    return getDemoCampaignBundle().dashboard || {};
  }

  const fundraising = await getFundraisingLeaderboard(8);
  const battlegrounds = await getBattlegroundDashboardData();

  let feed = await getExecutiveFeedEvents(6);

  if (!feed.length) {
    await runLiveIntelligenceRefresh();
    feed = await getExecutiveFeedEvents(6);
  }

  const vendorsResult = await pool.query(`
    select
      id,
      vendor_name,
      category,
      status,
      state,
      website,
      email,
      phone,
      services,
      coalesce(last_imported_at, updated_at, created_at) as updated_at
    from vendors
    order by
      coalesce(last_imported_at, updated_at, created_at) desc,
      vendor_name asc
    limit 8
  `);

  const vendors = (vendorsResult.rows || []).map((row, index) => ({
    ...row,
    office: (battlegrounds.results || [])[index % Math.max((battlegrounds.results || []).length, 1)]?.office || "Senate",
    contract_value: 50000 + index * 25000,
    risk: index < 2 ? "Elevated" : index < 5 ? "Watch" : "Monitor"
  }));

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
    feed,
    battlegrounds: battlegrounds.results || [],
    leaderboard: (fundraising.leaderboard || []).map((row, index) => ({
      ...row,
      risk: index < 3 ? "Elevated" : index < 6 ? "Watch" : "Monitor",
      state: normalizeStateName(row.state)
    })),
    vendors,
    fundraisingSummary: fundraising.summary || {}
  };
}

export async function getIntelligenceForecast() {
  if (isDemoModeEnabled()) {
    return getDemoCampaignBundle().forecast;
  }

  const battlegrounds = await getBattlegroundDashboardData();

  return {
    metrics: [
      { label: "Tracked Races", value: String((battlegrounds.results || []).length), delta: "Forecasted", tone: "up" },
      {
        label: "High Confidence",
        value: String((battlegrounds.results || []).filter((row) => Number(String(row.probability).replace("%", "")) >= 55).length),
        delta: "Stable map",
        tone: "up"
      },
      {
        label: "Toss-ups",
        value: String((battlegrounds.results || []).filter((row) => {
          const p = Number(String(row.probability).replace("%", ""));
          return p >= 49 && p <= 53;
        }).length),
        delta: "Competitive",
        tone: "down"
      },
      {
        label: "Battlegrounds",
        value: String(new Set((battlegrounds.results || []).map((row) => row.state)).size),
        delta: "Priority zones",
        tone: "up"
      }
    ],
    races: battlegrounds.results || []
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
  const battlegrounds = await getBattlegroundDashboardData();

  const overlays = (battlegrounds.results || []).map((entry) => {
    const overlayScore = Math.min(
      100,
      Math.round((entry.receipts / 1_000_000) * 3 + (entry.vendor_count * 8))
    );

    return {
      state: entry.state,
      office: entry.office,
      overlayScore,
      overlayTier: getOverlayTier(overlayScore),
      candidates: [
        {
          candidate_id: entry.external_id,
          name: entry.candidate,
          party: entry.party || "N/A",
          receipts: Number(entry.receipts || 0),
          cash_on_hand: Number(entry.cash_on_hand || 0),
          rank: 1
        }
      ],
      totalReceipts: Number(entry.receipts || 0),
      totalCashOnHand: Number(entry.cash_on_hand || 0)
    };
  });

  return {
    summary: {
      trackedStates: new Set(overlays.map((item) => item.state)).size,
      overlays: overlays.length,
      last_synced_at: lastSyncedAt
    },
    battlegrounds: overlays
  };
}
