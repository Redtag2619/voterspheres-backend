import dotenv from "dotenv";
import crypto from "crypto";
import { buildForecastPackage } from "../analytics/forecast.engine.js";
import { getIntelligenceInputs } from "../repositories/intelligence.repository.js";
import { pool } from "../db/pool.js";
import {
  ensureForecastTables,
  clearForecastRun,
  insertForecastSnapshot,
  insertForecastOverlay
} from "../repositories/forecast.repository.js";

dotenv.config();

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
    }
  }));
}

export async function rebuildForecastSnapshots() {
  await ensureForecastTables();

  const snapshotRunId = crypto.randomUUID();
  const inputs = await getIntelligenceInputs();
  const fundraisingRows = await getLatestFundraisingSnapshots();

  const forecastPack = buildForecastPackage({
    candidateRows: inputs.candidateRows || [],
    fundraisingRows
  });

  await clearForecastRun(snapshotRunId);

  for (const race of forecastPack.races) {
    await insertForecastSnapshot({
      snapshot_run_id: snapshotRunId,
      race_key: race.raceKey,
      state: race.state,
      office: race.office,
      candidate_count: race.candidateCount,
      leader: race.leader,
      runner_up: race.runnerUp,
      total_receipts: race.totalReceipts,
      total_cash: race.totalCash,
      receipts_gap: race.receiptsGap,
      cash_gap: race.cashGap,
      win_probability: race.winProbability,
      confidence: race.confidence,
      rating: race.rating,
      volatility: race.volatility,
      competition_weight: race.competitionWeight,
      finance_weight: race.financeWeight,
      overlay_score: race.overlayScore,
      overlay_tier: race.overlayTier,
      fill: race.fill,
      stroke: race.stroke,
      urgency: race.urgency
    });
  }

  const bestOverlayByState = {};
  for (const overlay of forecastPack.overlays) {
    const current = bestOverlayByState[overlay.state];
    if (!current || overlay.overlayScore > current.overlayScore) {
      bestOverlayByState[overlay.state] = overlay;
    }
  }

  for (const state of Object.keys(bestOverlayByState)) {
    const overlay = bestOverlayByState[state];
    await insertForecastOverlay({
      snapshot_run_id: snapshotRunId,
      state,
      overlay_score: overlay.overlayScore,
      overlay_tier: overlay.overlayTier,
      fill: overlay.fill,
      stroke: overlay.stroke,
      urgency: overlay.urgency,
      finance_weight: overlay.financeWeight,
      competition_weight: overlay.competitionWeight,
      win_probability: overlay.winProbability,
      confidence: overlay.confidence,
      total_receipts: overlay.totalReceipts,
      note: `${state} overlay score ${overlay.overlayScore} from latest published forecast snapshot.`,
      center: getStateCoordinates(state)
    });
  }

  return {
    ok: true,
    snapshot_run_id: snapshotRunId,
    races: forecastPack.races.length,
    overlays: Object.keys(bestOverlayByState).length
  };
}
