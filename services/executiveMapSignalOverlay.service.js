import { pool } from "../db/pool.js";
import { ensurePoliticalSignalsTable } from "./politicalSignalIngestion.service.js";

function riskFromScore(score = 0) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

export async function getExecutiveMapSignalOverlay({ firmId }) {
  await ensurePoliticalSignalsTable();

  const { rows } = await pool.query(
    `
      SELECT *
      FROM political_signals
      WHERE firm_id = $1
        AND state IS NOT NULL
        AND state <> ''
      ORDER BY observed_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1000
    `,
    [firmId]
  );

  const stateMap = new Map();

  for (const signal of rows) {
    const state = String(signal.state || "").toUpperCase();
    if (!state) continue;

    if (!stateMap.has(state)) {
      stateMap.set(state, {
        state,
        total_signals: 0,
        news_signals: 0,
        fec_signals: 0,
        critical: 0,
        high: 0,
        elevated: 0,
        score_total: 0,
        top_signals: [],
      });
    }

    const item = stateMap.get(state);
    const score = Number(signal.signal_score || 0);
    const risk = signal.risk || riskFromScore(score);
    const type = String(signal.signal_type || "").toLowerCase();

    item.total_signals += 1;
    item.score_total += score;

    if (type === "news") item.news_signals += 1;
    if (type === "fec" || type === "fundraising") item.fec_signals += 1;

    if (risk === "Critical") item.critical += 1;
    if (risk === "High") item.high += 1;
    if (risk === "Elevated") item.elevated += 1;

    if (item.top_signals.length < 5) {
      item.top_signals.push({
        id: signal.id,
        title: signal.title,
        source: signal.source,
        signal_type: signal.signal_type,
        risk,
        score,
        url: signal.url,
        observed_at: signal.observed_at,
      });
    }
  }

  const states = Array.from(stateMap.values()).map((state) => {
    const average_score = state.total_signals
      ? Math.round(state.score_total / state.total_signals)
      : 0;

    return {
      ...state,
      average_score,
      overlay_risk: riskFromScore(
        Math.max(
          average_score,
          state.critical ? 82 : 0,
          state.high ? 65 : 0,
          state.elevated ? 42 : 0
        )
      ),
    };
  });

  const nationalAverage = states.length
    ? Math.round(states.reduce((sum, state) => sum + state.average_score, 0) / states.length)
    : 0;

  return {
    summary: {
      states_with_signals: states.length,
      total_signals: states.reduce((sum, state) => sum + state.total_signals, 0),
      news_signals: states.reduce((sum, state) => sum + state.news_signals, 0),
      fec_signals: states.reduce((sum, state) => sum + state.fec_signals, 0),
      critical_states: states.filter((state) => state.overlay_risk === "Critical").length,
      high_states: states.filter((state) => state.overlay_risk === "High").length,
      national_signal_score: nationalAverage,
      national_signal_risk: riskFromScore(nationalAverage),
    },
    states: states.sort((a, b) => b.average_score - a.average_score),
    updated_at: new Date().toISOString(),
  };
}
