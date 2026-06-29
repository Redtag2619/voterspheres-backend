import { pool } from "../db/pool.js";
import { ensureInfluenceSchema, syncInfluenceEngine } from "./influence.service.js";

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value)));
}

function tone(score) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "elevated";
  return "stable";
}

export async function ensureInfluenceForecastSchema(client = pool) {
  await ensureInfluenceSchema(client);

  await client.query(`
    CREATE TABLE IF NOT EXISTS influence_predictions (
      id SERIAL PRIMARY KEY,
      prediction_key TEXT UNIQUE NOT NULL,
      entity_key TEXT,
      entity_type TEXT,
      entity_name TEXT,
      state TEXT,
      forecast_type TEXT NOT NULL,
      probability NUMERIC DEFAULT 0,
      momentum_score NUMERIC DEFAULT 0,
      opportunity_score NUMERIC DEFAULT 0,
      risk_score NUMERIC DEFAULT 0,
      confidence_score NUMERIC DEFAULT 0,
      horizon_days INTEGER DEFAULT 90,
      title TEXT NOT NULL,
      detail TEXT,
      recommended_action TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'active',
      calculated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS relationship_forecasts (
      id SERIAL PRIMARY KEY,
      forecast_key TEXT UNIQUE NOT NULL,
      source_key TEXT,
      target_key TEXT,
      source_name TEXT,
      target_name TEXT,
      source_type TEXT,
      target_type TEXT,
      state TEXT,
      relationship_type TEXT,
      probability NUMERIC DEFAULT 0,
      strength_score NUMERIC DEFAULT 0,
      confidence_score NUMERIC DEFAULT 0,
      horizon_days INTEGER DEFAULT 90,
      title TEXT NOT NULL,
      detail TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'active',
      calculated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS coalition_forecasts (
      id SERIAL PRIMARY KEY,
      coalition_key TEXT UNIQUE NOT NULL,
      state TEXT,
      coalition_type TEXT,
      lead_entity_key TEXT,
      lead_entity_name TEXT,
      entity_count INTEGER DEFAULT 0,
      average_influence NUMERIC DEFAULT 0,
      coalition_score NUMERIC DEFAULT 0,
      probability NUMERIC DEFAULT 0,
      confidence_score NUMERIC DEFAULT 0,
      horizon_days INTEGER DEFAULT 90,
      title TEXT NOT NULL,
      detail TEXT,
      recommended_action TEXT,
      members JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'active',
      calculated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_predictions_state ON influence_predictions(state);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_predictions_type ON influence_predictions(forecast_type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_predictions_probability ON influence_predictions(probability DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_relationship_forecasts_state ON relationship_forecasts(state);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_coalition_forecasts_state ON coalition_forecasts(state);`);
}

function predictionForEntity(entity) {
  const influence = n(entity.influence_score);
  const centrality = n(entity.centrality_score);
  const reach = n(entity.reach_score);
  const momentum = n(entity.momentum_score);
  const risk = n(entity.risk_score);
  const connections = n(entity.total_connections);

  const growthProbability = clamp(
    influence * 0.28 + centrality * 0.2 + reach * 0.18 + momentum * 0.24 + Math.min(15, connections * 2)
  );

  const opportunityScore = clamp(
    growthProbability * 0.55 + reach * 0.25 + centrality * 0.2
  );

  const declineRisk = clamp(
    100 - growthProbability + risk * 0.18 - Math.min(12, connections)
  );

  let forecastType = "influence_growth";
  let probability = growthProbability;
  let title = `${entity.entity_name} is positioned for influence growth`;
  let recommendedAction = `Prioritize relationship development with ${entity.entity_name}.`;

  if (declineRisk >= 72 && influence < 65) {
    forecastType = "influence_decline";
    probability = declineRisk;
    title = `${entity.entity_name} may lose influence`;
    recommendedAction = `Review why ${entity.entity_name} has weak relationship momentum.`;
  } else if (entity.entity_type === "donor") {
    forecastType = "donor_migration";
    title = `${entity.entity_name} may become a donor movement signal`;
    recommendedAction = `Review donation proximity and candidate alignment for ${entity.entity_name}.`;
  } else if (entity.entity_type === "endorsement" || entity.entity_type === "organization") {
    forecastType = "endorsement_probability";
    title = `${entity.entity_name} may shape endorsement movement`;
    recommendedAction = `Identify candidates connected to ${entity.entity_name}.`;
  } else if (entity.entity_type === "vendor") {
    forecastType = "vendor_recommendation";
    title = `${entity.entity_name} may be a high-fit operating partner`;
    recommendedAction = `Compare ${entity.entity_name} against battleground operating gaps.`;
  }

  return {
    prediction_key: `${forecastType}::${entity.entity_key}`,
    entity_key: entity.entity_key,
    entity_type: entity.entity_type,
    entity_name: entity.entity_name,
    state: entity.state,
    forecast_type: forecastType,
    probability: Math.round(probability),
    momentum_score: Math.round(momentum),
    opportunity_score: Math.round(opportunityScore),
    risk_score: Math.round(risk || declineRisk),
    confidence_score: clamp(45 + Math.min(35, connections * 4) + Math.min(20, n(entity.source_count) * 5)),
    horizon_days: 90,
    title,
    detail: `${entity.entity_name} has influence ${Math.round(influence)}/100, centrality ${Math.round(centrality)}/100, reach ${Math.round(reach)}/100, and ${connections} mapped relationship connections.`,
    recommended_action: recommendedAction,
    metadata: {
      influence_score: influence,
      centrality_score: centrality,
      reach_score: reach,
      total_connections: connections,
      forecast_tone: tone(probability),
    },
  };
}

async function buildRelationshipForecasts(client, limit = 150) {
  const result = await client.query(`
    SELECT
      e.*,
      s.entity_name AS source_name,
      t.entity_name AS target_name
    FROM influence_edges e
    LEFT JOIN influence_entities s ON s.entity_key = e.source_key
    LEFT JOIN influence_entities t ON t.entity_key = e.target_key
    ORDER BY e.strength DESC, e.weight DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map((row) => {
    const probability = clamp(n(row.strength) * 0.62 + n(row.weight) * 9);

    return {
      forecast_key: `relationship::${row.source_key}::${row.target_key}::${row.relationship_type}`,
      source_key: row.source_key,
      target_key: row.target_key,
      source_name: row.source_name,
      target_name: row.target_name,
      source_type: row.source_type,
      target_type: row.target_type,
      state: row.state,
      relationship_type: row.relationship_type,
      probability: Math.round(probability),
      strength_score: Math.round(n(row.strength)),
      confidence_score: clamp(50 + n(row.weight) * 7),
      horizon_days: 90,
      title: `${row.source_name || row.source_type} → ${row.target_name || row.target_type}`,
      detail: `Relationship forecast based on ${row.relationship_type} signal strength ${Math.round(n(row.strength))}/100.`,
      metadata: {
        source_table: row.source_table,
        value: n(row.value),
      },
    };
  });
}

async function buildCoalitionForecasts(client) {
  const result = await client.query(`
    SELECT
      state,
      entity_type,
      COUNT(*)::int AS entity_count,
      ROUND(AVG(influence_score), 2) AS average_influence,
      MAX(influence_score) AS top_score
    FROM influence_entities
    WHERE state IS NOT NULL AND state <> ''
    GROUP BY state, entity_type
    HAVING COUNT(*) >= 2
    ORDER BY top_score DESC
    LIMIT 120
  `);

  const forecasts = [];

  for (const row of result.rows) {
    const members = await client.query(`
      SELECT entity_key, entity_type, entity_name, state, influence_score, total_connections
      FROM influence_entities
      WHERE state = $1 AND entity_type = $2
      ORDER BY influence_score DESC
      LIMIT 8
    `, [row.state, row.entity_type]);

    const lead = members.rows[0];
    const coalitionScore = clamp(n(row.average_influence) * 0.55 + n(row.entity_count) * 7 + n(row.top_score) * 0.25);

    forecasts.push({
      coalition_key: `coalition::${row.state}::${row.entity_type}`,
      state: row.state,
      coalition_type: row.entity_type,
      lead_entity_key: lead?.entity_key || null,
      lead_entity_name: lead?.entity_name || null,
      entity_count: row.entity_count,
      average_influence: n(row.average_influence),
      coalition_score: Math.round(coalitionScore),
      probability: Math.round(clamp(coalitionScore * 0.9)),
      confidence_score: clamp(50 + n(row.entity_count) * 5),
      horizon_days: 90,
      title: `${row.state} ${row.entity_type} coalition forming`,
      detail: `${row.state} has ${row.entity_count} ${row.entity_type} entities with average influence ${row.average_influence}/100.`,
      recommended_action: `Review ${row.state} ${row.entity_type} relationships for coalition opportunity.`,
      members: members.rows,
      metadata: {
        top_score: n(row.top_score),
      },
    });
  }

  return forecasts;
}

async function persistPredictions(client, predictions) {
  for (const item of predictions) {
    await client.query(`
      INSERT INTO influence_predictions (
        prediction_key, entity_key, entity_type, entity_name, state, forecast_type,
        probability, momentum_score, opportunity_score, risk_score, confidence_score,
        horizon_days, title, detail, recommended_action, metadata, updated_at, calculated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW(),NOW())
      ON CONFLICT (prediction_key)
      DO UPDATE SET
        entity_key = EXCLUDED.entity_key,
        entity_type = EXCLUDED.entity_type,
        entity_name = EXCLUDED.entity_name,
        state = EXCLUDED.state,
        forecast_type = EXCLUDED.forecast_type,
        probability = EXCLUDED.probability,
        momentum_score = EXCLUDED.momentum_score,
        opportunity_score = EXCLUDED.opportunity_score,
        risk_score = EXCLUDED.risk_score,
        confidence_score = EXCLUDED.confidence_score,
        horizon_days = EXCLUDED.horizon_days,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        recommended_action = EXCLUDED.recommended_action,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        calculated_at = NOW()
    `, [
      item.prediction_key,
      item.entity_key,
      item.entity_type,
      item.entity_name,
      item.state,
      item.forecast_type,
      item.probability,
      item.momentum_score,
      item.opportunity_score,
      item.risk_score,
      item.confidence_score,
      item.horizon_days,
      item.title,
      item.detail,
      item.recommended_action,
      JSON.stringify(item.metadata || {}),
    ]);
  }
}

async function persistRelationshipForecasts(client, forecasts) {
  for (const item of forecasts) {
    await client.query(`
      INSERT INTO relationship_forecasts (
        forecast_key, source_key, target_key, source_name, target_name, source_type,
        target_type, state, relationship_type, probability, strength_score,
        confidence_score, horizon_days, title, detail, metadata, updated_at, calculated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW(),NOW())
      ON CONFLICT (forecast_key)
      DO UPDATE SET
        probability = EXCLUDED.probability,
        strength_score = EXCLUDED.strength_score,
        confidence_score = EXCLUDED.confidence_score,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        calculated_at = NOW()
    `, [
      item.forecast_key,
      item.source_key,
      item.target_key,
      item.source_name,
      item.target_name,
      item.source_type,
      item.target_type,
      item.state,
      item.relationship_type,
      item.probability,
      item.strength_score,
      item.confidence_score,
      item.horizon_days,
      item.title,
      item.detail,
      JSON.stringify(item.metadata || {}),
    ]);
  }
}

async function persistCoalitionForecasts(client, forecasts) {
  for (const item of forecasts) {
    await client.query(`
      INSERT INTO coalition_forecasts (
        coalition_key, state, coalition_type, lead_entity_key, lead_entity_name,
        entity_count, average_influence, coalition_score, probability,
        confidence_score, horizon_days, title, detail, recommended_action,
        members, metadata, updated_at, calculated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,NOW(),NOW())
      ON CONFLICT (coalition_key)
      DO UPDATE SET
        lead_entity_key = EXCLUDED.lead_entity_key,
        lead_entity_name = EXCLUDED.lead_entity_name,
        entity_count = EXCLUDED.entity_count,
        average_influence = EXCLUDED.average_influence,
        coalition_score = EXCLUDED.coalition_score,
        probability = EXCLUDED.probability,
        confidence_score = EXCLUDED.confidence_score,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        recommended_action = EXCLUDED.recommended_action,
        members = EXCLUDED.members,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        calculated_at = NOW()
    `, [
      item.coalition_key,
      item.state,
      item.coalition_type,
      item.lead_entity_key,
      item.lead_entity_name,
      item.entity_count,
      item.average_influence,
      item.coalition_score,
      item.probability,
      item.confidence_score,
      item.horizon_days,
      item.title,
      item.detail,
      item.recommended_action,
      JSON.stringify(item.members || []),
      JSON.stringify(item.metadata || {}),
    ]);
  }
}

export async function recalculateInfluenceForecasts({ syncFirst = false } = {}) {
  const client = await pool.connect();

  try {
    if (syncFirst) {
      await syncInfluenceEngine();
    }

    await client.query("BEGIN");
    await ensureInfluenceForecastSchema(client);

    const entities = await client.query(`
      SELECT *
      FROM influence_entities
      WHERE influence_score > 0
      ORDER BY influence_score DESC
      LIMIT 1000
    `);

    const predictions = entities.rows.map(predictionForEntity);
    const relationships = await buildRelationshipForecasts(client, 200);
    const coalitions = await buildCoalitionForecasts(client);

    await persistPredictions(client, predictions);
    await persistRelationshipForecasts(client, relationships);
    await persistCoalitionForecasts(client, coalitions);

    await client.query("COMMIT");

    return {
      ok: true,
      summary: {
        predictions: predictions.length,
        relationship_forecasts: relationships.length,
        coalition_forecasts: coalitions.length,
        calculated_at: new Date().toISOString(),
      },
      predictions: predictions.slice(0, 50),
      relationships: relationships.slice(0, 50),
      coalitions: coalitions.slice(0, 50),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getInfluenceForecast({ state = "", type = "", limit = 50 } = {}) {
  await ensureInfluenceForecastSchema(pool);

  const params = [];
  const where = [`status = 'active'`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  if (type) {
    params.push(String(type).toLowerCase());
    where.push(`forecast_type = $${params.length}`);
  }

  params.push(Math.min(250, Math.max(1, n(limit, 50))));

  const predictions = await pool.query(`
    SELECT *
    FROM influence_predictions
    WHERE ${where.join(" AND ")}
    ORDER BY probability DESC, opportunity_score DESC
    LIMIT $${params.length}
  `, params);

  const relationships = await pool.query(`
    SELECT *
    FROM relationship_forecasts
    ${state ? "WHERE state = $1" : ""}
    ORDER BY probability DESC, strength_score DESC
    LIMIT 50
  `, state ? [String(state).toUpperCase()] : []);

  const coalitions = await pool.query(`
    SELECT *
    FROM coalition_forecasts
    ${state ? "WHERE state = $1" : ""}
    ORDER BY probability DESC, coalition_score DESC
    LIMIT 50
  `, state ? [String(state).toUpperCase()] : []);

  return {
    predictions: predictions.rows,
    relationships: relationships.rows,
    coalitions: coalitions.rows,
    count: predictions.rows.length,
  };
}

export async function getInfluenceOpportunities({ state = "", limit = 50 } = {}) {
  await ensureInfluenceForecastSchema(pool);

  const params = [];
  const where = [`status = 'active'`, `opportunity_score >= 55`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  params.push(Math.min(200, Math.max(1, n(limit, 50))));

  const result = await pool.query(`
    SELECT *
    FROM influence_predictions
    WHERE ${where.join(" AND ")}
    ORDER BY opportunity_score DESC, probability DESC
    LIMIT $${params.length}
  `, params);

  return { opportunities: result.rows, count: result.rows.length };
}

export async function getInfluenceRisk({ state = "", limit = 50 } = {}) {
  await ensureInfluenceForecastSchema(pool);

  const params = [];
  const where = [`status = 'active'`, `risk_score >= 50`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  params.push(Math.min(200, Math.max(1, n(limit, 50))));

  const result = await pool.query(`
    SELECT *
    FROM influence_predictions
    WHERE ${where.join(" AND ")}
    ORDER BY risk_score DESC, probability DESC
    LIMIT $${params.length}
  `, params);

  return { risks: result.rows, count: result.rows.length };
}

export async function getInfluenceMomentum({ state = "", limit = 50 } = {}) {
  await ensureInfluenceForecastSchema(pool);

  const params = [];
  const where = [`status = 'active'`, `momentum_score >= 40`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  params.push(Math.min(200, Math.max(1, n(limit, 50))));

  const result = await pool.query(`
    SELECT *
    FROM influence_predictions
    WHERE ${where.join(" AND ")}
    ORDER BY momentum_score DESC, probability DESC
    LIMIT $${params.length}
  `, params);

  return { momentum: result.rows, count: result.rows.length };
}
