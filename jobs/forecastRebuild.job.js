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

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOverlayTier(value) {
  if (!value) return "watch";
  const text = String(value).toLowerCase();

  if (["critical", "high", "elevated", "watch"].includes(text)) {
    return text;
  }

  if (text === "likely") return "high";
  if (text === "lean") return "elevated";
  if (text === "toss-up" || text === "tossup") return "critical";
  if (text === "tilt") return "elevated";

  return "watch";
}

function fillFromTier(tier) {
  if (tier === "critical") return "#ef4444";
  if (tier === "high") return "#f59e0b";
  if (tier === "elevated") return "#0ea5e9";
  return "#334155";
}

function strokeFromTier(tier) {
  if (tier === "critical") return "#fecaca";
  if (tier === "high") return "#fde68a";
  if (tier === "elevated") return "#bae6fd";
  return "#94a3b8";
}

function urgencyFromTier(tier) {
  if (tier === "critical") return "Immediate";
  if (tier === "high") return "High";
  if (tier === "elevated") return "Elevated";
  return "Monitor";
}

function deriveOverlayScoreFromRace(race) {
  if (race.overlayScore !== undefined && race.overlayScore !== null) {
    return safeNumber(race.overlayScore, 0);
  }

  const winProbability = safeNumber(race.winProbability, 50);
  const financeWeight = safeNumber(race.financeWeight, 0);
  const competitionWeight = safeNumber(race.competitionWeight, 0);

  const blended = Math.round(
    competitionWeight > 0 || financeWeight > 0
      ? competitionWeight * 0.55 + financeWeight * 0.45
      : 100 - Math.abs(winProbability - 50) * 2
  );

  return Math.max(0, Math.min(100, blended));
}

function deriveOverlayTierFromScore(score) {
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 45) return "elevated";
  return "watch";
}

function buildFallbackOverlaysFromRaces(races = []) {
  return races.map((race) => {
    const overlayScore = deriveOverlayScoreFromRace(race);
    const overlayTier = normalizeOverlayTier(
      race.overlayTier || deriveOverlayTierFromScore(overlayScore)
    );

    return {
      state: race.state,
      overlayScore,
      overlayTier,
      fill: race.fill || fillFromTier(overlayTier),
      stroke: race.stroke || strokeFromTier(overlayTier),
      urgency: race.urgency || urgencyFromTier(overlayTier),
      financeWeight: safeNumber(race.financeWeight, 0),
      competitionWeight: safeNumber(race.competitionWeight, 0),
      winProbability: safeNumber(race.winProbability, 50),
      confidence: safeNumber(race.confidence, 50),
      totalReceipts: safeNumber(race.totalReceipts, 0)
    };
  });
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
      receipts: safeNumber(row.receipts, 0),
      disbursements: safeNumber(row.disbursements, 0),
      cash_on_hand_end_period: safeNumber(row.cash_on_hand, 0),
      debts_owed_by_committee: safeNumber(row.debt, 0),
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

  const races = Array.isArray(forecastPack?.races) ? forecastPack.races : [];
  const overlays = Array.isArray(forecastPack?.overlays)
    ? forecastPack.overlays
    : buildFallbackOverlaysFromRaces(races);

  await clearForecastRun(snapshotRunId);

  for (const race of races) {
    const overlayScore = deriveOverlayScoreFromRace(race);
    const overlayTier = normalizeOverlayTier(
      race.overlayTier || deriveOverlayTierFromScore(overlayScore)
    );

    await insertForecastSnapshot({
      snapshot_run_id: snapshotRunId,
      race_key: race.raceKey,
      state: race.state,
      office: race.office,
      candidate_count: race.candidateCount,
      leader: race.leader,
      runner_up: race.runnerUp,
      total_receipts: safeNumber(race.totalReceipts, 0),
      total_cash: safeNumber(race.totalCash, 0),
      receipts_gap: safeNumber(race.receiptsGap, 0),
      cash_gap: safeNumber(race.cashGap, 0),
      win_probability: safeNumber(race.winProbability, 50),
      confidence: safeNumber(race.confidence, 50),
      rating: race.rating,
      volatility: safeNumber(race.volatility, 50),
      competition_weight: safeNumber(race.competitionWeight, 0),
      finance_weight: safeNumber(race.financeWeight, 0),
      overlay_score: overlayScore,
      overlay_tier: overlayTier,
      fill: race.fill || fillFromTier(overlayTier),
      stroke: race.stroke || strokeFromTier(overlayTier),
      urgency: race.urgency || urgencyFromTier(overlayTier)
    });
  }

  const bestOverlayByState = {};
  for (const overlay of overlays) {
    if (!overlay?.state) continue;

    const current = bestOverlayByState[overlay.state];
    const score = safeNumber(overlay.overlayScore, 0);

    if (!current || score > safeNumber(current.overlayScore, 0)) {
      bestOverlayByState[overlay.state] = overlay;
    }
  }

  for (const state of Object.keys(bestOverlayByState)) {
    const overlay = bestOverlayByState[state];
    const overlayTier = normalizeOverlayTier(
      overlay.overlayTier || deriveOverlayTierFromScore(safeNumber(overlay.overlayScore, 0))
    );

    await insertForecastOverlay({
      snapshot_run_id: snapshotRunId,
      state,
      overlay_score: safeNumber(overlay.overlayScore, 0),
      overlay_tier: overlayTier,
      fill: overlay.fill || fillFromTier(overlayTier),
      stroke: overlay.stroke || strokeFromTier(overlayTier),
      urgency: overlay.urgency || urgencyFromTier(overlayTier),
      finance_weight: safeNumber(overlay.financeWeight, 0),
      competition_weight: safeNumber(overlay.competitionWeight, 0),
      win_probability: safeNumber(overlay.winProbability, 50),
      confidence: safeNumber(overlay.confidence, 50),
      total_receipts: safeNumber(overlay.totalReceipts, 0),
      note:
        overlay.note ||
        `${state} overlay score ${safeNumber(
          overlay.overlayScore,
          0
        )} from latest published forecast snapshot.`,
      center: getStateCoordinates(state)
    });
  }

  return {
    ok: true,
    snapshot_run_id: snapshotRunId,
    races: races.length,
    overlays: Object.keys(bestOverlayByState).length
  };
}
