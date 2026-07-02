import { pool } from "../db/pool.js";

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizePriority(value = "medium") {
  const next = String(value || "medium").toLowerCase();
  if (["critical", "high", "medium", "low"].includes(next)) return next;
  return "medium";
}

export async function ensureDecisionIntelligenceSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_decisions (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      decision_type TEXT NOT NULL DEFAULT 'strategic',
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      confidence_score NUMERIC NOT NULL DEFAULT 72,
      risk_score NUMERIC NOT NULL DEFAULT 38,
      impact_score NUMERIC NOT NULL DEFAULT 81,
      urgency_score NUMERIC NOT NULL DEFAULT 64,
      recommendation TEXT,
      rationale TEXT,
      source_modules TEXT[] DEFAULT ARRAY[]::TEXT[],
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_decision_options (
      id SERIAL PRIMARY KEY,
      decision_id INTEGER REFERENCES executive_decisions(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      description TEXT,
      projected_impact NUMERIC DEFAULT 70,
      projected_risk NUMERIC DEFAULT 35,
      confidence NUMERIC DEFAULT 75,
      cost_level TEXT DEFAULT 'medium',
      timeline TEXT DEFAULT '7-14 days',
      rank_order INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_decision_signals (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      signal_type TEXT NOT NULL DEFAULT 'signal',
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT DEFAULT 'medium',
      source_module TEXT,
      state_code TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_decision_actions (
      id SERIAL PRIMARY KEY,
      decision_id INTEGER REFERENCES executive_decisions(id) ON DELETE CASCADE,
      action_label TEXT NOT NULL,
      owner TEXT DEFAULT 'Executive Team',
      status TEXT DEFAULT 'pending',
      due_window TEXT DEFAULT '72 hours',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_decisions_workspace ON executive_decisions(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_decisions_priority ON executive_decisions(priority);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_decision_signals_workspace ON executive_decision_signals(workspace_id);`);
}

function fallbackData(workspaceId = 1) {
  return {
    summary: {
      openDecisions: 3,
      highPriority: 2,
      avgConfidence: 86,
      avgRisk: 31,
      liveSignals: 3,
    },
    decisions: [
      {
        id: "server-fallback-1",
        workspace_id: workspaceId,
        title: "Reallocate resources toward high-volatility battleground states",
        decision_type: "resource_allocation",
        priority: "high",
        status: "open",
        confidence_score: 91,
        risk_score: 34,
        impact_score: 88,
        urgency_score: 86,
        recommendation: "Shift field, vendor, and executive review capacity toward highest-volatility states.",
        rationale: "Signals from forecast, coalition, influence, and operations indicate rising pressure.",
        source_modules: ["forecast", "coalitions", "influence", "operations"],
        options: [],
        actions: [],
      },
    ],
    signals: [
      {
        id: "server-fallback-signal-1",
        workspace_id: workspaceId,
        signal_type: "forecast_shift",
        title: "Forecast volatility rising",
        description: "Competitive movement detected across battleground modeling.",
        severity: "high",
        source_module: "forecast",
        state_code: "GA",
      },
    ],
  };
}

export async function getDecisionIntelligence(workspaceId = 1) {
  try {
    await ensureDecisionIntelligenceSchema(pool);

    const decisionsResult = await pool.query(
      `
      SELECT *
      FROM executive_decisions
      WHERE workspace_id = $1
      ORDER BY urgency_score DESC, impact_score DESC, confidence_score DESC, created_at DESC
      LIMIT 30
      `,
      [workspaceId]
    );

    if (!decisionsResult.rows.length) {
      await seedDecisionIntelligence(workspaceId);
      return getDecisionIntelligence(workspaceId);
    }

    const ids = decisionsResult.rows.map((decision) => decision.id);

    const [optionsResult, actionsResult, signalsResult] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM executive_decision_options
        WHERE decision_id = ANY($1::int[])
        ORDER BY decision_id, rank_order ASC, id ASC
        `,
        [ids]
      ),
      pool.query(
        `
        SELECT *
        FROM executive_decision_actions
        WHERE decision_id = ANY($1::int[])
        ORDER BY decision_id, created_at ASC
        `,
        [ids]
      ),
      pool.query(
        `
        SELECT *
        FROM executive_decision_signals
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 40
        `,
        [workspaceId]
      ),
    ]);

    const decisions = decisionsResult.rows.map((decision) => ({
      ...decision,
      priority: normalizePriority(decision.priority),
      confidence_score: Math.round(n(decision.confidence_score)),
      risk_score: Math.round(n(decision.risk_score)),
      impact_score: Math.round(n(decision.impact_score)),
      urgency_score: Math.round(n(decision.urgency_score)),
      options: optionsResult.rows
        .filter((option) => Number(option.decision_id) === Number(decision.id))
        .map((option) => ({
          ...option,
          projected_impact: Math.round(n(option.projected_impact)),
          projected_risk: Math.round(n(option.projected_risk)),
          confidence: Math.round(n(option.confidence)),
        })),
      actions: actionsResult.rows.filter((action) => Number(action.decision_id) === Number(decision.id)),
    }));

    const summary = {
      openDecisions: decisions.filter((decision) => String(decision.status || "").toLowerCase() !== "completed").length,
      highPriority: decisions.filter((decision) => ["critical", "high"].includes(String(decision.priority || "").toLowerCase())).length,
      avgConfidence: Math.round(
        decisions.reduce((sum, decision) => sum + n(decision.confidence_score), 0) / Math.max(decisions.length, 1)
      ),
      avgRisk: Math.round(
        decisions.reduce((sum, decision) => sum + n(decision.risk_score), 0) / Math.max(decisions.length, 1)
      ),
      liveSignals: signalsResult.rows.length,
    };

    return {
      summary,
      decisions,
      signals: signalsResult.rows,
    };
  } catch (error) {
    console.error("[Decision Intelligence] service fallback:", error);
    return fallbackData(workspaceId);
  }
}

export async function seedDecisionIntelligence(workspaceId = 1) {
  await ensureDecisionIntelligenceSchema(pool);

  const existing = await pool.query(
    `SELECT id FROM executive_decisions WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.rows.length) {
    return { seeded: false, reason: "existing-data" };
  }

  const created = await pool.query(
    `
    INSERT INTO executive_decisions
    (workspace_id, title, decision_type, priority, status, confidence_score, risk_score, impact_score, urgency_score, recommendation, rationale, source_modules)
    VALUES
    ($1, 'Reallocate resources toward high-volatility battleground states', 'resource_allocation', 'high', 'open', 91, 34, 88, 86,
     'Shift field, vendor, and executive review capacity toward highest-volatility states while preserving national monitoring coverage.',
     'Forecast, coalition, influence, and operations indicators are clustering around competitive states with rising pressure.',
     ARRAY['forecast','coalitions','influence','operations']),
    ($1, 'Convert coalition instability into targeted field actions', 'coalition_activation', 'high', 'open', 84, 29, 81, 78,
     'Assign coalition owners to the most unstable voter blocs and convert each movement signal into Command Center tasks.',
     'Coalition movement suggests a time-sensitive opening for persuasion and turnout coordination.',
     ARRAY['coalitions','strategy','command_center']),
    ($1, 'Reduce decision risk before expanding digital spend', 'risk_control', 'medium', 'planning', 79, 30, 73, 67,
     'Hold major budget expansion until forecast confidence and message testing improve above executive threshold.',
     'Digital opportunity is present, but uncertainty remains in audience response and vendor capacity.',
     ARRAY['forecast','vendors','influence'])
    RETURNING id, title
    `,
    [workspaceId]
  );

  const firstId = created.rows[0]?.id;
  const secondId = created.rows[1]?.id;

  if (firstId) {
    await pool.query(
      `
      INSERT INTO executive_decision_options
      (decision_id, label, description, projected_impact, projected_risk, confidence, cost_level, timeline, rank_order)
      VALUES
      ($1, 'Balanced resource shift', 'Move 10-15% of available resources into priority states while preserving national coverage.', 86, 32, 88, 'medium', '7-14 days', 1),
      ($1, 'Aggressive resource shift', 'Move 20-30% of available resources into the highest volatility states.', 94, 55, 81, 'high', '3-7 days', 2),
      ($1, 'Monitor only', 'Hold current posture and increase executive monitoring cadence.', 62, 18, 71, 'low', 'Immediate', 3)
      `,
      [firstId]
    );

    await pool.query(
      `
      INSERT INTO executive_decision_actions
      (decision_id, action_label, owner, status, due_window)
      VALUES
      ($1, 'Review battleground allocation model', 'Executive Operations', 'pending', '24 hours'),
      ($1, 'Validate vendor readiness in priority states', 'Vendor Operations', 'pending', '72 hours')
      `,
      [firstId]
    );
  }

  if (secondId) {
    await pool.query(
      `
      INSERT INTO executive_decision_options
      (decision_id, label, description, projected_impact, projected_risk, confidence, cost_level, timeline, rank_order)
      VALUES
      ($1, 'Activate coalition owners', 'Assign owners to top coalition opportunities and track weekly movement.', 82, 25, 84, 'medium', '5-10 days', 1)
      `,
      [secondId]
    );

    await pool.query(
      `
      INSERT INTO executive_decision_actions
      (decision_id, action_label, owner, status, due_window)
      VALUES
      ($1, 'Create coalition response tasks', 'Coalition Director', 'pending', '48 hours')
      `,
      [secondId]
    );
  }

  await pool.query(
    `
    INSERT INTO executive_decision_signals
    (workspace_id, signal_type, title, description, severity, source_module, state_code)
    VALUES
    ($1, 'forecast_shift', 'Forecast volatility rising', 'Competitive movement detected across battleground modeling.', 'high', 'forecast', 'GA'),
    ($1, 'coalition_movement', 'Coalition instability detected', 'Suburban and turnout-sensitive blocs require executive monitoring.', 'medium', 'coalitions', 'PA'),
    ($1, 'vendor_capacity', 'Vendor readiness gap', 'Execution capacity needs verification before resource expansion.', 'medium', 'vendors', 'AZ')
    `,
    [workspaceId]
  );

  return { seeded: true, decisions: created.rows.length };
}

export async function getDecisionIntelligenceHealth() {
  await ensureDecisionIntelligenceSchema(pool);

  const result = await pool.query(`
    SELECT COUNT(*)::int AS decision_count, MAX(updated_at) AS last_updated
    FROM executive_decisions
  `);

  return {
    ok: true,
    service: "executive-decision-intelligence",
    decision_count: result.rows[0]?.decision_count || 0,
    last_updated: result.rows[0]?.last_updated || null,
    timestamp: new Date().toISOString(),
  };
}
