import { pool } from "../db/pool.js";

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value)));
}

export async function ensureCampaignSimulationSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_simulations (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      simulation_type TEXT NOT NULL DEFAULT 'campaign_simulation',
      state_code TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      scenario_label TEXT,
      baseline_win_probability NUMERIC DEFAULT 50,
      simulated_win_probability NUMERIC DEFAULT 50,
      turnout_lift_percentage NUMERIC DEFAULT 0,
      funding_impact_percentage NUMERIC DEFAULT 0,
      coalition_movement_percentage NUMERIC DEFAULT 0,
      vendor_execution_readiness NUMERIC DEFAULT 70,
      risk_percentage NUMERIC DEFAULT 35,
      confidence_percentage NUMERIC DEFAULT 75,
      recommendation TEXT,
      assumptions JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_simulation_outcomes (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER REFERENCES campaign_simulations(id) ON DELETE CASCADE,
      outcome_label TEXT NOT NULL,
      win_probability NUMERIC DEFAULT 50,
      turnout_change_percentage NUMERIC DEFAULT 0,
      funding_change_percentage NUMERIC DEFAULT 0,
      coalition_change_percentage NUMERIC DEFAULT 0,
      risk_percentage NUMERIC DEFAULT 35,
      narrative TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_simulation_signals (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT DEFAULT 'medium',
      source_module TEXT DEFAULT 'Predictive Campaign Simulation Engine',
      state_code TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_simulation_actions (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER REFERENCES campaign_simulations(id) ON DELETE CASCADE,
      action_label TEXT NOT NULL,
      owner TEXT DEFAULT 'Executive Operations',
      status TEXT DEFAULT 'pending',
      due_window TEXT DEFAULT '72 hours',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaign_simulations_workspace ON campaign_simulations(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaign_simulations_state ON campaign_simulations(state_code);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaign_simulation_signals_workspace ON campaign_simulation_signals(workspace_id);`);
}

function fallbackData(workspaceId = 1) {
  return {
    summary: {
      activeSimulations: 3,
      averageWinProbability: 56,
      averageTurnoutLift: 4,
      averageFundingImpact: 7,
      averageCoalitionMovement: 5,
      averageExecutionReadiness: 74,
    },
    simulations: [
      {
        id: "server-fallback-1",
        workspace_id: workspaceId,
        title: "Battleground Resource Expansion Simulation",
        simulation_type: "resource_expansion",
        state_code: "Georgia",
        status: "active",
        scenario_label: "Balanced Field And Vendor Expansion",
        baseline_win_probability: 49,
        simulated_win_probability: 56,
        turnout_lift_percentage: 5,
        funding_impact_percentage: 8,
        coalition_movement_percentage: 6,
        vendor_execution_readiness: 78,
        risk_percentage: 32,
        confidence_percentage: 86,
        recommendation: "Increase field capacity and vendor execution in priority counties while monitoring coalition stability.",
        assumptions: {},
        outcomes: [],
        actions: [],
      },
    ],
    signals: [],
  };
}

function normalizeSimulation(row) {
  return {
    ...row,
    baseline_win_probability: Math.round(n(row.baseline_win_probability)),
    simulated_win_probability: Math.round(n(row.simulated_win_probability)),
    turnout_lift_percentage: Math.round(n(row.turnout_lift_percentage)),
    funding_impact_percentage: Math.round(n(row.funding_impact_percentage)),
    coalition_movement_percentage: Math.round(n(row.coalition_movement_percentage)),
    vendor_execution_readiness: Math.round(n(row.vendor_execution_readiness)),
    risk_percentage: Math.round(n(row.risk_percentage)),
    confidence_percentage: Math.round(n(row.confidence_percentage)),
  };
}

export async function getCampaignSimulations(workspaceId = 1) {
  try {
    await ensureCampaignSimulationSchema(pool);

    const simulationsResult = await pool.query(
      `
      SELECT *
      FROM campaign_simulations
      WHERE workspace_id = $1
      ORDER BY simulated_win_probability DESC, confidence_percentage DESC, updated_at DESC
      LIMIT 40
      `,
      [workspaceId]
    );

    if (!simulationsResult.rows.length) {
      await seedCampaignSimulations(workspaceId);
      return getCampaignSimulations(workspaceId);
    }

    const ids = simulationsResult.rows.map((row) => row.id);

    const [outcomesResult, actionsResult, signalsResult] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM campaign_simulation_outcomes
        WHERE simulation_id = ANY($1::int[])
        ORDER BY simulation_id, id ASC
        `,
        [ids]
      ),
      pool.query(
        `
        SELECT *
        FROM campaign_simulation_actions
        WHERE simulation_id = ANY($1::int[])
        ORDER BY simulation_id, id ASC
        `,
        [ids]
      ),
      pool.query(
        `
        SELECT *
        FROM campaign_simulation_signals
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
    ]);

    const simulations = simulationsResult.rows.map((row) => {
      const simulation = normalizeSimulation(row);

      return {
        ...simulation,
        outcomes: outcomesResult.rows
          .filter((item) => Number(item.simulation_id) === Number(row.id))
          .map((item) => ({
            ...item,
            win_probability: Math.round(n(item.win_probability)),
            turnout_change_percentage: Math.round(n(item.turnout_change_percentage)),
            funding_change_percentage: Math.round(n(item.funding_change_percentage)),
            coalition_change_percentage: Math.round(n(item.coalition_change_percentage)),
            risk_percentage: Math.round(n(item.risk_percentage)),
          })),
        actions: actionsResult.rows.filter((item) => Number(item.simulation_id) === Number(row.id)),
      };
    });

    const summary = {
      activeSimulations: simulations.length,
      averageWinProbability: Math.round(
        simulations.reduce((sum, item) => sum + n(item.simulated_win_probability), 0) / Math.max(simulations.length, 1)
      ),
      averageTurnoutLift: Math.round(
        simulations.reduce((sum, item) => sum + n(item.turnout_lift_percentage), 0) / Math.max(simulations.length, 1)
      ),
      averageFundingImpact: Math.round(
        simulations.reduce((sum, item) => sum + n(item.funding_impact_percentage), 0) / Math.max(simulations.length, 1)
      ),
      averageCoalitionMovement: Math.round(
        simulations.reduce((sum, item) => sum + n(item.coalition_movement_percentage), 0) / Math.max(simulations.length, 1)
      ),
      averageExecutionReadiness: Math.round(
        simulations.reduce((sum, item) => sum + n(item.vendor_execution_readiness), 0) / Math.max(simulations.length, 1)
      ),
    };

    return {
      summary,
      simulations,
      signals: signalsResult.rows,
    };
  } catch (error) {
    console.error("[Campaign Simulation] service fallback:", error);
    return fallbackData(workspaceId);
  }
}

export async function seedCampaignSimulations(workspaceId = 1) {
  await ensureCampaignSimulationSchema(pool);

  const existing = await pool.query(
    `SELECT id FROM campaign_simulations WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.rows.length) {
    return { seeded: false, reason: "existing-data" };
  }

  const created = await pool.query(
    `
    INSERT INTO campaign_simulations
    (
      workspace_id,
      title,
      simulation_type,
      state_code,
      status,
      scenario_label,
      baseline_win_probability,
      simulated_win_probability,
      turnout_lift_percentage,
      funding_impact_percentage,
      coalition_movement_percentage,
      vendor_execution_readiness,
      risk_percentage,
      confidence_percentage,
      recommendation,
      assumptions
    )
    VALUES
    ($1, 'Battleground Resource Expansion Simulation', 'resource_expansion', 'Georgia', 'active', 'Balanced Field And Vendor Expansion', 49, 56, 5, 8, 6, 78, 32, 86,
     'Increase field capacity and vendor execution in priority counties while monitoring coalition stability.',
     '{"field_capacity":"Moderate increase","digital_spend":"Targeted increase","coalition_engagement":"High-touch suburban outreach"}'::jsonb),
    ($1, 'Turnout Surge Simulation', 'turnout_model', 'Pennsylvania', 'active', 'Suburban And Youth Turnout Increase', 51, 58, 7, 4, 8, 72, 36, 82,
     'Prioritize turnout operations in persuasion-sensitive suburban corridors.',
     '{"turnout_program":"Suburban and youth mobilization","field_capacity":"Expanded volunteer coverage","message_focus":"Economic trust and local credibility"}'::jsonb),
    ($1, 'Funding Compression Simulation', 'funding_model', 'Arizona', 'monitoring', 'Reduced Fundraising Growth With Vendor Constraints', 48, 45, -2, -6, -3, 61, 54, 79,
     'Stabilize funding pipeline before expanding execution commitments.',
     '{"funding_environment":"Compressed growth","vendor_capacity":"Constrained execution coverage","risk_posture":"Cautious expansion"}'::jsonb)
    RETURNING id, title
    `,
    [workspaceId]
  );

  const firstId = created.rows[0]?.id;
  const secondId = created.rows[1]?.id;
  const thirdId = created.rows[2]?.id;

  if (firstId) {
    await pool.query(
      `
      INSERT INTO campaign_simulation_outcomes
      (simulation_id, outcome_label, win_probability, turnout_change_percentage, funding_change_percentage, coalition_change_percentage, risk_percentage, narrative)
      VALUES
      ($1, 'Expected Case', 56, 5, 8, 6, 32, 'Balanced investment produces measurable movement without excessive operational risk.'),
      ($1, 'Upside Case', 61, 8, 10, 9, 39, 'Coalition response and turnout lift outperform baseline assumptions.'),
      ($1, 'Downside Case', 51, 2, 5, 3, 44, 'Operational delays reduce the expected benefit of the expansion.')
      `,
      [firstId]
    );

    await pool.query(
      `
      INSERT INTO campaign_simulation_actions
      (simulation_id, action_label, owner, status, due_window)
      VALUES
      ($1, 'Convert simulation into Command Center resource tasks', 'Executive Operations', 'pending', '48 hours'),
      ($1, 'Validate vendor execution capacity in priority counties', 'Vendor Operations', 'pending', '72 hours')
      `,
      [firstId]
    );
  }

  if (secondId) {
    await pool.query(
      `
      INSERT INTO campaign_simulation_outcomes
      (simulation_id, outcome_label, win_probability, turnout_change_percentage, funding_change_percentage, coalition_change_percentage, risk_percentage, narrative)
      VALUES
      ($1, 'Expected Case', 58, 7, 4, 8, 36, 'Turnout improvement creates a stronger simulated path.'),
      ($1, 'Downside Case', 52, 3, 2, 4, 46, 'Lower volunteer conversion reduces turnout lift.')
      `,
      [secondId]
    );
  }

  if (thirdId) {
    await pool.query(
      `
      INSERT INTO campaign_simulation_outcomes
      (simulation_id, outcome_label, win_probability, turnout_change_percentage, funding_change_percentage, coalition_change_percentage, risk_percentage, narrative)
      VALUES
      ($1, 'Expected Case', 45, -2, -6, -3, 54, 'Funding compression reduces simulated win probability.'),
      ($1, 'Recovery Case', 50, 1, 2, 1, 38, 'Stabilized fundraising restores baseline competitiveness.')
      `,
      [thirdId]
    );
  }

  await pool.query(
    `
    INSERT INTO campaign_simulation_signals
    (workspace_id, title, description, severity, source_module, state_code)
    VALUES
    ($1, 'Turnout sensitivity increasing', 'Simulation results indicate turnout movement is the strongest driver of projected probability movement.', 'high', 'Predictive Campaign Simulation Engine', 'Pennsylvania'),
    ($1, 'Vendor readiness constraint detected', 'Execution readiness is below preferred threshold in one priority scenario.', 'medium', 'Vendor Intelligence Network', 'Arizona'),
    ($1, 'Funding compression scenario detected', 'Reduced fundraising momentum could create measurable probability drag.', 'medium', 'Fundraising Intelligence Layer', 'Arizona')
    `,
    [workspaceId]
  );

  return { seeded: true, simulations: created.rows.length };
}

export async function runCampaignSimulation(workspaceId = 1, payload = {}) {
  await ensureCampaignSimulationSchema(pool);

  const baseline = clamp(payload.baseline_win_probability ?? 50);
  const turnout = n(payload.turnout_lift_percentage ?? 4);
  const funding = n(payload.funding_impact_percentage ?? 5);
  const coalition = n(payload.coalition_movement_percentage ?? 4);
  const vendorReadiness = clamp(payload.vendor_execution_readiness ?? 72);
  const risk = clamp(payload.risk_percentage ?? 35);

  const simulatedWinProbability = clamp(
    baseline +
      turnout * 0.55 +
      funding * 0.35 +
      coalition * 0.45 +
      (vendorReadiness - 70) * 0.08 -
      risk * 0.08
  );

  const confidence = clamp(72 + Math.min(14, Math.abs(turnout) + Math.abs(funding)) - Math.max(0, risk - 45) * 0.2);

  const result = await pool.query(
    `
    INSERT INTO campaign_simulations
    (
      workspace_id,
      title,
      simulation_type,
      state_code,
      status,
      scenario_label,
      baseline_win_probability,
      simulated_win_probability,
      turnout_lift_percentage,
      funding_impact_percentage,
      coalition_movement_percentage,
      vendor_execution_readiness,
      risk_percentage,
      confidence_percentage,
      recommendation,
      assumptions,
      updated_at
    )
    VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
    RETURNING *
    `,
    [
      workspaceId,
      payload.title || "Executive What-If Campaign Simulation",
      payload.simulation_type || "executive_what_if",
      payload.state_code || "National Coverage",
      payload.scenario_label || "Executive What-If Scenario",
      Math.round(baseline),
      Math.round(simulatedWinProbability),
      Math.round(turnout),
      Math.round(funding),
      Math.round(coalition),
      Math.round(vendorReadiness),
      Math.round(risk),
      Math.round(confidence),
      payload.recommendation || "Review simulated path and convert the strongest scenario into Command Center execution tasks.",
      JSON.stringify(payload.assumptions || {}),
    ]
  );

  return {
    ok: true,
    simulation: normalizeSimulation(result.rows[0]),
  };
}

export async function getCampaignSimulationHealth() {
  await ensureCampaignSimulationSchema(pool);

  const result = await pool.query(`
    SELECT COUNT(*)::int AS simulation_count, MAX(updated_at) AS last_updated
    FROM campaign_simulations
  `);

  return {
    ok: true,
    service: "predictive-campaign-simulation",
    simulation_count: result.rows[0]?.simulation_count || 0,
    last_updated: result.rows[0]?.last_updated || null,
    timestamp: new Date().toISOString(),
  };
}
