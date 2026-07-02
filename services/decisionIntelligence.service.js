import { pool } from "../db/pool.js";

export async function getDecisionIntelligence(workspaceId = 1) {
  const decisionsResult = await pool.query(
    `
    SELECT *
    FROM executive_decisions
    WHERE workspace_id = $1
    ORDER BY urgency_score DESC, impact_score DESC, created_at DESC
    LIMIT 20
    `,
    [workspaceId]
  );

  const signalsResult = await pool.query(
    `
    SELECT *
    FROM executive_decision_signals
    WHERE workspace_id = $1
    ORDER BY created_at DESC
    LIMIT 30
    `,
    [workspaceId]
  );

  const ids = decisionsResult.rows.map((d) => d.id);

  let options = [];
  let actions = [];

  if (ids.length) {
    const optionsResult = await pool.query(
      `
      SELECT *
      FROM executive_decision_options
      WHERE decision_id = ANY($1::int[])
      ORDER BY decision_id, rank_order ASC
      `,
      [ids]
    );

    const actionsResult = await pool.query(
      `
      SELECT *
      FROM executive_decision_actions
      WHERE decision_id = ANY($1::int[])
      ORDER BY created_at ASC
      `,
      [ids]
    );

    options = optionsResult.rows;
    actions = actionsResult.rows;
  }

  const decisions = decisionsResult.rows.map((decision) => ({
    ...decision,
    options: options.filter((o) => o.decision_id === decision.id),
    actions: actions.filter((a) => a.decision_id === decision.id),
  }));

  const summary = {
    openDecisions: decisions.filter((d) => d.status === "open").length,
    highPriority: decisions.filter((d) => d.priority === "high").length,
    avgConfidence: Math.round(
      decisions.reduce((sum, d) => sum + Number(d.confidence_score || 0), 0) /
        Math.max(decisions.length, 1)
    ),
    avgRisk: Math.round(
      decisions.reduce((sum, d) => sum + Number(d.risk_score || 0), 0) /
        Math.max(decisions.length, 1)
    ),
    liveSignals: signalsResult.rows.length,
  };

  return {
    summary,
    decisions,
    signals: signalsResult.rows,
  };
}

export async function seedDecisionIntelligence(workspaceId = 1) {
  const existing = await pool.query(
    `SELECT id FROM executive_decisions WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.rows.length) return { seeded: false };

  const decisionResult = await pool.query(
    `
    INSERT INTO executive_decisions
    (
      workspace_id,
      title,
      decision_type,
      priority,
      status,
      confidence_score,
      risk_score,
      impact_score,
      urgency_score,
      recommendation,
      rationale,
      source_modules
    )
    VALUES
    (
      $1,
      'Reallocate executive resources toward high-volatility battleground states',
      'resource_allocation',
      'high',
      'open',
      84,
      41,
      92,
      88,
      'Shift field, vendor, and executive review capacity toward states with rising volatility and coalition movement.',
      'Forecast, coalition, influence, and operations signals indicate elevated movement in competitive states.',
      ARRAY['forecast','coalitions','influence','operations']
    )
    RETURNING id
    `,
    [workspaceId]
  );

  const decisionId = decisionResult.rows[0].id;

  await pool.query(
    `
    INSERT INTO executive_decision_options
    (
      decision_id,
      label,
      description,
      projected_impact,
      projected_risk,
      confidence,
      cost_level,
      timeline,
      rank_order
    )
    VALUES
    ($1, 'Aggressive resource shift', 'Move 20-30% of available resources into top volatility states.', 94, 58, 81, 'high', '3-7 days', 1),
    ($1, 'Balanced resource shift', 'Move 10-15% of resources while preserving national coverage.', 86, 39, 84, 'medium', '7-14 days', 2),
    ($1, 'Monitor only', 'Hold current posture and increase executive monitoring cadence.', 61, 22, 72, 'low', 'Immediate', 3)
    `,
    [decisionId]
  );

  await pool.query(
    `
    INSERT INTO executive_decision_actions
    (decision_id, action_label, owner, status, due_window)
    VALUES
    ($1, 'Review battleground allocation model', 'Executive Operations', 'pending', '24 hours'),
    ($1, 'Convert recommendation into Command Center tasks', 'Strategy Desk', 'pending', '48 hours'),
    ($1, 'Validate vendor readiness in priority states', 'Vendor Operations', 'pending', '72 hours')
    `,
    [decisionId]
  );

  await pool.query(
    `
    INSERT INTO executive_decision_signals
    (workspace_id, signal_type, title, description, severity, source_module, state_code)
    VALUES
    ($1, 'forecast_shift', 'Forecast volatility rising', 'Competitive movement detected across battleground modeling.', 'high', 'forecast', 'GA'),
    ($1, 'coalition_movement', 'Coalition instability detected', 'Suburban and turnout-sensitive blocs require executive monitoring.', 'medium', 'coalitions', 'PA'),
    ($1, 'influence_pressure', 'Influence concentration increasing', 'External influence signals are clustering around key voter segments.', 'high', 'influence', 'AZ')
    `,
    [workspaceId]
  );

  return { seeded: true };
}
