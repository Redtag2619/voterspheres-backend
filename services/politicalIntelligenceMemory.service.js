import { pool } from "../db/pool.js";

 

const clean = (value = "") => String(value ?? "").trim();

 

export async function savePoliticalBrief({

  workspaceId,

  userId,

  title,

  scopeType = "national",

  scopeValue = null,

  timeHorizon = "30d",

  executiveSummary = "",

  findings = [],

  risks = [],

  opportunities = [],

  recommendedActions = [],

  evidence = [],

  metadata = {}

}) {

  const result = await pool.query(

    `INSERT INTO political_intelligence_briefs (

       workspace_id, created_by, title, scope_type, scope_value,

       time_horizon, executive_summary, findings, risks,

       opportunities, recommended_actions, evidence, metadata

     ) VALUES (

       $1, $2, $3, $4, $5, $6, $7,

       $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,

       $12::jsonb, $13::jsonb

     )

     RETURNING *`,

    [

      workspaceId,

      userId || null,

      clean(title) || "Political Intelligence Brief",

      clean(scopeType) || "national",

      clean(scopeValue) || null,

      clean(timeHorizon) || "30d",

      executiveSummary,

      JSON.stringify(findings),

      JSON.stringify(risks),

      JSON.stringify(opportunities),

      JSON.stringify(recommendedActions),

      JSON.stringify(evidence),

      JSON.stringify(metadata)

    ]

  );

  return result.rows[0];

}

 

export async function listPoliticalBriefs({ workspaceId, limit = 25 }) {

  const result = await pool.query(

    `SELECT id, title, scope_type, scope_value, time_horizon,

            status, executive_summary, generated_at, created_at

       FROM political_intelligence_briefs

      WHERE workspace_id = $1

      ORDER BY created_at DESC

      LIMIT $2`,

    [workspaceId, Math.max(1, Math.min(Number(limit) || 25, 100))]

  );

  return result.rows;

}

 

export async function getPoliticalBrief({ workspaceId, briefId }) {

  const result = await pool.query(

    `SELECT *

       FROM political_intelligence_briefs

      WHERE workspace_id = $1 AND id = $2

      LIMIT 1`,

    [workspaceId, briefId]

  );

  return result.rows[0] || null;

}

 

export async function saveSnapshot({

  workspaceId,

  briefId = null,

  scanKey,

  scopeType,

  scopeValue = null,

  signalCount = 0,

  sourceHealth = {},

  payload = {}

}) {

  const result = await pool.query(

    `INSERT INTO political_intelligence_snapshots (

       workspace_id, brief_id, scan_key, scope_type, scope_value,

       signal_count, source_health, payload

     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)

     RETURNING id, captured_at`,

    [

      workspaceId,

      briefId,

      clean(scanKey),

      clean(scopeType) || "national",

      clean(scopeValue) || null,

      Number(signalCount) || 0,

      JSON.stringify(sourceHealth),

      JSON.stringify(payload)

    ]

  );

  return result.rows[0];

}

 

export async function listWatchlist({ workspaceId, status = "active" }) {

  const result = await pool.query(

    `SELECT *

       FROM political_intelligence_watchlist

      WHERE workspace_id = $1

        AND ($2 = 'all' OR status = $2)

      ORDER BY

        CASE priority

          WHEN 'critical' THEN 1 WHEN 'high' THEN 2

          WHEN 'medium' THEN 3 ELSE 4 END,

        updated_at DESC`,

    [workspaceId, clean(status) || "active"]

  );

  return result.rows;

}

 

export async function upsertWatchlist({

  workspaceId,

  userId,

  entityType,

  entityId = null,

  entityName,

  stateCode = null,

  priority = "medium",

  status = "active",

  rationale = "",

  thresholds = {},

  tags = []

}) {

  const normalizedId = clean(entityId) || clean(entityName).toLowerCase();

  const result = await pool.query(

    `INSERT INTO political_intelligence_watchlist (

       workspace_id, created_by, entity_type, entity_id, entity_name,

       state_code, priority, status, rationale, thresholds, tags

     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)

     ON CONFLICT (workspace_id, entity_type, entity_id)

     DO UPDATE SET

       entity_name = EXCLUDED.entity_name,

       state_code = EXCLUDED.state_code,

       priority = EXCLUDED.priority,

       status = EXCLUDED.status,

       rationale = EXCLUDED.rationale,

       thresholds = EXCLUDED.thresholds,

       tags = EXCLUDED.tags,

       updated_at = NOW()

     RETURNING *`,

    [

      workspaceId,

      userId || null,

      clean(entityType),

      normalizedId,

      clean(entityName),

      clean(stateCode).slice(0, 2).toUpperCase() || null,

      clean(priority).toLowerCase() || "medium",

      clean(status).toLowerCase() || "active",

      rationale,

      JSON.stringify(thresholds),

      JSON.stringify(tags)

    ]

  );

  return result.rows[0];

}

 

export async function deleteWatchlist({ workspaceId, watchlistId }) {

  const result = await pool.query(

    `DELETE FROM political_intelligence_watchlist

      WHERE workspace_id = $1 AND id = $2

      RETURNING id`,

    [workspaceId, watchlistId]

  );

  return Boolean(result.rows[0]);

}

 

export async function saveScenario({

  workspaceId,

  userId,

  name,

  scenarioType,

  assumptions,

  baseline,

  projectedOutcomes,

  risks,

  recommendedActions,

  confidence

}) {

  const result = await pool.query(

    `INSERT INTO political_intelligence_scenarios (

       workspace_id, created_by, name, scenario_type, assumptions,

       baseline, projected_outcomes, risks, recommended_actions, confidence

     ) VALUES (

       $1, $2, $3, $4, $5::jsonb, $6::jsonb,

       $7::jsonb, $8::jsonb, $9::jsonb, $10

     )

     RETURNING *`,

    [

      workspaceId,

      userId || null,

      clean(name) || "Political Scenario",

      clean(scenarioType) || "custom",

      JSON.stringify(assumptions || {}),

      JSON.stringify(baseline || {}),

      JSON.stringify(projectedOutcomes || []),

      JSON.stringify(risks || []),

      JSON.stringify(recommendedActions || []),

      Number(confidence) || 0

    ]

  );

  return result.rows[0];

}
