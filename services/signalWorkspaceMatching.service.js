import { pool } from "../db/pool.js";
import { ensurePoliticalSignalsTable } from "./politicalSignalIngestion.service.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function norm(value = "") {
  return text(value).toLowerCase();
}

function stateNorm(value = "") {
  return text(value).toUpperCase();
}

function tokens(value = "") {
  return norm(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function workspaceKeywords(workspace = {}) {
  return [
    workspace.name,
    workspace.campaign_name,
    workspace.candidate_name,
    workspace.office,
    workspace.state,
    workspace.state_code,
    workspace.district,
    workspace.race_type,
  ]
    .filter(Boolean)
    .flatMap(tokens);
}

function signalKeywords(signal = {}) {
  const metadata = signal.metadata && typeof signal.metadata === "object" ? signal.metadata : {};

  return [
    signal.title,
    signal.summary,
    signal.source,
    signal.signal_type,
    signal.state,
    signal.county,
    metadata.candidate_name,
    metadata.office,
    metadata.race,
  ]
    .filter(Boolean)
    .flatMap(tokens);
}

function scoreMatch(signal = {}, workspace = {}) {
  let score = 0;
  const reasons = [];

  const signalState = stateNorm(signal.state);
  const workspaceState = stateNorm(workspace.state || workspace.state_code);

  if (signalState && workspaceState && signalState === workspaceState) {
    score += 45;
    reasons.push("state_match");
  }

  const signalText = norm(`${signal.title || ""} ${signal.summary || ""}`);
  const workspaceName = norm(workspace.name || workspace.campaign_name || "");
  const candidateName = norm(workspace.candidate_name || "");

  if (workspaceName && signalText.includes(workspaceName)) {
    score += 35;
    reasons.push("workspace_name_match");
  }

  if (candidateName && signalText.includes(candidateName)) {
    score += 40;
    reasons.push("candidate_name_match");
  }

  const wTokens = new Set(workspaceKeywords(workspace));
  const sTokens = new Set(signalKeywords(signal));

  let overlap = 0;
  for (const token of wTokens) {
    if (token.length >= 3 && sTokens.has(token)) overlap += 1;
  }

  if (overlap) {
    score += Math.min(30, overlap * 5);
    reasons.push(`keyword_overlap_${overlap}`);
  }

  if (workspace.office && signalText.includes(norm(workspace.office))) {
    score += 12;
    reasons.push("office_match");
  }

  return {
    score: Math.min(100, score),
    reasons,
  };
}

async function loadWorkspaces({ firmId }) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM workspaces
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    `,
    [firmId]
  );

  return rows || [];
}

async function loadSignals({ firmId, onlyUnmatched = true, limit = 1000 }) {
  await ensurePoliticalSignalsTable();

  const params = [firmId, limit];

  const { rows } = await pool.query(
    `
      SELECT *
      FROM political_signals
      WHERE firm_id = $1
      ${onlyUnmatched ? "AND workspace_id IS NULL" : ""}
      ORDER BY observed_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT $2
    `,
    params
  );

  return rows || [];
}

export async function getSignalWorkspaceMatchingDashboard({ firmId }) {
  await ensurePoliticalSignalsTable();

  const workspaces = await loadWorkspaces({ firmId });

  const counts = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE workspace_id IS NOT NULL)::int AS matched,
        COUNT(*) FILTER (WHERE workspace_id IS NULL)::int AS unmatched,
        COUNT(*) FILTER (WHERE signal_type = 'news')::int AS news,
        COUNT(*) FILTER (WHERE signal_type IN ('fec','fundraising'))::int AS fec
      FROM political_signals
      WHERE firm_id = $1
    `,
    [firmId]
  );

  const recent = await pool.query(
    `
      SELECT
        ps.id,
        ps.title,
        ps.summary,
        ps.signal_type,
        ps.source,
        ps.state,
        ps.risk,
        ps.signal_score,
        ps.workspace_id,
        ps.observed_at,
        w.name AS workspace_name
      FROM political_signals ps
      LEFT JOIN workspaces w ON w.id = ps.workspace_id
      WHERE ps.firm_id = $1
      ORDER BY ps.observed_at DESC NULLS LAST, ps.created_at DESC NULLS LAST
      LIMIT 100
    `,
    [firmId]
  );

  return {
    summary: {
      ...(counts.rows[0] || {}),
      workspaces: workspaces.length,
    },
    workspaces,
    signals: recent.rows || [],
    updated_at: new Date().toISOString(),
  };
}

export async function runSignalWorkspaceMatching({
  firmId,
  onlyUnmatched = true,
  limit = 1000,
  minimumScore = 45,
} = {}) {
  await ensurePoliticalSignalsTable();

  const workspaces = await loadWorkspaces({ firmId });
  const signals = await loadSignals({ firmId, onlyUnmatched, limit });

  let matched = 0;
  let skipped = 0;

  const results = [];

  for (const signal of signals) {
    let best = null;

    for (const workspace of workspaces) {
      const scored = scoreMatch(signal, workspace);

      if (!best || scored.score > best.score) {
        best = {
          workspace,
          score: scored.score,
          reasons: scored.reasons,
        };
      }
    }

    if (!best || best.score < minimumScore) {
      skipped += 1;
      results.push({
        signal_id: signal.id,
        title: signal.title,
        matched: false,
        score: best?.score || 0,
      });
      continue;
    }

    await pool.query(
      `
        UPDATE political_signals
        SET
          workspace_id = $1,
          metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
          updated_at = NOW()
        WHERE id = $3 AND firm_id = $4
      `,
      [
        best.workspace.id,
        JSON.stringify({
          workspace_match: {
            workspace_id: best.workspace.id,
            workspace_name: best.workspace.name,
            score: best.score,
            reasons: best.reasons,
            matched_at: new Date().toISOString(),
          },
        }),
        signal.id,
        firmId,
      ]
    );

    matched += 1;

    results.push({
      signal_id: signal.id,
      title: signal.title,
      matched: true,
      workspace_id: best.workspace.id,
      workspace_name: best.workspace.name,
      score: best.score,
      reasons: best.reasons,
    });
  }

  return {
    ok: true,
    scanned: signals.length,
    matched,
    skipped,
    workspaces: workspaces.length,
    minimum_score: minimumScore,
    results: results.slice(0, 100),
    updated_at: new Date().toISOString(),
  };
}
