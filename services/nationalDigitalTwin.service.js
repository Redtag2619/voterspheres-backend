import { pool } from "../db/pool.js";

const STATES = [
  ["AZ", "Arizona"],
  ["GA", "Georgia"],
  ["MI", "Michigan"],
  ["NV", "Nevada"],
  ["PA", "Pennsylvania"],
  ["WI", "Wisconsin"],
  ["NC", "North Carolina"],
  ["FL", "Florida"],
  ["TX", "Texas"],
  ["OH", "Ohio"],
];

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function pct(value) {
  return Math.round(n(value));
}

export async function ensureNationalDigitalTwinSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS national_digital_twin_states (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      state_code TEXT NOT NULL,
      state_name TEXT NOT NULL,
      executive_readiness_percentage NUMERIC DEFAULT 70,
      win_probability_percentage NUMERIC DEFAULT 50,
      coalition_strength_percentage NUMERIC DEFAULT 65,
      influence_momentum_percentage NUMERIC DEFAULT 60,
      operations_capacity_percentage NUMERIC DEFAULT 68,
      vendor_readiness_percentage NUMERIC DEFAULT 72,
      fundraising_momentum_percentage NUMERIC DEFAULT 64,
      forecast_confidence_percentage NUMERIC DEFAULT 76,
      risk_percentage NUMERIC DEFAULT 34,
      alert_level TEXT DEFAULT 'monitoring',
      recommendation TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS national_digital_twin_signals (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      source_module TEXT DEFAULT 'National Political Digital Twin',
      severity TEXT DEFAULT 'medium',
      state_code TEXT,
      state_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS national_digital_twin_timeline (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      event_title TEXT NOT NULL,
      event_description TEXT,
      event_type TEXT DEFAULT 'intelligence_update',
      state_code TEXT,
      state_name TEXT,
      impact_percentage NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS national_digital_twin_recommendations (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      recommendation TEXT,
      priority TEXT DEFAULT 'medium',
      confidence_percentage NUMERIC DEFAULT 75,
      impact_percentage NUMERIC DEFAULT 70,
      risk_percentage NUMERIC DEFAULT 35,
      source_modules TEXT[] DEFAULT ARRAY[]::TEXT[],
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_digital_twin_states_workspace ON national_digital_twin_states(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_digital_twin_states_code ON national_digital_twin_states(state_code);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_digital_twin_signals_workspace ON national_digital_twin_signals(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_digital_twin_timeline_workspace ON national_digital_twin_timeline(workspace_id);`);
}

function normalizeState(row) {
  return {
    ...row,
    executive_readiness_percentage: pct(row.executive_readiness_percentage),
    win_probability_percentage: pct(row.win_probability_percentage),
    coalition_strength_percentage: pct(row.coalition_strength_percentage),
    influence_momentum_percentage: pct(row.influence_momentum_percentage),
    operations_capacity_percentage: pct(row.operations_capacity_percentage),
    vendor_readiness_percentage: pct(row.vendor_readiness_percentage),
    fundraising_momentum_percentage: pct(row.fundraising_momentum_percentage),
    forecast_confidence_percentage: pct(row.forecast_confidence_percentage),
    risk_percentage: pct(row.risk_percentage),
  };
}

function fallbackData(workspaceId = 1) {
  const states = [
    {
      id: "fallback-az",
      workspace_id: workspaceId,
      state_code: "AZ",
      state_name: "Arizona",
      executive_readiness_percentage: 74,
      win_probability_percentage: 51,
      coalition_strength_percentage: 66,
      influence_momentum_percentage: 61,
      operations_capacity_percentage: 69,
      vendor_readiness_percentage: 63,
      fundraising_momentum_percentage: 58,
      forecast_confidence_percentage: 77,
      risk_percentage: 42,
      alert_level: "monitoring",
      recommendation: "Validate vendor readiness before expanding execution commitments.",
    },
    {
      id: "fallback-ga",
      workspace_id: workspaceId,
      state_code: "GA",
      state_name: "Georgia",
      executive_readiness_percentage: 82,
      win_probability_percentage: 56,
      coalition_strength_percentage: 73,
      influence_momentum_percentage: 69,
      operations_capacity_percentage: 78,
      vendor_readiness_percentage: 76,
      fundraising_momentum_percentage: 71,
      forecast_confidence_percentage: 84,
      risk_percentage: 31,
      alert_level: "high",
      recommendation: "Increase executive field and coalition monitoring in priority counties.",
    },
    {
      id: "fallback-pa",
      workspace_id: workspaceId,
      state_code: "PA",
      state_name: "Pennsylvania",
      executive_readiness_percentage: 79,
      win_probability_percentage: 54,
      coalition_strength_percentage: 70,
      influence_momentum_percentage: 65,
      operations_capacity_percentage: 73,
      vendor_readiness_percentage: 72,
      fundraising_momentum_percentage: 67,
      forecast_confidence_percentage: 81,
      risk_percentage: 36,
      alert_level: "high",
      recommendation: "Prioritize suburban turnout and coalition stability monitoring.",
    },
  ];

  return {
    summary: {
      nationalReadinessPercentage: 78,
      averageWinProbabilityPercentage: 54,
      nationalRiskPercentage: 36,
      liveSignalCount: 3,
      highAlertStateCount: 2,
      activeRecommendationCount: 2,
    },
    states,
    signals: [
      {
        id: "fallback-signal-1",
        title: "National readiness movement detected",
        description: "Executive readiness increased across priority battleground states.",
        source_module: "National Political Digital Twin",
        severity: "high",
        state_name: "National Coverage",
      },
    ],
    timeline: [
      {
        id: "fallback-timeline-1",
        event_title: "Digital twin initialized",
        event_description: "Cross-module national model synthesized from forecast, operations, influence, coalition, and simulation layers.",
        event_type: "model_update",
        state_name: "National Coverage",
        impact_percentage: 12,
      },
    ],
    recommendations: [
      {
        id: "fallback-rec-1",
        title: "Prioritize battleground executive monitoring",
        recommendation: "Increase review cadence in Georgia, Pennsylvania, and Arizona.",
        priority: "high",
        confidence_percentage: 86,
        impact_percentage: 82,
        risk_percentage: 29,
        source_modules: ["Executive Forecast Engine", "Executive Operations Center", "Predictive Campaign Simulation"],
        status: "open",
      },
    ],
  };
}

export async function seedNationalDigitalTwin(workspaceId = 1) {
  await ensureNationalDigitalTwinSchema(pool);

  const existing = await pool.query(
    `SELECT id FROM national_digital_twin_states WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.rows.length) {
    return { seeded: false, reason: "existing-data" };
  }

  for (let index = 0; index < STATES.length; index += 1) {
    const [code, name] = STATES[index];

    const readiness = 72 + ((index * 3) % 18);
    const win = 48 + ((index * 2) % 13);
    const coalition = 62 + ((index * 5) % 22);
    const influence = 59 + ((index * 4) % 20);
    const operations = 65 + ((index * 3) % 19);
    const vendors = 61 + ((index * 4) % 24);
    const fundraising = 58 + ((index * 5) % 22);
    const confidence = 73 + ((index * 2) % 15);
    const risk = 28 + ((index * 4) % 25);
    const alert = risk > 43 ? "high" : readiness > 82 ? "high" : "monitoring";

    await pool.query(
      `
      INSERT INTO national_digital_twin_states
      (
        workspace_id,
        state_code,
        state_name,
        executive_readiness_percentage,
        win_probability_percentage,
        coalition_strength_percentage,
        influence_momentum_percentage,
        operations_capacity_percentage,
        vendor_readiness_percentage,
        fundraising_momentum_percentage,
        forecast_confidence_percentage,
        risk_percentage,
        alert_level,
        recommendation
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
      [
        workspaceId,
        code,
        name,
        readiness,
        win,
        coalition,
        influence,
        operations,
        vendors,
        fundraising,
        confidence,
        risk,
        alert,
        `Review ${name} readiness, coalition movement, operations capacity, and forecast confidence before next executive allocation decision.`,
      ]
    );
  }

  await pool.query(
    `
    INSERT INTO national_digital_twin_signals
    (workspace_id, title, description, source_module, severity, state_code, state_name)
    VALUES
    ($1, 'Forecast and simulation divergence detected', 'Predictive simulation is moving faster than baseline forecast in one battleground cluster.', 'Predictive Campaign Simulation', 'high', 'GA', 'Georgia'),
    ($1, 'Coalition movement requires executive review', 'Suburban coalition volatility is increasing in a priority state.', 'National Coalition Intelligence', 'medium', 'PA', 'Pennsylvania'),
    ($1, 'Vendor readiness constraint detected', 'Vendor execution readiness is below preferred enterprise threshold.', 'Vendor Intelligence Network', 'medium', 'AZ', 'Arizona')
    `,
    [workspaceId]
  );

  await pool.query(
    `
    INSERT INTO national_digital_twin_timeline
    (workspace_id, event_title, event_description, event_type, state_code, state_name, impact_percentage)
    VALUES
    ($1, 'Forecast signal absorbed into national model', 'Executive forecast movement updated the digital twin battleground readiness model.', 'forecast_update', 'GA', 'Georgia', 8),
    ($1, 'Simulation result adjusted risk layer', 'Predictive campaign simulation changed the risk profile for execution planning.', 'simulation_update', 'AZ', 'Arizona', 11),
    ($1, 'Coalition intelligence updated state posture', 'Coalition intelligence increased monitoring priority in Pennsylvania.', 'coalition_update', 'PA', 'Pennsylvania', 7)
    `,
    [workspaceId]
  );

  await pool.query(
    `
    INSERT INTO national_digital_twin_recommendations
    (workspace_id, title, recommendation, priority, confidence_percentage, impact_percentage, risk_percentage, source_modules, status)
    VALUES
    ($1, 'Prioritize battleground executive monitoring', 'Increase executive review cadence across Georgia, Pennsylvania, Arizona, Michigan, Nevada, and Wisconsin.', 'high', 87, 84, 32, ARRAY['Executive Forecast Engine','Predictive Campaign Simulation','Executive Operations Center'], 'open'),
    ($1, 'Stabilize vendor execution risk', 'Review vendor readiness before converting simulation recommendations into operational commitments.', 'medium', 81, 76, 39, ARRAY['Vendor Intelligence Network','Executive Operations Center'], 'open')
    `,
    [workspaceId]
  );

  return { seeded: true };
}

export async function getNationalDigitalTwin(workspaceId = 1) {
  try {
    await ensureNationalDigitalTwinSchema(pool);

    const existing = await pool.query(
      `SELECT id FROM national_digital_twin_states WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    if (!existing.rows.length) {
      await seedNationalDigitalTwin(workspaceId);
    }

    const [statesResult, signalsResult, timelineResult, recommendationsResult] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM national_digital_twin_states
        WHERE workspace_id = $1
        ORDER BY alert_level DESC, executive_readiness_percentage DESC, win_probability_percentage DESC
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM national_digital_twin_signals
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM national_digital_twin_timeline
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM national_digital_twin_recommendations
        WHERE workspace_id = $1
        ORDER BY confidence_percentage DESC, impact_percentage DESC, created_at DESC
        LIMIT 20
        `,
        [workspaceId]
      ),
    ]);

    const states = statesResult.rows.map(normalizeState);

    const summary = {
      nationalReadinessPercentage: Math.round(
        states.reduce((sum, item) => sum + n(item.executive_readiness_percentage), 0) / Math.max(states.length, 1)
      ),
      averageWinProbabilityPercentage: Math.round(
        states.reduce((sum, item) => sum + n(item.win_probability_percentage), 0) / Math.max(states.length, 1)
      ),
      nationalRiskPercentage: Math.round(
        states.reduce((sum, item) => sum + n(item.risk_percentage), 0) / Math.max(states.length, 1)
      ),
      liveSignalCount: signalsResult.rows.length,
      highAlertStateCount: states.filter((item) => String(item.alert_level || "").toLowerCase() === "high").length,
      activeRecommendationCount: recommendationsResult.rows.length,
    };

    return {
      summary,
      states,
      signals: signalsResult.rows,
      timeline: timelineResult.rows,
      recommendations: recommendationsResult.rows.map((item) => ({
        ...item,
        confidence_percentage: pct(item.confidence_percentage),
        impact_percentage: pct(item.impact_percentage),
        risk_percentage: pct(item.risk_percentage),
      })),
    };
  } catch (error) {
    console.error("[National Digital Twin] service fallback:", error);
    return fallbackData(workspaceId);
  }
}

export async function getNationalDigitalTwinHealth() {
  await ensureNationalDigitalTwinSchema(pool);

  const result = await pool.query(`
    SELECT COUNT(*)::int AS state_count, MAX(updated_at) AS last_updated
    FROM national_digital_twin_states
  `);

  return {
    ok: true,
    service: "national-political-digital-twin",
    state_count: result.rows[0]?.state_count || 0,
    last_updated: result.rows[0]?.last_updated || null,
    timestamp: new Date().toISOString(),
  };
}
