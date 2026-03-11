import { pool } from "../db/pool.js";
import { getIntelligenceInputs } from "../repositories/intelligence.repository.js";
import { fetchLiveFundraisingSnapshot } from "../providers/fec.provider.js";
import { buildForecastPackage } from "../analytics/forecast.engine.js";
import { runFundraisingIngestion } from "../jobs/fundraisingIngestion.job.js";

function groupCount(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row?.[key] || "Unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getStateCoordinates(state) {
  const coords = {
    Alabama: [32.3777, -86.3006],
    Alaska: [58.3019, -134.4197],
    Arizona: [33.4484, -112.074],
    Arkansas: [34.7465, -92.2896],
    California: [38.5767, -121.4944],
    Colorado: [39.7392, -104.9903],
    Connecticut: [41.7658, -72.6734],
    Delaware: [39.1582, -75.5244],
    Florida: [30.4383, -84.2807],
    Georgia: [33.749, -84.388],
    Hawaii: [21.3069, -157.8583],
    Idaho: [43.615, -116.2023],
    Illinois: [39.7983, -89.6544],
    Indiana: [39.7684, -86.1581],
    Iowa: [41.5868, -93.625],
    Kansas: [39.0473, -95.6752],
    Kentucky: [38.2009, -84.8733],
    Louisiana: [30.4515, -91.1871],
    Maine: [44.3106, -69.7795],
    Maryland: [38.9784, -76.4922],
    Massachusetts: [42.3601, -71.0589],
    Michigan: [42.7336, -84.5553],
    Minnesota: [44.9537, -93.09],
    Mississippi: [32.2988, -90.1848],
    Missouri: [38.5767, -92.1735],
    Montana: [46.5891, -112.0391],
    Nebraska: [40.8136, -96.7026],
    Nevada: [39.1638, -119.7674],
    "New Hampshire": [43.2081, -71.5376],
    "New Jersey": [40.2171, -74.7429],
    "New Mexico": [35.687, -105.9378],
    "New York": [42.6526, -73.7562],
    "North Carolina": [35.7796, -78.6382],
    "North Dakota": [46.8083, -100.7837],
    Ohio: [39.9612, -82.9988],
    Oklahoma: [35.4676, -97.5164],
    Oregon: [44.9429, -123.0351],
    Pennsylvania: [40.2732, -76.8867],
    "Rhode Island": [41.824, -71.4128],
    "South Carolina": [34.0007, -81.0348],
    "South Dakota": [44.3683, -100.351],
    Tennessee: [36.1627, -86.7816],
    Texas: [30.2672, -97.7431],
    Utah: [40.7608, -111.891],
    Vermont: [44.2601, -72.5754],
    Virginia: [37.5407, -77.436],
    Washington: [47.0379, -122.9007],
    "West Virginia": [38.3498, -81.6326],
    Wisconsin: [43.0731, -89.4012],
    Wyoming: [41.14, -104.8202]
  };

  return coords[state] || [39.8283, -98.5795];
}

async function getLatestFundraisingSnapshots() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fundraising_snapshots (
      id SERIAL PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      candidate_name TEXT,
      state TEXT,
      office TEXT,
      party TEXT,
      cycle INT,
      receipts NUMERIC DEFAULT 0,
      disbursements NUMERIC DEFAULT 0,
      cash_on_hand NUMERIC DEFAULT 0,
      debt NUMERIC DEFAULT 0,
      coverage_start_date DATE,
      coverage_end_date DATE,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const result = await pool.query(`
    SELECT DISTINCT ON (candidate_id)
      candidate_id,
      candidate_name,
      state,
      office,
      party,
      cycle,
      receipts,
      disbursements,
      cash_on_hand,
      debt,
      coverage_start_date,
      coverage_end_date,
      fetched_at
    FROM fundraising_snapshots
    ORDER BY candidate_id, fetched_at DESC
  `);

  return result.rows.map((row) => ({
    candidate_id: row.candidate_id,
    name: row.candidate_name,
    state: row.state,
    office: row.office,
    party: row.party,
    cycle: row.cycle,
    totals: {
      receipts: Number(row.receipts || 0),
      disbursements: Number(row.disbursements || 0),
      cash_on_hand_end_period: Number(row.cash_on_hand || 0),
      debts_owed_by_committee: Number(row.debt || 0),
      coverage_start_date: row.coverage_start_date,
      coverage_end_date: row.coverage_end_date
    },
    fetched_at: row.fetched_at
  }));
}

function buildPoliticalIntelligence({
  candidateRows = [],
  consultantRows = [],
  vendorRows = [],
  stateRows = [],
  officeRows = [],
  partyRows = [],
  fundraisingRows = []
}) {
  const candidateCount = candidateRows.length;
  const consultantCount = consultantRows.length;
  const vendorCount = vendorRows.length;
  const stateCount = stateRows.length;
  const officeCount = officeRows.length;
  const partyCount = partyRows.length;

  const candidatesByState = groupCount(candidateRows, "state_name");
  const topStates = Object.entries(candidatesByState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([state, count], index) => ({
      rank: index + 1,
      state,
      count,
      momentum: `+${Math.max(1, Math.round(count / 2))}.${index}`
    }));

  const forecastPack = buildForecastPackage({
    candidateRows,
    fundraisingRows
  });

  const mapBattlegrounds = topStates.slice(0, 6).map((item, index) => ({
    name: `${item.state} Battleground`,
    state: item.state,
    center: getStateCoordinates(item.state),
    raceRating: index < 2 ? "Lean" : "Toss-up",
    winProb: Math.min(68, 50 + item.count + index),
    momentum: `+${(1.4 + index * 0.5).toFixed(1)}`,
    funds: `$${(item.count * 0.9 + 5).toFixed(1)}M`,
    risk: index < 2 ? "Medium" : "High",
    note: `${item.state} is one of the highest-density political theaters in the platform.`
  }));

  const fundraisingLeaderboard = [...fundraisingRows]
    .sort(
      (a, b) =>
        Number(b?.totals?.receipts || 0) - Number(a?.totals?.receipts || 0)
    )
    .slice(0, 12)
    .map((row, index) => ({
      rank: index + 1,
      candidate_id: row.candidate_id,
      name: row.name,
      state: row.state,
      office: row.office,
      party: row.party,
      receipts: Number(row?.totals?.receipts || 0),
      cash_on_hand: Number(row?.totals?.cash_on_hand_end_period || 0)
    }));

  return {
    summary: {
      trackedCandidates: candidateCount,
      consultantsIndexed: consultantCount,
      vendorsIndexed: vendorCount,
      statesTracked: stateCount,
      officesTracked: officeCount,
      partiesTracked: partyCount,
      liveFundraisingCandidates: fundraisingRows.length
    },
    dashboard: {
      metrics: [
        { label: "Tracked Candidates", value: `${candidateCount}`, delta: `Across ${stateCount} states`, tone: "up" },
        { label: "Consultants Indexed", value: `${consultantCount}`, delta: "Marketplace live", tone: "up" },
        { label: "Vendors Indexed", value: `${vendorCount}`, delta: "Operations supply active", tone: "up" },
        {
          label: "Live Fundraising Rows",
          value: `${fundraisingRows.length}`,
          delta: "FEC-backed",
          tone: "up"
        }
      ],
      alerts: [
        {
          title: "Live fundraising is influencing modeled race strength",
          meta: `${forecastPack.summary.trackedRaces} races currently modeled with fundraising inputs`,
          severity: "High"
        }
      ],
      raceMoves: forecastPack.leaderboard.slice(0, 8).map((row) => ({
        race: `${row.state} ${row.office}`,
        leader: row.leader,
        change: `${row.winProbability}%`,
        status: row.rating
      }))
    },
    forecast: {
      metrics: [
        {
          label: "Tracked Races",
          value: `${forecastPack.summary.trackedRaces}`,
          delta: "Fundraising-weighted",
          tone: "up"
        },
        {
          label: "High Confidence",
          value: `${forecastPack.summary.highConfidenceRaces}`,
          delta: "Modeled",
          tone: "up"
        },
        {
          label: "Toss-ups",
          value: `${forecastPack.summary.tossups}`,
          delta: "Competitive map",
          tone: "down"
        },
        {
          label: "Modeled Receipts",
          value: `$${(forecastPack.summary.totalModeledReceipts / 1000000).toFixed(1)}M`,
          delta: "Live FEC totals",
          tone: "up"
        }
      ],
      races: forecastPack.races
    },
    rankings: {
      metrics: [
        {
          label: "Top Modeled Race",
          value: forecastPack.leaderboard[0]?.leader || "N/A",
          delta: forecastPack.leaderboard[0]?.rating || "N/A",
          tone: "up"
        }
      ],
      campaigns: forecastPack.leaderboard
    },
    map: {
      metrics: [
        { label: "Battleground States", value: `${topStates.length}`, delta: "Live map surface", tone: "up" }
      ],
      battlegrounds: mapBattlegrounds
    },
    fundraising: {
      leaderboard: fundraisingLeaderboard
    }
  };
}

async function getBuiltIntelligence() {
  const inputs = await getIntelligenceInputs();
  const fundraisingRows = await getLatestFundraisingSnapshots();
  return buildPoliticalIntelligence({
    ...inputs,
    fundraisingRows
  });
}

export async function getIntelligenceSummary(_req, res, next) {
  try {
    const intelligence = await getBuiltIntelligence();
    res.json(intelligence.summary);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceDashboard(_req, res, next) {
  try {
    const intelligence = await getBuiltIntelligence();
    res.json(intelligence.dashboard);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceForecast(_req, res, next) {
  try {
    const intelligence = await getBuiltIntelligence();
    res.json(intelligence.forecast);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceRankings(_req, res, next) {
  try {
    const intelligence = await getBuiltIntelligence();
    res.json(intelligence.rankings);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceMap(_req, res, next) {
  try {
    const intelligence = await getBuiltIntelligence();
    res.json(intelligence.map);
  } catch (err) {
    next(err);
  }
}

export async function getLiveFundraising(req, res, next) {
  try {
    const cycle = Number(req.query.cycle || process.env.FEC_CYCLE || 2026);
    const limit = Number(req.query.limit || 20);
    const q = String(req.query.q || "");
    const office = String(req.query.office || "");
    const state = String(req.query.state || "");

    const rows = await fetchLiveFundraisingSnapshot({
      cycle,
      limit,
      q,
      office,
      state
    });

    res.json({
      cycle,
      count: rows.length,
      results: rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getFundraisingLeaderboard(_req, res, next) {
  try {
    const intelligence = await getBuiltIntelligence();
    res.json(intelligence.fundraising);
  } catch (err) {
    next(err);
  }
}

export async function runManualFundraisingIngestion(req, res, next) {
  try {
    const cycle = Number(req.body?.cycle || process.env.FEC_CYCLE || 2026);
    const limit = Number(req.body?.limit || process.env.FEC_INGEST_LIMIT || 25);
    const office = String(req.body?.office || "");
    const state = String(req.body?.state || "");
    const q = String(req.body?.q || "");

    const result = await runFundraisingIngestion({
      cycle,
      limit,
      office,
      state,
      q
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}
