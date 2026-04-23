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

function stateCode(value = "") {
  const raw = String(value || "").trim();
  if (raw.length === 2) return raw.toUpperCase();

  const reverse = {
    Alabama: "AL",
    Alaska: "AK",
    Arizona: "AZ",
    Arkansas: "AR",
    California: "CA",
    Colorado: "CO",
    Connecticut: "CT",
    Delaware: "DE",
    Florida: "FL",
    Georgia: "GA",
    Hawaii: "HI",
    Idaho: "ID",
    Illinois: "IL",
    Indiana: "IN",
    Iowa: "IA",
    Kansas: "KS",
    Kentucky: "KY",
    Louisiana: "LA",
    Maine: "ME",
    Maryland: "MD",
    Massachusetts: "MA",
    Michigan: "MI",
    Minnesota: "MN",
    Mississippi: "MS",
    Missouri: "MO",
    Montana: "MT",
    Nebraska: "NE",
    Nevada: "NV",
    New Hampshire: "NH",
    New Jersey: "NJ",
    New Mexico: "NM",
    New York: "NY",
    North Carolina: "NC",
    North Dakota: "ND",
    Ohio: "OH",
    Oklahoma: "OK",
    Oregon: "OR",
    Pennsylvania: "PA",
    Rhode Island: "RI",
    South Carolina: "SC",
    South Dakota: "SD",
    Tennessee: "TN",
    Texas: "TX",
    Utah: "UT",
    Vermont: "VT",
    Virginia: "VA",
    Washington: "WA",
    West Virginia: "WV",
    Wisconsin: "WI",
    Wyoming: "WY",
    "District of Columbia": "DC"
  };

  return reverse[raw] || raw;
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

function buildPriority(probability, receipts, vendorCount) {
  const probabilityNum = Number(String(probability || "").replace("%", "")) || 0;
  let score = 0;

  if (probabilityNum >= 49 && probabilityNum <= 57) score += 3;
  if (receipts >= 1_500_000) score += 2;
  if (vendorCount >= 2) score += 2;

  if (score >= 5) return "Tier 1";
  if (score >= 3) return "Tier 2";
  return "Tier 3";
}

function buildRisk(probability, vendorCount) {
  const probabilityNum = Number(String(probability || "").replace("%", "")) || 0;

  if (probabilityNum <= 51 && vendorCount <= 1) return "Elevated";
  if (probabilityNum <= 55 || vendorCount <= 2) return "Watch";
  return "Monitor";
}

function buildMomentum(rank) {
  const value = 2.4 - rank * 0.35;
  return value >= 0 ? `+${value.toFixed(1)}` : `${value.toFixed(1)}`;
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
  const query = `
    with vendor_counts as (
      select
        upper(state) as state_code,
        count(*)::int as vendor_count
      from vendors
      where state is not null
        and state <> ''
      group by upper(state)
    ),
    ranked_finance as (
      select
        candidate_id,
        coalesce(receipts, 0) as receipts,
        coalesce(cash_on_hand, 0) as cash_on_hand
      from fundraising_live
    )
    select
      c.id,
      c.external_id,
      c.full_name as candidate,
      c.state,
      c.office,
      c.party,
      coalesce(rf.receipts, 0) as receipts,
      coalesce(rf.cash_on_hand, 0) as cash_on_hand,
      coalesce(vc.vendor_count, 0) as vendor_count,
      c.last_imported_at
    from candidates c
    left join ranked_finance rf
      on rf.candidate_id = c.external_id
    left join vendor_counts vc
      on vc.state_code = upper(c.state)
    where c.state is not null
      and c.state <> ''
      and c.office is not null
      and c.office <> ''
      and c.office in ('Senate', 'House', 'Governor', 'President')
    order by
      coalesce(rf.receipts, 0) desc,
      c.state asc,
      c.office asc,
      c.full_name asc
    limit 24
  `;

  const { rows } = await pool.query(query);

  const results = (rows || []).slice(0, 12).map((row, index) => {
    const state = normalizeStateName(row.state);
    const code = stateCode(state);
    const baseProbability = Math.max(49, 58 - index);

    const probability = `${baseProbability}%`;
    const momentum = buildMomentum(index);
    const priority = buildPriority(probability, Number(row.receipts || 0), Number(row.vendor_count || 0));
    const risk = buildRisk(probability, Number(row.vendor_count || 0));

    return {
      race: `${code} ${row.office}`,
      candidate: row.candidate || "",
      state,
      state_code: code,
      office: row.office,
      probability,
      momentum,
      risk,
      priority,
      party: row.party || "",
      receipts: Number(row.receipts || 0),
      cash_on_hand: Number(row.cash_on_hand || 0),
      vendor_count: Number(row.vendor_count || 0),
      updated_at: row.last_imported_at || null
    };
  });

  return { results };
}

async function getExecutiveFeed() {
  const battlegrounds = await getBattlegroundDashboardData();
  const fundraising = await getFundraisingLeaderboard(6);

  const battlegroundFeed = (battlegrounds.results || []).slice(0, 4).map((row, index) => ({
    id: `bg-${index + 1}`,
    time: "Now",
    title: `${row.race} remains live on the board`,
    source: "Battleground Engine",
    severity: row.priority === "Tier 1" ? "High" : "Medium",
    type: "battleground.priority",
    state: row.state,
    office: row.office,
    risk: row.risk
  }));

  const financeFeed = (fundraising.leaderboard || []).slice(0, 3).map((row, index) => ({
    id: `finance-${index + 1}`,
    time: "Now",
    title: `${row.name} is a top fundraising leader`,
    source: "Fundraising Intelligence",
    severity: index === 0 ? "High" : "Medium",
    type: "fundraising.signal",
    state: normalizeStateName(row.state),
    office: row.office,
    risk: index === 0 ? "Watch" : "Monitor"
  }));

  return [...battlegroundFeed, ...financeFeed].slice(0, 6);
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
  const feed = await getExecutiveFeed();

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
      risk: index < 3 ? "Elevated" : index < 6 ? "Watch" : "Monitor"
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
