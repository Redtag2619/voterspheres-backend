import { pool } from "../db/pool.js";
import { ensurePoliticalSignalsTable } from "./politicalSignalIngestion.service.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

export async function getWorkspaceSignalFeed({ user = {}, workspaceId }) {
  await ensurePoliticalSignalsTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const workspace = await pool.query(
    `
      SELECT *
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [workspaceId, firmId]
  );

  if (!workspace.rows[0]) {
    throw new Error("Workspace not found.");
  }

  const signals = await pool.query(
    `
      SELECT *
      FROM political_signals
      WHERE firm_id = $1
        AND workspace_id = $2
      ORDER BY observed_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 150
    `,
    [firmId, workspaceId]
  );

  const rows = signals.rows || [];

  return {
    workspace: workspace.rows[0],
    summary: {
      total: rows.length,
      critical: rows.filter((s) => s.risk === "Critical").length,
      high: rows.filter((s) => s.risk === "High").length,
      elevated: rows.filter((s) => s.risk === "Elevated").length,
      news: rows.filter((s) => s.signal_type === "news").length,
      fec: rows.filter((s) => ["fec", "fundraising"].includes(s.signal_type)).length,
      average_score: rows.length
        ? Math.round(rows.reduce((sum, s) => sum + Number(s.signal_score || 0), 0) / rows.length)
        : 0,
    },
    signals: rows,
    updated_at: new Date().toISOString(),
  };
}
