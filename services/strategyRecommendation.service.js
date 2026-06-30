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

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_state
    ON strategy_recommendations(state);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_type
    ON strategy_recommendations(strategy_type);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_score
    ON strategy_recommendations(strategy_score DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_strategy_recommendations_priority
    ON strategy_recommendations(priority);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_strategy_action_conversions_key
    ON strategy_action_conversions(recommendation_key);
  `);
}

/* ============================================================
   Recommendation Builders
============================================================ */

function buildForecastRecommendation(row) {
  const probability = n(row.probability);
  const opportunity = n(row.opportunity_score);
  const risk = n(row.risk_score);
  const momentum = n(row.momentum_score);
  const confidence = n(row.confidence_score);

  const type = clean(row.forecast_type || "forecast");

  let strategyType = "forecast_opportunity";
  let ownerRole = "Strategy Director";
  let timeHorizon = "7 days";

  let title = `Capitalize on ${row.entity_name || row.title}`;
  let recommendedAction =
    "Review forecast and assign operational ownership.";

  if (type.includes("decline") || risk >= 70) {
    strategyType = "risk_defense";
    ownerRole = "Risk Director";
    timeHorizon = risk >= 85 ? "24 Hours" : "72 Hours";

    title = `Defend ${row.entity_name || row.title}`;
    recommendedAction =
      "Deploy defensive messaging, reinforce coalition partners, and activate rapid response.";
  }

  if (type.includes("donor")) {
    strategyType = "donor_growth";
    ownerRole = "Finance Director";

    title = `Expand donor network around ${row.entity_name}`;
    recommendedAction =
      "Prioritize donor cultivation and assign fundraising outreach.";
  }

  if (type.includes("endorsement")) {
    strategyType = "endorsement_capture";
    ownerRole = "Political Director";

    title = `Secure endorsement pathway`;
    recommendedAction =
      "Identify strongest relationship bridge and initiate endorsement plan.";
  }

  if (type.includes("vendor")) {
    strategyType = "vendor_execution";
    ownerRole = "Operations Director";

    title = `Optimize execution resources`;
    recommendedAction =
      "Compare vendor capacity against operational gaps.";
  }

  const impact =
    clamp(
      probability * .35 +
      opportunity * .35 +
      momentum * .15 +
      confidence * .15
    );

  const urgency =
    clamp(
      risk * .45 +
      probability * .25 +
      momentum * .20 +
      (type.includes("decline") ? 15 : 0)
    );

  const feasibility =
    clamp(
      confidence * .55 +
      opportunity * .25 +
      probability * .20
    );

  const strategyScore =
    clamp(
      impact * .38 +
      urgency * .28 +
      feasibility * .22 +
      confidence * .12
    );

  return {
    recommendation_key:
      stableKey("forecast", row.prediction_key || row.id),

    source_key:
      row.prediction_key || row.id,

    source_type: "forecast",

    entity_key: row.entity_key,

    entity_type: row.entity_type,

    entity_name:
      row.entity_name || row.title,

    state: row.state,

    strategy_type: strategyType,

    priority:
      priorityFromScore(strategyScore),

    confidence_score: Math.round(confidence),

    impact_score: Math.round(impact),

    urgency_score: Math.round(urgency),

    feasibility_score: Math.round(feasibility),

    risk_score: Math.round(risk),

    strategy_score: Math.round(strategyScore),

    title,

    summary:
      row.detail ||
      `Probability ${Math.round(probability)}%, Opportunity ${Math.round(opportunity)}%, Risk ${Math.round(risk)}%.`,

    recommended_action:
      recommendedAction,

    rationale:
      `Generated from Forecast Intelligence Engine.`,

    owner_role:
      ownerRole,

    time_horizon:
      timeHorizon,

    command_center_payload: {
      state: row.state,
      entity_name: row.entity_name,
      type: strategyType,
      priority:
        priorityFromScore(strategyScore)
    },

    metadata: {
      tone:
        recommendationTone(strategyType),

      forecast_probability:
        probability,

      opportunity,

      momentum
    }
  };
}

/* ============================================================
   Coalition Recommendation Builder
============================================================ */

function buildCoalitionRecommendation(row) {

  const coalition =
    n(row.coalition_score);

  const opportunity =
    n(row.opportunity_score);

  const risk =
    n(row.risk_score);

  const confidence =
    n(row.confidence_score);

  const forecast =
    n(row.forecast_probability);

  const impact =
    clamp(
      coalition*.40+
      opportunity*.30+
      forecast*.20+
      confidence*.10
    );

  const urgency =
    clamp(
      risk*.35+
      forecast*.25+
      coalition*.25+
      opportunity*.15
    );

  const feasibility =
    clamp(
      confidence*.40+
      coalition*.35+
      opportunity*.25
    );

  const score =
    clamp(
      impact*.40+
      urgency*.25+
      feasibility*.25+
      confidence*.10
    );

  return {

    recommendation_key:
      stableKey("coalition",row.coalition_key||row.id),

    source_key:
      row.coalition_key,

    source_type:"coalition",

    entity_key:
      row.lead_entity_key,

    entity_type:
      row.coalition_type,

    entity_name:
      row.coalition_name,

    state:
      row.state,

    strategy_type:
      "coalition_activation",

    priority:
      priorityFromScore(score),

    confidence_score:
      Math.round(confidence),

    impact_score:
      Math.round(impact),

    urgency_score:
      Math.round(urgency),

    feasibility_score:
      Math.round(feasibility),

    risk_score:
      Math.round(risk),

    strategy_score:
      Math.round(score),

    title:
      `Activate Coalition ${row.coalition_name}`,

    summary:
      `${row.coalition_name} Coalition Score ${Math.round(coalition)}%.`,

    recommended_action:
      row.recommended_action ||
      "Assign coalition manager and execute engagement campaign.",

    rationale:
      "Generated from Coalition Intelligence Engine.",

    owner_role:
      "Coalition Director",

    time_horizon:
      score>=85 ? "24 Hours" : "7 Days",

    command_center_payload:{
      state:row.state,
      coalition_key:row.coalition_key
    },

    metadata:{
      tone:
        recommendationTone("coalition"),
      entity_count:
        row.entity_count,
      relationship_count:
        row.relationship_count
    }

  };

}

/* ============================================================
   Influence Recommendation Builder
============================================================ */

function buildInfluenceRecommendation(row){

  const influence=n(row.influence_score);
  const centrality=n(row.centrality_score);
  const reach=n(row.reach_score);
  const momentum=n(row.momentum_score);
  const risk=n(row.risk_score);
  const connections=n(row.total_connections);

  const impact=
    clamp(
      influence*.35+
      centrality*.25+
      reach*.25+
      Math.min(15,connections)
    );

  const urgency=
    clamp(
      momentum*.30+
      risk*.35+
      influence*.20+
      centrality*.15
    );

  const feasibility=
    clamp(
      centrality*.35+
      reach*.25+
      Math.min(30,connections*3)+
      influence*.10
    );

  const confidence=
    clamp(
      45+
      Math.min(35,connections*4)+
      Math.min(20,n(row.source_count)*5)
    );

  const strategyScore=
    clamp(
      impact*.38+
      urgency*.22+
      feasibility*.25+
      confidence*.15
    );

  let strategyType="relationship_growth";
  let ownerRole="Political Director";

  if(row.entity_type==="candidate"){
      strategyType="candidate_positioning";
      ownerRole="Campaign Director";
  }

  if(row.entity_type==="donor"){
      strategyType="donor_growth";
      ownerRole="Finance Director";
  }

  if(row.entity_type==="vendor"){
      strategyType="vendor_execution";
      ownerRole="Operations Director";
  }

  if(
      row.entity_type==="organization" ||
      row.entity_type==="endorsement"
  ){
      strategyType="endorsement_capture";
      ownerRole="Political Director";
  }

  return{

      recommendation_key:
          stableKey("influence",row.entity_key),

      source_key:
          row.entity_key,

      source_type:
          "influence",

      entity_key:
          row.entity_key,

      entity_type:
          row.entity_type,

      entity_name:
          row.entity_name,

      state:
          row.state,

      strategy_type:
          strategyType,

      priority:
          priorityFromScore(strategyScore),

      confidence_score:
          Math.round(confidence),

      impact_score:
          Math.round(impact),

      urgency_score:
          Math.round(urgency),

      feasibility_score:
          Math.round(feasibility),

      risk_score:
          Math.round(risk),

      strategy_score:
          Math.round(strategyScore),

      title:
          `Develop Strategic Relationship: ${row.entity_name}`,

      summary:
          `${row.entity_name} Influence ${Math.round(influence)}%, Centrality ${Math.round(centrality)}%, Reach ${Math.round(reach)}%.`,

      recommended_action:
          `Assign ${row.entity_name} to ${ownerRole} for relationship expansion.`,

      rationale:
          "Generated from Influence Intelligence Engine.",

      owner_role:
          ownerRole,

      time_horizon:
          strategyScore>=85 ? "48 Hours":"7 Days",

      command_center_payload:{
          state:row.state,
          entity_name:row.entity_name,
          priority:priorityFromScore(strategyScore)
      },

      metadata:{
          tone:
              recommendationTone(strategyType),
          influence,
          centrality,
          reach,
          connections
      }

  };

}

/* ============================================================
   Persistence Layer
============================================================ */

async function persistRecommendation(client, item) {
  await client.query(
    `
      INSERT INTO strategy_recommendations (
        recommendation_key,
        source_key,
        source_type,
        entity_key,
        entity_type,
        entity_name,
        state,
        strategy_type,
        priority,
        confidence_score,
        impact_score,
        urgency_score,
        feasibility_score,
        risk_score,
        strategy_score,
        title,
        summary,
        recommended_action,
        rationale,
        owner_role,
        time_horizon,
        command_center_payload,
        metadata,
        updated_at,
        calculated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22::jsonb,$23::jsonb,NOW(),NOW()
      )
      ON CONFLICT (recommendation_key)
      DO UPDATE SET
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
      item.recommendation_key,
      item.source_key,
      item.source_type,
      item.entity_key,
      item.entity_type,
      item.entity_name,
      item.state,
      item.strategy_type,
      item.priority,
      item.confidence_score,
      item.impact_score,
      item.urgency_score,
      item.feasibility_score,
      item.risk_score,
      item.strategy_score,
      item.title,
      item.summary,
      item.recommended_action,
      item.rationale,
      item.owner_role,
      item.time_horizon,
      JSON.stringify(item.command_center_payload || {}),
      JSON.stringify(item.metadata || {}),
    ]
  );
}

function dedupeRecommendations(items = []) {
  const unique = new Map();

  for (const item of items) {
    if (!item?.recommendation_key) continue;

    const existing = unique.get(item.recommendation_key);

    if (!existing || n(item.strategy_score) > n(existing.strategy_score)) {
      unique.set(item.recommendation_key, item);
    }
  }

  return [...unique.values()].sort((a, b) => n(b.strategy_score) - n(a.strategy_score));
}

/* ============================================================
   Data Loaders
============================================================ */

async function loadForecastRows(client) {
  const result = await client.query(`
    SELECT *
    FROM influence_predictions
    WHERE status = 'active'
    ORDER BY probability DESC, opportunity_score DESC
    LIMIT 250
  `);

  return result.rows;
}

async function loadCoalitionRows(client) {
  const result = await client.query(`
    SELECT *
    FROM coalition_intelligence
    WHERE status = 'active'
    ORDER BY coalition_score DESC, opportunity_score DESC
    LIMIT 250
  `);

  return result.rows;
}

async function loadInfluenceRows(client) {
  const result = await client.query(`
    SELECT *
    FROM influence_entities
    WHERE influence_score >= 45
    ORDER BY influence_score DESC, centrality_score DESC
    LIMIT 350
  `);

  return result.rows;
}

/* ============================================================
   Recalculation Engine
============================================================ */

export async function recalculateStrategyRecommendations() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await ensureStrategySchema(client);

    const forecastRows = await loadForecastRows(client);
    const coalitionRows = await loadCoalitionRows(client);
    const influenceRows = await loadInfluenceRows(client);

    const recommendations = [
      ...forecastRows.map(buildForecastRecommendation),
      ...coalitionRows.map(buildCoalitionRecommendation),
      ...influenceRows.map(buildInfluenceRecommendation),
    ];

    const sorted = dedupeRecommendations(recommendations);

    for (const recommendation of sorted) {
      await persistRecommendation(client, recommendation);
    }

    await client.query("COMMIT");

    return {
      ok: true,
      summary: {
        recommendations: sorted.length,
        critical: sorted.filter((item) => item.priority === "critical").length,
        high: sorted.filter((item) => item.priority === "high").length,
        medium: sorted.filter((item) => item.priority === "medium").length,
        low: sorted.filter((item) => item.priority === "low").length,
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

/* ============================================================
   Public Query Functions
============================================================ */

export async function getStrategySummary() {
  await ensureStrategySchema(pool);

  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_recommendations,
      COUNT(*) FILTER (WHERE priority = 'critical')::int AS critical_recommendations,
      COUNT(*) FILTER (WHERE priority = 'high')::int AS high_recommendations,
      COUNT(*) FILTER (WHERE priority = 'medium')::int AS medium_recommendations,
      COUNT(*) FILTER (WHERE priority = 'low')::int AS low_recommendations,
      COUNT(DISTINCT state)::int AS states_covered,
      ROUND(AVG(strategy_score), 2) AS avg_strategy_score,
      MAX(strategy_score) AS top_strategy_score
    FROM strategy_recommendations
    WHERE status = 'active'
  `);

  const byType = await pool.query(`
    SELECT
      strategy_type,
      COUNT(*)::int AS count,
      ROUND(AVG(strategy_score), 2) AS avg_score,
      MAX(strategy_score) AS top_score
    FROM strategy_recommendations
    WHERE status = 'active'
    GROUP BY strategy_type
    ORDER BY top_score DESC NULLS LAST
  `);

  const byState = await pool.query(`
    SELECT
      state,
      COUNT(*)::int AS recommendations,
      ROUND(AVG(strategy_score), 2) AS avg_score,
      MAX(strategy_score) AS top_score
    FROM strategy_recommendations
    WHERE status = 'active'
    AND state IS NOT NULL
    GROUP BY state
    ORDER BY top_score DESC NULLS LAST
  `);

  const byPriority = await pool.query(`
    SELECT
      priority,
      COUNT(*)::int AS count,
      ROUND(AVG(strategy_score), 2) AS avg_score,
      MAX(strategy_score) AS top_score
    FROM strategy_recommendations
    WHERE status = 'active'
    GROUP BY priority
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END
  `);

  return {
    summary: summary.rows[0] || {},
    by_type: byType.rows,
    by_state: byState.rows,
    by_priority: byPriority.rows,
  };
}

export async function getStrategyRecommendations({
  state = "",
  type = "",
  priority = "",
  limit = 75,
} = {}) {
  await ensureStrategySchema(pool);

  const params = [];
  const where = [`status = 'active'`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  if (type) {
    params.push(String(type).toLowerCase());
    where.push(`strategy_type = $${params.length}`);
  }

  if (priority) {
    params.push(String(priority).toLowerCase());
    where.push(`priority = $${params.length}`);
  }

  params.push(Math.min(300, Math.max(1, n(limit, 75))));

  const result = await pool.query(
    `
      SELECT *
      FROM strategy_recommendations
      WHERE ${where.join(" AND ")}
      ORDER BY strategy_score DESC, urgency_score DESC, impact_score DESC
      LIMIT $${params.length}
    `,
    params
  );

  return {
    results: result.rows,
    count: result.rows.length,
  };
}

export async function getStrategyDetail({ key = "" } = {}) {
  await ensureStrategySchema(pool);

  const result = await pool.query(
    `
      SELECT *
      FROM strategy_recommendations
      WHERE recommendation_key = $1
      LIMIT 1
    `,
    [key]
  );

  return {
    recommendation: result.rows[0] || null,
  };
}

/* ============================================================
   Command Center Conversion Queue
============================================================ */

export async function queueStrategyAction({ recommendationKey = "" } = {}) {
  await ensureStrategySchema(pool);

  const result = await pool.query(
    `
      SELECT *
      FROM strategy_recommendations
      WHERE recommendation_key = $1
      LIMIT 1
    `,
    [recommendationKey]
  );

  const recommendation = result.rows[0];

  if (!recommendation) {
    return {
      ok: false,
      error: "Strategy recommendation not found.",
    };
  }

  const conversionKey = stableKey(
    "strategy_conversion",
    recommendation.recommendation_key
  );

  const payload = {
    ...(recommendation.command_center_payload || {}),
    recommendation_key: recommendation.recommendation_key,
    strategy_type: recommendation.strategy_type,
    priority: recommendation.priority,
    state: recommendation.state,
    title: recommendation.title,
    detail: recommendation.recommended_action || recommendation.summary,
    owner_role: recommendation.owner_role,
    time_horizon: recommendation.time_horizon,
    source: "strategy-engine",
  };

  await pool.query(
    `
      INSERT INTO strategy_action_conversions (
        conversion_key,
        recommendation_key,
        state,
        status,
        payload,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
      ON CONFLICT (conversion_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        payload = EXCLUDED.payload,
        updated_at = NOW()
    `,
    [
      conversionKey,
      recommendation.recommendation_key,
      recommendation.state,
      "queued",
      JSON.stringify(payload),
    ]
  );

  return {
    ok: true,
    conversion_key: conversionKey,
    recommendation_key: recommendation.recommendation_key,
    payload,
  };
}

/* ============================================================
   Lightweight Health Check
============================================================ */

export async function getStrategyHealth() {
  await ensureStrategySchema(pool);

  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS recommendation_count,
      MAX(updated_at) AS last_updated
    FROM strategy_recommendations
  `);

  return {
    ok: true,
    service: "strategy-recommendation-engine",
    recommendation_count: result.rows[0]?.recommendation_count || 0,
    last_updated: result.rows[0]?.last_updated || null,
    timestamp: new Date().toISOString(),
  };
}
