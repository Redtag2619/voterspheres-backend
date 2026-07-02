import { pool } from "../db/pool.js";
import { ensureInfluenceSchema } from "./influence.service.js";
import { ensureInfluenceForecastSchema } from "./influenceForecast.service.js";
import { ensureCoalitionSchema } from "./coalitionIntelligence.service.js";

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value)));
}

function clean(value = "") {
  return String(value || "").trim();
}

function stableKey(...parts) {
  return parts
    .map((part) => clean(part).toLowerCase().replace(/[^a-z0-9]+/g, "_"))
    .filter(Boolean)
    .join("::");
}

function priorityFromScore(score) {
  const value = n(score);
  if (value >= 85) return "critical";
  if (value >= 70) return "high";
  if (value >= 50) return "medium";
  return "low";
}

function recommendationTone(type = "") {
  const value = String(type || "").toLowerCase();
  if (value.includes("risk") || value.includes("defense")) return "danger";
  if (value.includes("opportunity") || value.includes("growth")) return "active";
  if (value.includes("coalition")) return "accent";
  if (value.includes("donor")) return "danger";
  if (value.includes("endorsement")) return "demo";
  return "info";
}

export async function ensureStrategySchema(client = pool) {
  await ensureInfluenceSchema(client);
  await ensureInfluenceForecastSchema(client);
  await ensureCoalitionSchema(client);

  await client.query(`
    CREATE TABLE IF NOT EXISTS strategy_recommendations (
      id SERIAL PRIMARY KEY,
      recommendation_key TEXT UNIQUE NOT NULL,
      source_key TEXT,
      source_type TEXT,
      entity_key TEXT,
      entity_type TEXT,
      entity_name TEXT,
      state TEXT,
      strategy_type TEXT NOT NULL,
      priority TEXT DEFAULT 'medium',
      confidence_score NUMERIC DEFAULT 0,
      impact_score NUMERIC DEFAULT 0,
      urgency_score NUMERIC DEFAULT 0,
      feasibility_score NUMERIC DEFAULT 0,
      risk_score NUMERIC DEFAULT 0,
      strategy_score NUMERIC DEFAULT 0,
      title TEXT NOT NULL,
      summary TEXT,
      recommended_action TEXT,
      rationale TEXT,
      owner_role TEXT DEFAULT 'Strategy Lead',
      time_horizon TEXT DEFAULT '7 days',
      command_center_payload JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'active',
      calculated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS strategy_action_conversions (
      id SERIAL PRIMARY KEY,
      conversion_key TEXT UNIQUE NOT NULL,
      recommendation_key TEXT NOT NULL,
      task_id TEXT,
      state TEXT,
      status TEXT DEFAULT 'queued',
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_state ON strategy_recommendations(state);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_type ON strategy_recommendations(strategy_type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_score ON strategy_recommendations(strategy_score DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_priority ON strategy_recommendations(priority);`);
}

function baseRecommendation(overrides) {
  const impact = clamp(overrides.impact_score);
  const urgency = clamp(overrides.urgency_score);
  const feasibility = clamp(overrides.feasibility_score);
  const confidence = clamp(overrides.confidence_score);
  const risk = clamp(overrides.risk_score);
  const score = clamp(overrides.strategy_score ?? impact * 0.38 + urgency * 0.26 + feasibility * 0.22 + confidence * 0.14);

  return {
    priority: priorityFromScore(score),
    confidence_score: Math.round(confidence),
    impact_score: Math.round(impact),
    urgency_score: Math.round(urgency),
    feasibility_score: Math.round(feasibility),
    risk_score: Math.round(risk),
    strategy_score: Math.round(score),
    ...overrides,
    priority: overrides.priority || priorityFromScore(score),
    metadata: {
      tone: recommendationTone(overrides.strategy_type),
      ...(overrides.metadata || {}),
    },
  };
}

function buildForecastRecommendation(row) {
  const probability = n(row.probability);
  const opportunity = n(row.opportunity_score);
  const risk = n(row.risk_score);
  const momentum = n(row.momentum_score);
  const confidence = n(row.confidence_score);
  const type = clean(row.forecast_type || "forecast");

  let strategyType = "forecast_opportunity";
  let ownerRole = "Strategy Lead";
  let title = `Act on ${row.entity_name || row.title || "forecast signal"}`;
  let recommendedAction = row.recommended_action || "Assign a strategy owner to review this forecast and define the next action.";
  let timeHorizon = "7 days";

  if (type.includes("decline") || risk >= 70) {
    strategyType = "risk_defense";
    title = `Defend against risk signal: ${row.entity_name || row.title}`;
    recommendedAction = `Create a defensive plan for ${row.entity_name || "this entity"} and identify the strongest counter-relationship.`;
    ownerRole = "Risk Lead";
    timeHorizon = risk >= 85 ? "24 hours" : "72 hours";
  } else if (type.includes("donor")) {
    strategyType = "donor_growth";
    title = `Prioritize donor movement: ${row.entity_name || row.title}`;
    recommendedAction = `Route ${row.entity_name || "this donor signal"} to fundraising leadership and map candidate alignment.`;
    ownerRole = "Fundraising Lead";
    timeHorizon = "72 hours";
  } else if (type.includes("endorsement")) {
    strategyType = "endorsement_capture";
    title = `Pursue endorsement path: ${row.entity_name || row.title}`;
    recommendedAction = "Identify the top relationship bridge and prepare endorsement outreach.";
    ownerRole = "Endorsement Lead";
    timeHorizon = "5 days";
  } else if (type.includes("vendor")) {
    strategyType = "vendor_execution";
    title = `Review vendor execution fit: ${row.entity_name || row.title}`;
    recommendedAction = "Compare this vendor signal against state operating gaps and assign procurement review.";
    ownerRole = "Operations Lead";
  }

  const impact = clamp(probability * 0.35 + opportunity * 0.35 + momentum * 0.15 + confidence * 0.15);
  const urgency = clamp(risk * 0.45 + probability * 0.25 + momentum * 0.2 + (type.includes("decline") ? 15 : 0));
  const feasibility = clamp(confidence * 0.55 + opportunity * 0.25 + probability * 0.2);

  return baseRecommendation({
    recommendation_key: stableKey("strategy", "forecast", row.prediction_key || row.id),
    source_key: row.prediction_key || String(row.id),
    source_type: "forecast",
    entity_key: row.entity_key,
    entity_type: row.entity_type,
    entity_name: row.entity_name || row.title,
    state: row.state,
    strategy_type: strategyType,
    confidence_score: confidence,
    impact_score: impact,
    urgency_score: urgency,
    feasibility_score: feasibility,
    risk_score: risk,
    title,
    summary: row.detail || `Forecast probability ${Math.round(probability)}%, opportunity ${Math.round(opportunity)}%, risk ${Math.round(risk)}%.`,
    recommended_action: recommendedAction,
    rationale: `Generated from forecast probability ${Math.round(probability)}%, opportunity ${Math.round(opportunity)}%, momentum ${Math.round(momentum)}%, risk ${Math.round(risk)}%, and confidence ${Math.round(confidence)}%.`,
    owner_role: ownerRole,
    time_horizon: timeHorizon,
    command_center_payload: { title, state: row.state, type: strategyType, source: "strategy-engine", entity_name: row.entity_name || row.title, recommended_action: recommendedAction },
    metadata: { forecast_type: row.forecast_type, probability, opportunity, momentum },
  });
}

function buildCoalitionRecommendation(row) {
  const score = n(row.coalition_score);
  const opportunity = n(row.opportunity_score);
  const risk = n(row.risk_score);
  const confidence = n(row.confidence_score);
  const forecast = n(row.forecast_probability);
  const impact = clamp(score * 0.4 + opportunity * 0.3 + forecast * 0.2 + confidence * 0.1);
  const urgency = clamp(risk * 0.35 + forecast * 0.25 + score * 0.25 + opportunity * 0.15);
  const feasibility = clamp(confidence * 0.4 + score * 0.35 + opportunity * 0.25);
  const title = `Activate coalition strategy: ${row.coalition_name}`;
  const recommendedAction = row.recommended_action || `Assign a coalition owner for ${row.coalition_name} and convert top members into outreach actions.`;

  return baseRecommendation({
    recommendation_key: stableKey("strategy", "coalition", row.coalition_key || row.id),
    source_key: row.coalition_key || String(row.id),
    source_type: "coalition",
    entity_key: row.lead_entity_key,
    entity_type: row.coalition_type,
    entity_name: row.lead_entity_name || row.coalition_name,
    state: row.state,
    strategy_type: "coalition_activation",
    confidence_score: confidence,
    impact_score: impact,
    urgency_score: urgency,
    feasibility_score: feasibility,
    risk_score: risk,
    title,
    summary: `${row.coalition_name} has coalition score ${Math.round(score)}%, opportunity ${Math.round(opportunity)}%, and forecast probability ${Math.round(forecast)}%.`,
    recommended_action: recommendedAction,
    rationale: "Generated from coalition score, cohesion, forecast probability, entity count, and member influence density.",
    owner_role: "Coalition Lead",
    time_horizon: score >= 85 ? "24 hours" : "7 days",
    command_center_payload: { title, state: row.state, type: "coalition_activation", source: "strategy-engine", entity_name: row.coalition_name, recommended_action: recommendedAction, coalition_key: row.coalition_key },
    metadata: { coalition_type: row.coalition_type, entity_count: row.entity_count, relationship_count: row.relationship_count },
  });
}

function buildInfluenceRecommendation(row) {
  const influence = n(row.influence_score);
  const centrality = n(row.centrality_score);
  const reach = n(row.reach_score);
  const momentum = n(row.momentum_score);
  const risk = n(row.risk_score);
  const connections = n(row.total_connections);
  const impact = clamp(influence * 0.35 + centrality * 0.25 + reach * 0.25 + Math.min(15, connections));
  const urgency = clamp(momentum * 0.3 + risk * 0.35 + influence * 0.2 + centrality * 0.15);
  const feasibility = clamp(centrality * 0.35 + reach * 0.25 + Math.min(30, connections * 3) + influence * 0.1);
  const confidence = clamp(45 + Math.min(35, connections * 4) + Math.min(20, n(row.source_count) * 5));

  let strategyType = "relationship_growth";
  let ownerRole = "Political Director";
  if (row.entity_type === "donor") { strategyType = "donor_growth"; ownerRole = "Fundraising Lead"; }
  else if (row.entity_type === "vendor") { strategyType = "vendor_execution"; ownerRole = "Operations Lead"; }
  else if (row.entity_type === "candidate") { strategyType = "candidate_positioning"; ownerRole = "Candidate Lead"; }
  else if (row.entity_type === "endorsement" || row.entity_type === "organization") { strategyType = "endorsement_capture"; ownerRole = "Endorsement Lead"; }

  const title = `Develop strategic relationship: ${row.entity_name}`;
  const recommendedAction = `Assign ${row.entity_name} to ${ownerRole} for relationship mapping and next-step conversion.`;

  return baseRecommendation({
    recommendation_key: stableKey("strategy", "influence", row.entity_key || row.id),
    source_key: row.entity_key || String(row.id),
    source_type: "influence",
    entity_key: row.entity_key,
    entity_type: row.entity_type,
    entity_name: row.entity_name,
    state: row.state,
    strategy_type: strategyType,
    confidence_score: confidence,
    impact_score: impact,
    urgency_score: urgency,
    feasibility_score: feasibility,
    risk_score: risk,
    title,
    summary: `${row.entity_name} has influence ${Math.round(influence)}%, centrality ${Math.round(centrality)}%, reach ${Math.round(reach)}%, and ${connections} graph connections.`,
    recommended_action: recommendedAction,
    rationale: "Generated from entity influence, centrality, reach, momentum, risk, and relationship count.",
    owner_role: ownerRole,
    time_horizon: influence >= 85 ? "48 hours" : "7 days",
    command_center_payload: { title, state: row.state, type: strategyType, source: "strategy-engine", entity_name: row.entity_name, recommended_action: recommendedAction },
    metadata: { influence, centrality, reach, connections },
  });
}

async function persistRecommendation(client, item) {
  await client.query(
    `
      INSERT INTO strategy_recommendations (
        recommendation_key, source_key, source_type, entity_key, entity_type, entity_name, state,
        strategy_type, priority, confidence_score, impact_score, urgency_score, feasibility_score,
        risk_score, strategy_score, title, summary, recommended_action, rationale, owner_role,
        time_horizon, command_center_payload, metadata, updated_at, calculated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,NOW(),NOW()
      ) ON CONFLICT (recommendation_key) DO UPDATE SET
        source_key = EXCLUDED.source_key,
        source_type = EXCLUDED.source_type,
        entity_key = EXCLUDED.entity_key,
        entity_type = EXCLUDED.entity_type,
        entity_name = EXCLUDED.entity_name,
        state = EXCLUDED.state,
        strategy_type = EXCLUDED.strategy_type,
        priority = EXCLUDED.priority,
        confidence_score = EXCLUDED.confidence_score,
        impact_score = EXCLUDED.impact_score,
        urgency_score = EXCLUDED.urgency_score,
        feasibility_score = EXCLUDED.feasibility_score,
        risk_score = EXCLUDED.risk_score,
        strategy_score = EXCLUDED.strategy_score,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        recommended_action = EXCLUDED.recommended_action,
        rationale = EXCLUDED.rationale,
        owner_role = EXCLUDED.owner_role,
        time_horizon = EXCLUDED.time_horizon,
        command_center_payload = EXCLUDED.command_center_payload,
        metadata = EXCLUDED.metadata,
        status = 'active',
        updated_at = NOW(),
        calculated_at = NOW()
    `,
    [
      item.recommendation_key, item.source_key, item.source_type, item.entity_key, item.entity_type, item.entity_name, item.state,
      item.strategy_type, item.priority, item.confidence_score, item.impact_score, item.urgency_score, item.feasibility_score,
      item.risk_score, item.strategy_score, item.title, item.summary, item.recommended_action, item.rationale, item.owner_role,
      item.time_horizon, JSON.stringify(item.command_center_payload || {}), JSON.stringify(item.metadata || {}),
    ]
  );
}

export async function recalculateStrategyRecommendations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureStrategySchema(client);

    const forecastRows = await client.query(`SELECT * FROM influence_predictions WHERE status = 'active' ORDER BY probability DESC, opportunity_score DESC LIMIT 250`);
    const coalitionRows = await client.query(`SELECT * FROM coalition_intelligence WHERE status = 'active' ORDER BY coalition_score DESC, opportunity_score DESC LIMIT 250`);
    const influenceRows = await client.query(`SELECT * FROM influence_entities WHERE influence_score >= 45 ORDER BY influence_score DESC, centrality_score DESC LIMIT 350`);

    const recommendations = [
      ...forecastRows.rows.map(buildForecastRecommendation),
      ...coalitionRows.rows.map(buildCoalitionRecommendation),
      ...influenceRows.rows.map(buildInfluenceRecommendation),
    ];

    const unique = new Map();
    for (const recommendation of recommendations) {
      const existing = unique.get(recommendation.recommendation_key);
      if (!existing || n(recommendation.strategy_score) > n(existing.strategy_score)) unique.set(recommendation.recommendation_key, recommendation);
    }

    const sorted = [...unique.values()].sort((a, b) => b.strategy_score - a.strategy_score);
    for (const recommendation of sorted) await persistRecommendation(client, recommendation);

    await client.query("COMMIT");

    return {
      ok: true,
      summary: {
        recommendations: sorted.length,
        critical: sorted.filter((item) => item.priority === "critical").length,
        high: sorted.filter((item) => item.priority === "high").length,
        states_covered: new Set(sorted.map((item) => item.state).filter(Boolean)).size,
        calculated_at: new Date().toISOString(),
      },
      recommendations: sorted.slice(0, 100),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getStrategySummary() {
  await ensureStrategySchema(pool);

  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_recommendations,
      COUNT(*) FILTER (WHERE priority = 'critical')::int AS critical_recommendations,
      COUNT(*) FILTER (WHERE priority = 'high')::int AS high_recommendations,
      COUNT(DISTINCT state)::int AS states_covered,
      ROUND(AVG(strategy_score), 2) AS avg_strategy_score,
      MAX(strategy_score) AS top_strategy_score
    FROM strategy_recommendations
    WHERE status = 'active'
  `);

  const byType = await pool.query(`
    SELECT strategy_type, COUNT(*)::int AS count, ROUND(AVG(strategy_score), 2) AS avg_score, MAX(strategy_score) AS top_score
    FROM strategy_recommendations
    WHERE status = 'active'
    GROUP BY strategy_type
    ORDER BY top_score DESC NULLS LAST
  `);

  const byState = await pool.query(`
    SELECT state, COUNT(*)::int AS recommendations, ROUND(AVG(strategy_score), 2) AS avg_score, MAX(strategy_score) AS top_score
    FROM strategy_recommendations
    WHERE status = 'active' AND state IS NOT NULL
    GROUP BY state
    ORDER BY top_score DESC NULLS LAST
  `);

  return { summary: summary.rows[0] || {}, by_type: byType.rows, by_state: byState.rows };
}

export async function getStrategyRecommendations({ state = "", type = "", priority = "", limit = 75 } = {}) {
  await ensureStrategySchema(pool);

  const params = [];
  const where = [`status = 'active'`];

  if (state) { params.push(String(state).toUpperCase()); where.push(`state = $${params.length}`); }
  if (type) { params.push(String(type).toLowerCase()); where.push(`strategy_type = $${params.length}`); }
  if (priority) { params.push(String(priority).toLowerCase()); where.push(`priority = $${params.length}`); }

  params.push(Math.min(300, Math.max(1, n(limit, 75))));

  const result = await pool.query(
    `SELECT * FROM strategy_recommendations WHERE ${where.join(" AND ")} ORDER BY strategy_score DESC, urgency_score DESC, impact_score DESC LIMIT $${params.length}`,
    params
  );

  return { results: result.rows, count: result.rows.length };
}

export async function getStrategyDetail({ key = "" } = {}) {
  await ensureStrategySchema(pool);
  const result = await pool.query(`SELECT * FROM strategy_recommendations WHERE recommendation_key = $1 LIMIT 1`, [key]);
  return { recommendation: result.rows[0] || null };
}

export async function queueStrategyAction({ recommendationKey = "" } = {}) {
  await ensureStrategySchema(pool);
  const result = await pool.query(`SELECT * FROM strategy_recommendations WHERE recommendation_key = $1 LIMIT 1`, [recommendationKey]);
  const recommendation = result.rows[0];

  if (!recommendation) return { ok: false, error: "Strategy recommendation not found." };

  const conversionKey = stableKey("strategy_conversion", recommendation.recommendation_key);
  await pool.query(
    `INSERT INTO strategy_action_conversions (conversion_key, recommendation_key, state, status, payload, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
     ON CONFLICT (conversion_key) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = NOW()`,
    [conversionKey, recommendation.recommendation_key, recommendation.state, "queued", JSON.stringify(recommendation.command_center_payload || {})]
  );

  return { ok: true, conversion_key: conversionKey, recommendation_key: recommendation.recommendation_key, payload: recommendation.command_center_payload || {} };
}
