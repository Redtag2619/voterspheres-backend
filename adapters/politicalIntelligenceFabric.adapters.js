import { pool } from "../db/pool.js";

 

const clean = (value = "") => String(value ?? "").trim();

const upperState = (value = "") => clean(value).slice(0, 2).toUpperCase();

 

async function safeQuery(sql, params = [], source = "unknown") {

  try {

    const result = await pool.query(sql, params);

    return { source, rows: result.rows, ok: true, error: null };

  } catch (error) {

    console.warn(`[PoliticalFabric] ${source} unavailable:`, error.message);

    return { source, rows: [], ok: false, error: error.message };

  }

}

 

function scopeClause(scope, startIndex = 2, column = "state_code") {

  const state = upperState(scope?.state_code || scope?.scope_value);

  if (!state) return { sql: "", params: [] };

  return { sql: ` AND UPPER(${column}) = $${startIndex}`, params: [state] };

}

 

export async function readCandidateSignals({ workspaceId, scope = {}, limit = 100 }) {

  const scoped = scopeClause(scope, 2, "state");

  return safeQuery(

    `SELECT id, name, party, office, state, district,

            COALESCE(status, 'active') AS status,

            COALESCE(total_raised, 0) AS total_raised,

            COALESCE(cash_on_hand, 0) AS cash_on_hand,

            updated_at

       FROM candidates

      WHERE workspace_id = $1 ${scoped.sql}

      ORDER BY updated_at DESC NULLS LAST

      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 500))}`,

    [workspaceId, ...scoped.params],

    "candidates"

  );

}

 

export async function readTaskSignals({ workspaceId, scope = {}, limit = 150 }) {

  const scoped = scopeClause(scope, 2, "state");

  return safeQuery(

    `SELECT id, title, status, priority, state, due_date, vendor_id,

            created_at, updated_at

       FROM tasks

      WHERE workspace_id = $1 ${scoped.sql}

      ORDER BY

        CASE LOWER(COALESCE(priority, 'medium'))

          WHEN 'critical' THEN 1 WHEN 'high' THEN 2

          WHEN 'medium' THEN 3 ELSE 4 END,

        due_date ASC NULLS LAST

      LIMIT ${Math.max(1, Math.min(Number(limit) || 150, 500))}`,

    [workspaceId, ...scoped.params],

    "tasks"

  );

}

 

export async function readVendorSignals({ workspaceId, scope = {}, limit = 100 }) {

  const state = upperState(scope?.state_code || scope?.scope_value);

  const stateSql = state

    ? ` AND (

          UPPER(COALESCE(state, '')) = $2

          OR COALESCE(states::text, '') ILIKE '%' || $2 || '%'

        )`

    : "";

  return safeQuery(

    `SELECT id, name, category, state, states, status,

            COALESCE(coverage_score, 0) AS coverage_score,

            COALESCE(tier, 'Unrated') AS tier,

            COALESCE(risk, 'Unknown') AS risk,

            updated_at

       FROM vendors

      WHERE workspace_id = $1 ${stateSql}

      ORDER BY coverage_score DESC NULLS LAST

      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 500))}`,

    state ? [workspaceId, state] : [workspaceId],

    "vendors"

  );

}

 

export async function readStrategySignals({ workspaceId, limit = 50 }) {

  return safeQuery(

    `SELECT id, title, recommendation_type, priority, confidence,

            status, rationale, state_code, created_at, updated_at

       FROM strategy_recommendations

      WHERE workspace_id = $1

      ORDER BY created_at DESC

      LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 250))}`,

    [workspaceId],

    "strategy_recommendations"

  );

}

 

export async function readDecisionSignals({ workspaceId, limit = 50 }) {

  return safeQuery(

    `SELECT id, title, decision_type, urgency, confidence,

            status, state_code, summary, created_at, updated_at

       FROM executive_decisions

      WHERE workspace_id = $1

      ORDER BY created_at DESC

      LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 250))}`,

    [workspaceId],

    "executive_decisions"

  );

}

 

export async function readStateOperationsSignals({ workspaceId, scope = {}, limit = 100 }) {

  const scoped = scopeClause(scope, 2, "state_code");

  return safeQuery(

    `SELECT state_code, state_name, readiness_score, risk_level,

            counties_total, counties_active, open_tasks,

            vendor_gaps, updated_at

       FROM state_operations_summary

      WHERE workspace_id = $1 ${scoped.sql}

      ORDER BY readiness_score ASC NULLS FIRST

      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 100))}`,

    [workspaceId, ...scoped.params],

    "state_operations_summary"

  );

}

 

export async function readInfluenceSignals({ workspaceId, limit = 100 }) {

  return safeQuery(

    `SELECT entity_type, entity_id, entity_name, state_code,

            influence_score, risk_score, momentum_score,

            updated_at

       FROM influence_scores

      WHERE workspace_id = $1

      ORDER BY influence_score DESC NULLS LAST

      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 500))}`,

    [workspaceId],

    "influence_scores"

  );

}

 

export async function readCoalitionSignals({ workspaceId, limit = 100 }) {

  return safeQuery(

    `SELECT coalition_name, state_code, support_score,

            mobilization_score, fragmentation_risk,

            member_count, updated_at

       FROM coalition_intelligence

      WHERE workspace_id = $1

      ORDER BY fragmentation_risk DESC NULLS LAST

      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 500))}`,

    [workspaceId],

    "coalition_intelligence"

  );

}

 

export async function collectPoliticalSignals({ workspaceId, scope = {} }) {

  const loaders = [

    readCandidateSignals({ workspaceId, scope }),

    readTaskSignals({ workspaceId, scope }),

    readVendorSignals({ workspaceId, scope }),

    readStrategySignals({ workspaceId }),

    readDecisionSignals({ workspaceId }),

    readStateOperationsSignals({ workspaceId, scope }),

    readInfluenceSignals({ workspaceId }),

    readCoalitionSignals({ workspaceId })

  ];

 

  const results = await Promise.all(loaders);

  const sourceHealth = Object.fromEntries(

    results.map((result) => [

      result.source,

      { ok: result.ok, count: result.rows.length, error: result.error }

    ])

  );

 

  return {

    scope,

    sourceHealth,

    sources: Object.fromEntries(results.map((result) => [result.source, result.rows])),

    collectedAt: new Date().toISOString()

  };

}
