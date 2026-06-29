import { pool } from "../db/pool.js";
import { ensureInfluenceSchema } from "./influence.service.js";
import { ensureInfluenceForecastSchema } from "./influenceForecast.service.js";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"
];

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

export async function ensureCoalitionSchema(client = pool) {
  await ensureInfluenceSchema(client);
  await ensureInfluenceForecastSchema(client);

  await client.query(`
    CREATE TABLE IF NOT EXISTS coalition_intelligence (
      id SERIAL PRIMARY KEY,
      coalition_key TEXT UNIQUE NOT NULL,
      coalition_name TEXT NOT NULL,
      coalition_type TEXT NOT NULL,
      state TEXT,
      region TEXT,
      lead_entity_key TEXT,
      lead_entity_name TEXT,
      lead_entity_type TEXT,
      entity_count INTEGER DEFAULT 0,
      relationship_count INTEGER DEFAULT 0,
      average_influence NUMERIC DEFAULT 0,
      top_influence NUMERIC DEFAULT 0,
      coalition_score NUMERIC DEFAULT 0,
      cohesion_score NUMERIC DEFAULT 0,
      opportunity_score NUMERIC DEFAULT 0,
      risk_score NUMERIC DEFAULT 0,
      confidence_score NUMERIC DEFAULT 0,
      forecast_probability NUMERIC DEFAULT 0,
      recommended_action TEXT,
      members JSONB DEFAULT '[]'::jsonb,
      relationships JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'active',
      calculated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS coalition_actions (
      id SERIAL PRIMARY KEY,
      action_key TEXT UNIQUE NOT NULL,
      coalition_key TEXT,
      state TEXT,
      priority TEXT DEFAULT 'medium',
      action_type TEXT DEFAULT 'review',
      title TEXT NOT NULL,
      detail TEXT,
      recommended_owner TEXT DEFAULT 'Political Intelligence',
      due_label TEXT DEFAULT 'This Week',
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_coalition_intelligence_state ON coalition_intelligence(state);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_coalition_intelligence_type ON coalition_intelligence(coalition_type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_coalition_intelligence_score ON coalition_intelligence(coalition_score DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_coalition_actions_state ON coalition_actions(state);`);
}

async function membersForCluster(client, state, entityType) {
  const result = await client.query(
    `
      SELECT *
      FROM influence_entities
      WHERE state = $1
      AND entity_type = $2
      ORDER BY influence_score DESC, total_connections DESC
      LIMIT 12
    `,
    [state, entityType]
  );

  return result.rows;
}

async function relationshipsForMembers(client, members = []) {
  const keys = members.map((member) => member.entity_key).filter(Boolean);
  if (!keys.length) return [];

  const result = await client.query(
    `
      SELECT
        e.*,
        s.entity_name AS source_name,
        t.entity_name AS target_name
      FROM influence_edges e
      LEFT JOIN influence_entities s ON s.entity_key = e.source_key
      LEFT JOIN influence_entities t ON t.entity_key = e.target_key
      WHERE e.source_key = ANY($1)
      OR e.target_key = ANY($1)
      ORDER BY e.strength DESC, e.weight DESC
      LIMIT 40
    `,
    [keys]
  );

  return result.rows;
}

function buildCluster({ state, entityType, members, relationships, forecast = null }) {
  const lead = members[0] || null;
  const entityCount = members.length;
  const relationshipCount = relationships.length;

  const avgInfluence = entityCount
    ? members.reduce((sum, item) => sum + n(item.influence_score), 0) / entityCount
    : 0;

  const topInfluence = members.length
    ? Math.max(...members.map((item) => n(item.influence_score)))
    : 0;

  const avgConnections = entityCount
    ? members.reduce((sum, item) => sum + n(item.total_connections), 0) / entityCount
    : 0;

  const cohesion = clamp(relationshipCount * 5 + avgConnections * 4);
  const opportunity = clamp(avgInfluence * 0.4 + topInfluence * 0.25 + cohesion * 0.25 + entityCount * 3);
  const risk = clamp((100 - cohesion) * 0.22 + topInfluence * 0.25 + relationshipCount * 2);
  const forecastProbability = clamp(n(forecast?.probability, opportunity * 0.85));
  const score = clamp(avgInfluence * 0.35 + cohesion * 0.25 + opportunity * 0.25 + forecastProbability * 0.15);
  const confidence = clamp(45 + entityCount * 4 + relationshipCount * 2 + (forecast ? 12 : 0));

  const coalitionName = `${state} ${entityType} coalition`;

  return {
    coalition_key: stableKey("coalition", state, entityType),
    coalition_name: coalitionName,
    coalition_type: entityType,
    state,
    region: null,
    lead_entity_key: lead?.entity_key || null,
    lead_entity_name: lead?.entity_name || null,
    lead_entity_type: lead?.entity_type || null,
    entity_count: entityCount,
    relationship_count: relationshipCount,
    average_influence: Number(avgInfluence.toFixed(2)),
    top_influence: Math.round(topInfluence),
    coalition_score: Math.round(score),
    cohesion_score: Math.round(cohesion),
    opportunity_score: Math.round(opportunity),
    risk_score: Math.round(risk),
    confidence_score: Math.round(confidence),
    forecast_probability: Math.round(forecastProbability),
    recommended_action:
      score >= 80
        ? `Activate ${coalitionName}: assign outreach owner, map members, and convert the coalition into Command Center action.`
        : score >= 60
          ? `Monitor and develop ${coalitionName}: identify the top bridge entity and pursue coalition-building conversations.`
          : `Keep ${coalitionName} on watch: relationship density is still forming.`,
    members: members.map((item) => ({
      entity_key: item.entity_key,
      entity_type: item.entity_type,
      entity_name: item.entity_name,
      state: item.state,
      influence_score: n(item.influence_score),
      centrality_score: n(item.centrality_score),
      reach_score: n(item.reach_score),
      total_connections: n(item.total_connections),
    })),
    relationships: relationships.map((item) => ({
      source_key: item.source_key,
      target_key: item.target_key,
      source_name: item.source_name,
      target_name: item.target_name,
      relationship_type: item.relationship_type,
      strength: n(item.strength),
      weight: n(item.weight),
      source_table: item.source_table,
    })),
    metadata: {
      generated_from: "influence_entities",
      forecast_key: forecast?.coalition_key || null,
    },
  };
}

async function persistCoalition(client, coalition) {
  await client.query(
    `
      INSERT INTO coalition_intelligence (
        coalition_key, coalition_name, coalition_type, state, region,
        lead_entity_key, lead_entity_name, lead_entity_type,
        entity_count, relationship_count, average_influence, top_influence,
        coalition_score, cohesion_score, opportunity_score, risk_score,
        confidence_score, forecast_probability, recommended_action,
        members, relationships, metadata, updated_at, calculated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20::jsonb,$21::jsonb,$22::jsonb,NOW(),NOW()
      )
      ON CONFLICT (coalition_key)
      DO UPDATE SET
        coalition_name = EXCLUDED.coalition_name,
        coalition_type = EXCLUDED.coalition_type,
        state = EXCLUDED.state,
        region = EXCLUDED.region,
        lead_entity_key = EXCLUDED.lead_entity_key,
        lead_entity_name = EXCLUDED.lead_entity_name,
        lead_entity_type = EXCLUDED.lead_entity_type,
        entity_count = EXCLUDED.entity_count,
        relationship_count = EXCLUDED.relationship_count,
        average_influence = EXCLUDED.average_influence,
        top_influence = EXCLUDED.top_influence,
        coalition_score = EXCLUDED.coalition_score,
        cohesion_score = EXCLUDED.cohesion_score,
        opportunity_score = EXCLUDED.opportunity_score,
        risk_score = EXCLUDED.risk_score,
        confidence_score = EXCLUDED.confidence_score,
        forecast_probability = EXCLUDED.forecast_probability,
        recommended_action = EXCLUDED.recommended_action,
        members = EXCLUDED.members,
        relationships = EXCLUDED.relationships,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        calculated_at = NOW()
    `,
    [
      coalition.coalition_key,
      coalition.coalition_name,
      coalition.coalition_type,
      coalition.state,
      coalition.region,
      coalition.lead_entity_key,
      coalition.lead_entity_name,
      coalition.lead_entity_type,
      coalition.entity_count,
      coalition.relationship_count,
      coalition.average_influence,
      coalition.top_influence,
      coalition.coalition_score,
      coalition.cohesion_score,
      coalition.opportunity_score,
      coalition.risk_score,
      coalition.confidence_score,
      coalition.forecast_probability,
      coalition.recommended_action,
      JSON.stringify(coalition.members || []),
      JSON.stringify(coalition.relationships || []),
      JSON.stringify(coalition.metadata || {}),
    ]
  );
}

async function persistCoalitionAction(client, coalition) {
  const priority =
    coalition.coalition_score >= 85
      ? "critical"
      : coalition.coalition_score >= 70
        ? "high"
        : coalition.coalition_score >= 50
          ? "medium"
          : "low";

  await client.query(
    `
      INSERT INTO coalition_actions (
        action_key, coalition_key, state, priority, action_type,
        title, detail, recommended_owner, due_label, metadata, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
      ON CONFLICT (action_key)
      DO UPDATE SET
        priority = EXCLUDED.priority,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        recommended_owner = EXCLUDED.recommended_owner,
        due_label = EXCLUDED.due_label,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      stableKey("coalition_action", coalition.coalition_key, priority),
      coalition.coalition_key,
      coalition.state,
      priority,
      "coalition_review",
      `Review ${coalition.coalition_name}`,
      coalition.recommended_action,
      "Political Intelligence",
      priority === "critical" ? "Today" : priority === "high" ? "48 Hours" : "This Week",
      JSON.stringify({
        coalition_score: coalition.coalition_score,
        opportunity_score: coalition.opportunity_score,
        risk_score: coalition.risk_score,
        lead_entity_name: coalition.lead_entity_name,
      }),
    ]
  );
}

export async function recalculateCoalitionIntelligence() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureCoalitionSchema(client);

    const forecasts = await client.query(`
      SELECT *
      FROM coalition_forecasts
      WHERE status = 'active'
      ORDER BY probability DESC
    `);

    const forecastLookup = new Map(
      forecasts.rows.map((forecast) => [`${forecast.state}::${forecast.coalition_type}`, forecast])
    );

    const clusters = [];

    for (const state of STATES) {
      const entityTypes = await client.query(
        `
          SELECT entity_type, COUNT(*)::int AS count
          FROM influence_entities
          WHERE state = $1
          AND entity_type NOT IN ('state')
          GROUP BY entity_type
          HAVING COUNT(*) >= 2
          ORDER BY count DESC
        `,
        [state]
      );

      for (const row of entityTypes.rows) {
        const entityType = row.entity_type;
        const members = await membersForCluster(client, state, entityType);

        if (members.length < 2) continue;

        const relationships = await relationshipsForMembers(client, members);
        const forecast = forecastLookup.get(`${state}::${entityType}`) || null;

        const coalition = buildCluster({
          state,
          entityType,
          members,
          relationships,
          forecast,
        });

        clusters.push(coalition);

        await persistCoalition(client, coalition);

        if (coalition.coalition_score >= 50) {
          await persistCoalitionAction(client, coalition);
        }
      }
    }

    await client.query("COMMIT");

    const sorted = clusters.sort((a, b) => b.coalition_score - a.coalition_score);

    return {
      ok: true,
      summary: {
        coalitions: sorted.length,
        high_value: sorted.filter((item) => item.coalition_score >= 70).length,
        critical: sorted.filter((item) => item.coalition_score >= 85).length,
        states_covered: new Set(sorted.map((item) => item.state)).size,
        calculated_at: new Date().toISOString(),
      },
      coalitions: sorted.slice(0, 75),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCoalitionSummary() {
  await ensureCoalitionSchema(pool);

  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_coalitions,
      COUNT(*) FILTER (WHERE coalition_score >= 85)::int AS critical_coalitions,
      COUNT(*) FILTER (WHERE coalition_score >= 70)::int AS high_value_coalitions,
      COUNT(DISTINCT state)::int AS states_covered,
      ROUND(AVG(coalition_score), 2) AS avg_coalition_score,
      MAX(coalition_score) AS top_coalition_score
    FROM coalition_intelligence
    WHERE status = 'active'
  `);

  const byType = await pool.query(`
    SELECT
      coalition_type,
      COUNT(*)::int AS count,
      ROUND(AVG(coalition_score), 2) AS avg_score,
      MAX(coalition_score) AS top_score
    FROM coalition_intelligence
    WHERE status = 'active'
    GROUP BY coalition_type
    ORDER BY top_score DESC NULLS LAST
  `);

  const byState = await pool.query(`
    SELECT
      state,
      COUNT(*)::int AS coalitions,
      ROUND(AVG(coalition_score), 2) AS avg_score,
      MAX(coalition_score) AS top_score
    FROM coalition_intelligence
    WHERE status = 'active'
    GROUP BY state
    ORDER BY top_score DESC NULLS LAST
  `);

  return {
    summary: summary.rows[0] || {},
    by_type: byType.rows,
    by_state: byState.rows,
  };
}

export async function getCoalitionRankings({ state = "", type = "", limit = 50 } = {}) {
  await ensureCoalitionSchema(pool);

  const params = [];
  const where = [`status = 'active'`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  if (type) {
    params.push(String(type).toLowerCase());
    where.push(`coalition_type = $${params.length}`);
  }

  params.push(Math.min(250, Math.max(1, n(limit, 50))));

  const result = await pool.query(
    `
      SELECT *
      FROM coalition_intelligence
      WHERE ${where.join(" AND ")}
      ORDER BY coalition_score DESC, opportunity_score DESC, forecast_probability DESC
      LIMIT $${params.length}
    `,
    params
  );

  return {
    results: result.rows,
    count: result.rows.length,
  };
}

export async function getCoalitionActions({ state = "", priority = "", limit = 50 } = {}) {
  await ensureCoalitionSchema(pool);

  const params = [];
  const where = [`status = 'open'`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  if (priority) {
    params.push(String(priority).toLowerCase());
    where.push(`LOWER(priority) = $${params.length}`);
  }

  params.push(Math.min(200, Math.max(1, n(limit, 50))));

  const result = await pool.query(
    `
      SELECT *
      FROM coalition_actions
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return {
    actions: result.rows,
    count: result.rows.length,
  };
}

export async function getCoalitionDetail({ coalitionKey = "" } = {}) {
  await ensureCoalitionSchema(pool);

  const coalition = await pool.query(
    `
      SELECT *
      FROM coalition_intelligence
      WHERE coalition_key = $1
      LIMIT 1
    `,
    [coalitionKey]
  );

  const item = coalition.rows[0] || null;

  if (!item) {
    return {
      coalition: null,
      actions: [],
    };
  }

  const actions = await pool.query(
    `
      SELECT *
      FROM coalition_actions
      WHERE coalition_key = $1
      ORDER BY created_at DESC
      LIMIT 25
    `,
    [coalitionKey]
  );

  return {
    coalition: item,
    actions: actions.rows,
  };
}
