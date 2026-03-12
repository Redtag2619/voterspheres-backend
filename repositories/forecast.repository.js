import { pool } from "../db/pool.js";

export async function ensureForecastTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forecast_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_run_id TEXT NOT NULL,
      race_key TEXT NOT NULL,
      state TEXT,
      office TEXT,
      candidate_count INT DEFAULT 0,
      leader JSONB DEFAULT '{}'::jsonb,
      runner_up JSONB DEFAULT '{}'::jsonb,
      total_receipts NUMERIC DEFAULT 0,
      total_cash NUMERIC DEFAULT 0,
      receipts_gap NUMERIC DEFAULT 0,
      cash_gap NUMERIC DEFAULT 0,
      win_probability INT DEFAULT 50,
      confidence INT DEFAULT 50,
      rating TEXT,
      volatility INT DEFAULT 50,
      competition_weight INT DEFAULT 0,
      finance_weight INT DEFAULT 0,
      overlay_score INT DEFAULT 0,
      overlay_tier TEXT,
      fill TEXT,
      stroke TEXT,
      urgency TEXT,
      snapshot_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_run_id
    ON forecast_snapshots(snapshot_run_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_snapshot_at
    ON forecast_snapshots(snapshot_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forecast_overlays (
      id SERIAL PRIMARY KEY,
      snapshot_run_id TEXT NOT NULL,
      state TEXT NOT NULL,
      overlay_score INT DEFAULT 0,
      overlay_tier TEXT,
      fill TEXT,
      stroke TEXT,
      urgency TEXT,
      finance_weight INT DEFAULT 0,
      competition_weight INT DEFAULT 0,
      win_probability INT DEFAULT 50,
      confidence INT DEFAULT 50,
      total_receipts NUMERIC DEFAULT 0,
      note TEXT,
      center JSONB DEFAULT '[]'::jsonb,
      snapshot_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_forecast_overlays_run_id
    ON forecast_overlays(snapshot_run_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_forecast_overlays_snapshot_at
    ON forecast_overlays(snapshot_at DESC)
  `);
}

export async function clearForecastRun(snapshotRunId) {
  await pool.query(`DELETE FROM forecast_snapshots WHERE snapshot_run_id = $1`, [
    snapshotRunId
  ]);

  await pool.query(`DELETE FROM forecast_overlays WHERE snapshot_run_id = $1`, [
    snapshotRunId
  ]);
}

export async function insertForecastSnapshot(row) {
  const result = await pool.query(
    `
    INSERT INTO forecast_snapshots (
      snapshot_run_id,
      race_key,
      state,
      office,
      candidate_count,
      leader,
      runner_up,
      total_receipts,
      total_cash,
      receipts_gap,
      cash_gap,
      win_probability,
      confidence,
      rating,
      volatility,
      competition_weight,
      finance_weight,
      overlay_score,
      overlay_tier,
      fill,
      stroke,
      urgency,
      snapshot_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW()
    )
    RETURNING *
    `,
    [
      row.snapshot_run_id,
      row.race_key,
      row.state || null,
      row.office || null,
      Number(row.candidate_count || 0),
      JSON.stringify(row.leader || {}),
      JSON.stringify(row.runner_up || {}),
      Number(row.total_receipts || 0),
      Number(row.total_cash || 0),
      Number(row.receipts_gap || 0),
      Number(row.cash_gap || 0),
      Number(row.win_probability || 50),
      Number(row.confidence || 50),
      row.rating || null,
      Number(row.volatility || 50),
      Number(row.competition_weight || 0),
      Number(row.finance_weight || 0),
      Number(row.overlay_score || 0),
      row.overlay_tier || null,
      row.fill || null,
      row.stroke || null,
      row.urgency || null
    ]
  );

  return result.rows[0];
}

export async function insertForecastOverlay(row) {
  const result = await pool.query(
    `
    INSERT INTO forecast_overlays (
      snapshot_run_id,
      state,
      overlay_score,
      overlay_tier,
      fill,
      stroke,
      urgency,
      finance_weight,
      competition_weight,
      win_probability,
      confidence,
      total_receipts,
      note,
      center,
      snapshot_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW()
    )
    RETURNING *
    `,
    [
      row.snapshot_run_id,
      row.state,
      Number(row.overlay_score || 0),
      row.overlay_tier || null,
      row.fill || null,
      row.stroke || null,
      row.urgency || null,
      Number(row.finance_weight || 0),
      Number(row.competition_weight || 0),
      Number(row.win_probability || 50),
      Number(row.confidence || 50),
      Number(row.total_receipts || 0),
      row.note || null,
      JSON.stringify(row.center || [])
    ]
  );

  return result.rows[0];
}

export async function getLatestForecastRunId() {
  const result = await pool.query(`
    SELECT snapshot_run_id
    FROM forecast_snapshots
    ORDER BY snapshot_at DESC
    LIMIT 1
  `);

  return result.rows[0]?.snapshot_run_id || null;
}

export async function getForecastSnapshotsByRun(snapshotRunId) {
  const result = await pool.query(
    `
    SELECT *
    FROM forecast_snapshots
    WHERE snapshot_run_id = $1
    ORDER BY overlay_score DESC, win_probability DESC
    `,
    [snapshotRunId]
  );

  return result.rows;
}

export async function getForecastOverlaysByRun(snapshotRunId) {
  const result = await pool.query(
    `
    SELECT *
    FROM forecast_overlays
    WHERE snapshot_run_id = $1
    ORDER BY overlay_score DESC, state ASC
    `,
    [snapshotRunId]
  );

  return result.rows;
}
