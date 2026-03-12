import {
  getLatestForecastRunId,
  getForecastSnapshotsByRun,
  getForecastOverlaysByRun
} from "../repositories/forecast.repository.js";
import { rebuildForecastSnapshots } from "../jobs/forecastRebuild.job.js";

function buildMetrics(races = []) {
  const totalModeledReceipts = races.reduce(
    (sum, race) => sum + Number(race.total_receipts || 0),
    0
  );

  return [
    {
      label: "Tracked Races",
      value: `${races.length}`,
      delta: "Published snapshot",
      tone: "up"
    },
    {
      label: "High Confidence",
      value: `${races.filter((r) => Number(r.confidence || 0) >= 70).length}`,
      delta: "Published model",
      tone: "up"
    },
    {
      label: "Toss-ups",
      value: `${races.filter((r) => r.rating === "Toss-up").length}`,
      delta: "Competitive races",
      tone: "down"
    },
    {
      label: "Modeled Receipts",
      value: `$${(totalModeledReceipts / 1000000).toFixed(1)}M`,
      delta: "Published totals",
      tone: "up"
    }
  ];
}

function mapSnapshotRace(row) {
  return {
    raceKey: row.race_key,
    state: row.state,
    office: row.office,
    candidateCount: Number(row.candidate_count || 0),
    leader: row.leader || {},
    runnerUp: row.runner_up || {},
    totalReceipts: Number(row.total_receipts || 0),
    totalCash: Number(row.total_cash || 0),
    receiptsGap: Number(row.receipts_gap || 0),
    cashGap: Number(row.cash_gap || 0),
    winProbability: Number(row.win_probability || 50),
    confidence: Number(row.confidence || 50),
    rating: row.rating,
    volatility: Number(row.volatility || 50),
    competitionWeight: Number(row.competition_weight || 0),
    financeWeight: Number(row.finance_weight || 0),
    overlayScore: Number(row.overlay_score || 0),
    overlayTier: row.overlay_tier,
    fill: row.fill,
    stroke: row.stroke,
    urgency: row.urgency
  };
}

function mapOverlayRow(row) {
  return {
    name: `${row.state} Battleground`,
    state: row.state,
    center: row.center || [],
    raceRating: row.overlay_tier,
    overlayTier: row.overlay_tier,
    overlayScore: Number(row.overlay_score || 0),
    fill: row.fill,
    stroke: row.stroke,
    risk: row.urgency,
    urgency: row.urgency,
    financeWeight: Number(row.finance_weight || 0),
    competitionWeight: Number(row.competition_weight || 0),
    winProb: Number(row.win_probability || 50),
    confidence: Number(row.confidence || 50),
    funds: `$${(Number(row.total_receipts || 0) / 1000000).toFixed(1)}M`,
    note: row.note
  };
}

export async function triggerForecastRebuild(_req, res, next) {
  try {
    const result = await rebuildForecastSnapshots();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPublishedForecast(_req, res, next) {
  try {
    const runId = await getLatestForecastRunId();

    if (!runId) {
      return res.json({
        snapshot_run_id: null,
        metrics: [],
        races: []
      });
    }

    const races = await getForecastSnapshotsByRun(runId);

    res.json({
      snapshot_run_id: runId,
      metrics: buildMetrics(races),
      races: races.map(mapSnapshotRace)
    });
  } catch (err) {
    next(err);
  }
}

export async function getPublishedOverlays(_req, res, next) {
  try {
    const runId = await getLatestForecastRunId();

    if (!runId) {
      return res.json({
        snapshot_run_id: null,
        metrics: [],
        battlegrounds: []
      });
    }

    const overlays = await getForecastOverlaysByRun(runId);

    res.json({
      snapshot_run_id: runId,
      metrics: [
        {
          label: "Battleground States",
          value: `${overlays.length}`,
          delta: "Published overlays",
          tone: "up"
        },
        {
          label: "Critical Zones",
          value: `${overlays.filter((o) => o.overlay_tier === "critical").length}`,
          delta: "Highest urgency",
          tone: "up"
        }
      ],
      battlegrounds: overlays.map(mapOverlayRow)
    });
  } catch (err) {
    next(err);
  }
}
