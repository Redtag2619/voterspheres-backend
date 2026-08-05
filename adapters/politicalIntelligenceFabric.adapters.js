import { pool } from "../db/pool.js";
 
const clean = (value = "") => String(value ?? "").trim();
const upperState = (value = "") => clean(value).slice(0, 2).toUpperCase();
const clampLimit = (value, fallback = 100, max = 500) =>
  Math.max(1, Math.min(Number(value) || fallback, max));
 
const metadataCache = new Map();
const METADATA_TTL_MS = 5 * 60 * 1000;
 
function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
 
function sourceResult({
  source,
  rows = [],
  ok = true,
  configured = true,
  degraded = false,
  error = null,
  table = null,
  details = {},
}) {
  return {
    source,
    rows,
    ok,
    configured,
    degraded,
    error,
    table,
    details,
  };
}
 
async function safeQuery(sql, params = [], source = "unknown") {
  try {
    const result = await pool.query(sql, params);
 
    return sourceResult({
      source,
      rows: result.rows,
      ok: true,
      configured: true,
      degraded: false,
    });
  } catch (error) {
    console.warn(`[PoliticalFabric] ${source} unavailable:`, {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
    });
 
    return sourceResult({
      source,
      rows: [],
      ok: false,
      configured: true,
      degraded: true,
      error: error.message,
    });
  }
}
 
async function getPublicSchemaMetadata() {
  const cached = metadataCache.get("public");
 
  if (
    cached &&
    Date.now() - cached.loadedAt < METADATA_TTL_MS
  ) {
    return cached.value;
  }
 
  const result = await pool.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
 
  const tables = new Map();
 
  for (const row of result.rows) {
    if (!tables.has(row.table_name)) {
      tables.set(row.table_name, new Map());
    }
 
    tables.get(row.table_name).set(row.column_name, {
      dataType: row.data_type,
      udtName: row.udt_name,
    });
  }
 
  const value = { tables };
 
  metadataCache.set("public", {
    loadedAt: Date.now(),
    value,
  });
 
  return value;
}
 
function findTable(metadata, candidates = []) {
  for (const candidate of candidates) {
    if (metadata.tables.has(candidate)) {
      return candidate;
    }
  }
 
  return null;
}
 
function columnsFor(metadata, table) {
  return table
    ? metadata.tables.get(table) || new Map()
    : new Map();
}
 
function firstColumn(columns, candidates = []) {
  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return candidate;
    }
  }
 
  return null;
}
 
function selectExpression(columns, candidates, alias, fallback = "NULL") {
  const column = firstColumn(columns, candidates);
 
  if (!column) {
    return `${fallback} AS ${quoteIdentifier(alias)}`;
  }
 
  return `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`;
}
 
function numericExpression(columns, candidates, alias, fallback = "0") {
  const column = firstColumn(columns, candidates);
 
  if (!column) {
    return `${fallback}::numeric AS ${quoteIdentifier(alias)}`;
  }
 
  return `COALESCE(${quoteIdentifier(column)}::numeric, ${fallback}) AS ${quoteIdentifier(alias)}`;
}

function jsonSafeNumericExpression(
  columns,
  candidates,
  alias,
  fallback = "0",
  arrayStrategy = "average"
) {
  const column = firstColumn(columns, candidates);

  if (!column) {
    return `${fallback}::numeric AS ${quoteIdentifier(alias)}`;
  }

  const field = quoteIdentifier(column);
  const aggregate =
    arrayStrategy === "max"
      ? "MAX"
      : arrayStrategy === "min"
        ? "MIN"
        : arrayStrategy === "sum"
          ? "SUM"
          : "AVG";

  return `
    COALESCE(
      CASE
        WHEN pg_typeof(${field})::text IN (
          'smallint',
          'integer',
          'bigint',
          'numeric',
          'decimal',
          'real',
          'double precision'
        )
        THEN ${field}::text::numeric

        WHEN pg_typeof(${field})::text IN ('json', 'jsonb')
        THEN CASE jsonb_typeof(${field}::jsonb)
          WHEN 'number'
          THEN (${field}::jsonb #>> '{}')::numeric

          WHEN 'string'
          THEN CASE
            WHEN (${field}::jsonb #>> '{}')
              ~ '^-?[0-9]+([.][0-9]+)?$'
            THEN (${field}::jsonb #>> '{}')::numeric
            ELSE NULL
          END

          WHEN 'object'
          THEN COALESCE(
            CASE
              WHEN (${field}::jsonb ->> 'score')
                ~ '^-?[0-9]+([.][0-9]+)?$'
              THEN (${field}::jsonb ->> 'score')::numeric
            END,
            CASE
              WHEN (${field}::jsonb ->> 'value')
                ~ '^-?[0-9]+([.][0-9]+)?$'
              THEN (${field}::jsonb ->> 'value')::numeric
            END,
            CASE
              WHEN (${field}::jsonb ->> 'average')
                ~ '^-?[0-9]+([.][0-9]+)?$'
              THEN (${field}::jsonb ->> 'average')::numeric
            END,
            CASE
              WHEN (${field}::jsonb ->> 'avg')
                ~ '^-?[0-9]+([.][0-9]+)?$'
              THEN (${field}::jsonb ->> 'avg')::numeric
            END
          )

          WHEN 'array'
          THEN (
            SELECT ${aggregate}(
              CASE
                WHEN jsonb_typeof(element) = 'number'
                THEN (element #>> '{}')::numeric

                WHEN jsonb_typeof(element) = 'string'
                  AND (element #>> '{}')
                    ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN (element #>> '{}')::numeric

                WHEN jsonb_typeof(element) = 'object'
                THEN COALESCE(
                  CASE
                    WHEN (element ->> 'score')
                      ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (element ->> 'score')::numeric
                  END,
                  CASE
                    WHEN (element ->> 'value')
                      ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (element ->> 'value')::numeric
                  END,
                  CASE
                    WHEN (element ->> 'average')
                      ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (element ->> 'average')::numeric
                  END,
                  CASE
                    WHEN (element ->> 'avg')
                      ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (element ->> 'avg')::numeric
                  END
                )

                ELSE NULL
              END
            )
            FROM jsonb_array_elements(${field}::jsonb) AS element
          )

          ELSE NULL
        END

        ELSE CASE
          WHEN ${field}::text
            ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN ${field}::text::numeric
          ELSE NULL
        END
      END,
      ${fallback}
    )::numeric AS ${quoteIdentifier(alias)}
  `;
}
 
function textExpression(columns, candidates, alias, fallback = "NULL") {
  const column = firstColumn(columns, candidates);
 
  if (!column) {
    return `${fallback} AS ${quoteIdentifier(alias)}`;
  }
 
  return `${quoteIdentifier(column)}::text AS ${quoteIdentifier(alias)}`;
}
 
function dateExpression(columns, candidates, alias) {
  const column = firstColumn(columns, candidates);
 
  return column
    ? `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`
    : `NULL::timestamptz AS ${quoteIdentifier(alias)}`;
}
 
function workspaceFilter(columns, workspaceId, params) {
  const column = firstColumn(columns, [
    "workspace_id",
    "workspaceId",
    "firm_id",
    "organization_id",
  ]);
 
  if (!column) {
    return "";
  }
 
  params.push(Number(workspaceId));
  return `${quoteIdentifier(column)} = $${params.length}`;
}
 
function stateFilter(columns, scope, params) {
  const state = upperState(
    scope?.state_code || scope?.scope_value
  );
 
  if (!state) {
    return "";
  }
 
  const scalarColumn = firstColumn(columns, [
    "state_code",
    "state",
    "jurisdiction_code",
    "jurisdiction",
  ]);
 
  if (scalarColumn) {
    params.push(state);
    return `UPPER(COALESCE(${quoteIdentifier(scalarColumn)}::text, '')) = $${params.length}`;
  }
 
  const collectionColumn = firstColumn(columns, [
    "states",
    "service_states",
    "coverage_states",
  ]);
 
  if (collectionColumn) {
    params.push(state);
    return `COALESCE(${quoteIdentifier(collectionColumn)}::text, '') ILIKE '%' || $${params.length} || '%'`;
  }
 
  return "";
}
 
function whereClause(parts = []) {
  const filtered = parts.filter(Boolean);
  return filtered.length ? `WHERE ${filtered.join(" AND ")}` : "";
}
 
function orderByExisting(columns, candidates, direction = "DESC") {
  const column = firstColumn(columns, candidates);
 
  return column
    ? `ORDER BY ${quoteIdentifier(column)} ${direction} NULLS LAST`
    : "";
}
 
async function runDynamicSource({
  source,
  tableCandidates,
  workspaceId,
  scope = {},
  limit = 100,
  maxLimit = 500,
  selectBuilder,
  extraFilters = [],
  orderByCandidates = ["updated_at", "created_at"],
  orderDirection = "DESC",
}) {
  let metadata;
 
  try {
    metadata = await getPublicSchemaMetadata();
  } catch (error) {
    return sourceResult({
      source,
      rows: [],
      ok: false,
      configured: false,
      degraded: true,
      error: `Unable to inspect PostgreSQL schema: ${error.message}`,
    });
  }
 
  const table = findTable(metadata, tableCandidates);
 
  if (!table) {
    return sourceResult({
      source,
      rows: [],
      ok: false,
      configured: false,
      degraded: true,
      error: `No supported table is available. Checked: ${tableCandidates.join(", ")}`,
      details: { checked_tables: tableCandidates },
    });
  }
 
  const columns = columnsFor(metadata, table);
  const params = [];
  const filters = [
    workspaceFilter(columns, workspaceId, params),
    stateFilter(columns, scope, params),
  ];
 
  for (const filterFactory of extraFilters) {
    const filter = filterFactory(columns, params);
    if (filter) filters.push(filter);
  }
 
  const selectList = selectBuilder(columns, table);
  const orderBy = orderByExisting(
    columns,
    orderByCandidates,
    orderDirection
  );
 
  const sql = `
    SELECT
      ${selectList.join(",\n      ")}
    FROM ${quoteIdentifier(table)}
    ${whereClause(filters)}
    ${orderBy}
    LIMIT ${clampLimit(limit, 100, maxLimit)}
  `;
 
  const result = await safeQuery(sql, params, source);
 
  return {
    ...result,
    table,
    configured: true,
    details: {
      selected_table: table,
      available_columns: [...columns.keys()],
    },
  };
}
 
export async function readCandidateSignals({
  workspaceId,
  scope = {},
  limit = 100,
}) {
  const metadata = await getPublicSchemaMetadata().catch(() => null);
  const candidateTable = metadata
    ? findTable(metadata, ["candidates", "candidate_profiles"])
    : null;
 
  if (!metadata || !candidateTable) {
    return sourceResult({
      source: "candidates",
      rows: [],
      ok: false,
      configured: false,
      degraded: true,
      error: "Candidates table is not available.",
    });
  }
 
  const candidateColumns = columnsFor(metadata, candidateTable);
  const financeTable = findTable(metadata, [
    "candidate_finance_summary",
    "candidate_finance",
    "fec_candidate_finance",
  ]);
  const financeColumns = columnsFor(metadata, financeTable);
 
  const params = [];
  const filters = [
    workspaceFilter(candidateColumns, workspaceId, params),
    stateFilter(candidateColumns, scope, params),
  ].filter(Boolean);
 
  const candidateId = firstColumn(candidateColumns, [
    "id",
    "candidate_id",
    "fec_candidate_id",
  ]);
  const financeCandidateId = firstColumn(financeColumns, [
    "candidate_id",
    "fec_candidate_id",
    "candidate_ref",
  ]);
 
  let joinSql = "";
  let raisedExpression = "0::numeric AS total_raised";
  let cashExpression = "0::numeric AS cash_on_hand";
 
  if (
    financeTable &&
    candidateId &&
    financeCandidateId
  ) {
    const financeWorkspaceColumn = firstColumn(financeColumns, [
      "workspace_id",
      "firm_id",
      "organization_id",
    ]);
 
    const joinConditions = [
      `f.${quoteIdentifier(financeCandidateId)}::text = c.${quoteIdentifier(candidateId)}::text`,
    ];
 
    if (financeWorkspaceColumn) {
      joinConditions.push(
        `f.${quoteIdentifier(financeWorkspaceColumn)} = c.${quoteIdentifier(
          firstColumn(candidateColumns, [
            "workspace_id",
            "firm_id",
            "organization_id",
          ]) || financeWorkspaceColumn
        )}`
      );
    }
 
    joinSql = `LEFT JOIN LATERAL (
      SELECT *
      FROM ${quoteIdentifier(financeTable)} f
      WHERE ${joinConditions.join(" AND ")}
      ORDER BY ${
        firstColumn(financeColumns, [
          "coverage_through_date",
          "updated_at",
          "created_at",
        ])
          ? `f.${quoteIdentifier(
              firstColumn(financeColumns, [
                "coverage_through_date",
                "updated_at",
                "created_at",
              ])
            )} DESC NULLS LAST`
          : "1"
      }
      LIMIT 1
    ) f ON TRUE`;
 
    const raisedColumn = firstColumn(financeColumns, [
      "receipts",
      "total_receipts",
      "total_raised",
    ]);
    const cashColumn = firstColumn(financeColumns, [
      "cash_on_hand",
      "cash_on_hand_end_period",
    ]);
 
    if (raisedColumn) {
      raisedExpression = `COALESCE(f.${quoteIdentifier(raisedColumn)}::numeric, 0) AS total_raised`;
    }
 
    if (cashColumn) {
      cashExpression = `COALESCE(f.${quoteIdentifier(cashColumn)}::numeric, 0) AS cash_on_hand`;
    }
  }
 
  const sql = `
    SELECT
      ${selectExpression(candidateColumns, ["id", "candidate_id"], "id", "NULL")},
      ${textExpression(candidateColumns, ["name", "candidate_name", "full_name"], "name", "'Candidate'")},
      ${textExpression(candidateColumns, ["party", "party_affiliation"], "party")},
      ${textExpression(candidateColumns, ["office", "office_sought"], "office")},
      ${textExpression(candidateColumns, ["state", "state_code"], "state")},
      ${textExpression(candidateColumns, ["district", "district_number"], "district")},
      ${textExpression(candidateColumns, ["status", "candidate_status"], "status", "'active'")},
      ${raisedExpression},
      ${cashExpression},
      ${dateExpression(candidateColumns, ["updated_at", "modified_at", "created_at"], "updated_at")}
    FROM ${quoteIdentifier(candidateTable)} c
    ${joinSql}
    ${whereClause(filters)}
    ${orderByExisting(candidateColumns, ["updated_at", "modified_at", "created_at"], "DESC")}
    LIMIT ${clampLimit(limit, 100, 500)}
  `;
 
  const result = await safeQuery(sql, params, "candidates");
 
  return {
    ...result,
    table: candidateTable,
    configured: true,
    details: {
      selected_table: candidateTable,
      finance_table: financeTable,
      finance_joined: Boolean(joinSql),
    },
  };
}
 
export async function readTaskSignals({
  workspaceId,
  scope = {},
  limit = 150,
}) {
  return runDynamicSource({
    source: "tasks",
    tableCandidates: ["tasks", "campaign_tasks", "execution_tasks"],
    workspaceId,
    scope,
    limit,
    maxLimit: 500,
    selectBuilder: (columns) => [
      selectExpression(columns, ["id", "task_id"], "id", "NULL"),
      textExpression(columns, ["title", "name", "task_name"], "title", "'Task'"),
      textExpression(columns, ["status", "task_status"], "status", "'open'"),
      textExpression(columns, ["priority", "urgency", "severity"], "priority", "'medium'"),
      textExpression(columns, ["state", "state_code"], "state"),
      dateExpression(columns, ["due_date", "deadline", "target_date", "scheduled_for", "scheduled_at"], "due_date"),
      selectExpression(columns, ["vendor_id", "assigned_vendor_id"], "vendor_id", "NULL"),
      dateExpression(columns, ["created_at"], "created_at"),
      dateExpression(columns, ["updated_at", "modified_at", "created_at"], "updated_at"),
    ],
    orderByCandidates: [
      "due_date",
      "deadline",
      "target_date",
      "scheduled_for",
      "updated_at",
      "created_at",
    ],
    orderDirection: "ASC",
  });
}
 
export async function readVendorSignals({
  workspaceId,
  scope = {},
  limit = 100,
}) {
  return runDynamicSource({
    source: "vendors",
    tableCandidates: ["vendors", "consultants", "vendor_directory"],
    workspaceId,
    scope,
    limit,
    maxLimit: 500,
    selectBuilder: (columns) => [
      selectExpression(columns, ["id", "vendor_id"], "id", "NULL"),
      textExpression(columns, ["name", "vendor_name", "company_name"], "name", "'Vendor'"),
      textExpression(columns, ["category", "primary_category", "categories"], "category"),
      textExpression(columns, ["state", "state_code"], "state"),
      textExpression(columns, ["states", "service_states", "coverage_states"], "states"),
      textExpression(columns, ["status", "vendor_status"], "status", "'active'"),
      numericExpression(columns, ["coverage_score", "score", "readiness_score"], "coverage_score"),
      textExpression(columns, ["tier", "vendor_tier"], "tier", "'Unrated'"),
      textExpression(columns, ["risk", "risk_level", "risk_rating"], "risk", "'Unknown'"),
      dateExpression(columns, ["updated_at", "modified_at", "created_at"], "updated_at"),
    ],
    orderByCandidates: ["coverage_score", "score", "updated_at", "created_at"],
  });
}
 
export async function readStrategySignals({
  workspaceId,
  limit = 50,
}) {
  return runDynamicSource({
    source: "strategy_recommendations",
    tableCandidates: [
      "strategy_recommendations",
      "strategy_recommendation",
      "ai_strategy_recommendations",
      "recommendations",
    ],
    workspaceId,
    scope: {},
    limit,
    maxLimit: 250,
    selectBuilder: (columns) => [
      selectExpression(columns, ["id", "recommendation_id"], "id", "NULL"),
      textExpression(columns, ["title", "name", "recommendation"], "title", "'Strategy recommendation'"),
      textExpression(columns, ["recommendation_type", "type", "category"], "recommendation_type"),
      textExpression(columns, ["priority", "urgency", "severity"], "priority", "'medium'"),
      numericExpression(columns, ["confidence", "confidence_score"], "confidence", "65"),
      textExpression(columns, ["status", "recommendation_status"], "status", "'open'"),
      textExpression(columns, ["rationale", "summary", "description"], "rationale"),
      textExpression(columns, ["state_code", "state", "jurisdiction_code"], "state_code"),
      dateExpression(columns, ["created_at"], "created_at"),
      dateExpression(columns, ["updated_at", "modified_at", "created_at"], "updated_at"),
    ],
  });
}
 
export async function readDecisionSignals({
  workspaceId,
  limit = 50,
}) {
  return runDynamicSource({
    source: "executive_decisions",
    tableCandidates: [
      "executive_decisions",
      "decision_intelligence",
      "decision_records",
      "executive_decision_items",
    ],
    workspaceId,
    scope: {},
    limit,
    maxLimit: 250,
    selectBuilder: (columns) => [
      selectExpression(columns, ["id", "decision_id"], "id", "NULL"),
      textExpression(columns, ["title", "name", "decision_title"], "title", "'Executive decision'"),
      textExpression(columns, ["decision_type", "type", "category"], "decision_type"),
      textExpression(columns, ["urgency", "priority", "severity"], "urgency", "'medium'"),
      numericExpression(columns, ["confidence", "confidence_score"], "confidence", "70"),
      textExpression(columns, ["status", "decision_status"], "status", "'open'"),
      textExpression(columns, ["state_code", "state", "jurisdiction_code"], "state_code"),
      textExpression(columns, ["summary", "description", "rationale"], "summary"),
      dateExpression(columns, ["created_at"], "created_at"),
      dateExpression(columns, ["updated_at", "modified_at", "created_at"], "updated_at"),
    ],
  });
}
 
async function readStateOperationsSummaryTable({
  metadata,
  workspaceId,
  scope,
  limit,
}) {
  const table = findTable(metadata, [
    "state_operations_summary",
    "state_operations",
    "operations_state_summary",
  ]);
 
  if (!table) return null;
 
  return runDynamicSource({
    source: "state_operations_summary",
    tableCandidates: [table],
    workspaceId,
    scope,
    limit,
    maxLimit: 100,
    selectBuilder: (columns) => [
      textExpression(columns, ["state_code", "state"], "state_code"),
      textExpression(columns, ["state_name", "name"], "state_name"),
      numericExpression(columns, ["readiness_score", "readiness", "health_score"], "readiness_score"),
      textExpression(columns, ["risk_level", "risk", "status"], "risk_level"),
      numericExpression(columns, ["counties_total", "total_counties"], "counties_total"),
      numericExpression(columns, ["counties_active", "active_counties"], "counties_active"),
      numericExpression(columns, ["open_tasks", "task_count"], "open_tasks"),
      numericExpression(columns, ["vendor_gaps", "vendor_gap_count"], "vendor_gaps"),
      dateExpression(columns, ["updated_at", "modified_at", "created_at"], "updated_at"),
    ],
    orderByCandidates: ["readiness_score", "updated_at"],
    orderDirection: "ASC",
  });
}
 
async function buildStateOperationsFromExistingTables({
  metadata,
  workspaceId,
  scope,
  limit,
}) {
  const localityTable = findTable(metadata, ["state_localities"]);
  const taskTable = findTable(metadata, ["tasks", "campaign_tasks", "execution_tasks"]);
  const vendorTable = findTable(metadata, ["vendors", "consultants", "vendor_directory"]);
 
  if (!localityTable && !taskTable && !vendorTable) {
    return sourceResult({
      source: "state_operations_summary",
      rows: [],
      ok: false,
      configured: false,
      degraded: true,
      error: "No state operations source tables are available.",
    });
  }
 
  const state = upperState(scope?.state_code || scope?.scope_value);
  const params = [Number(workspaceId)];
  let stateParam = "";
 
  if (state) {
    params.push(state);
    stateParam = `$${params.length}`;
  }
 
  const localityColumns = columnsFor(metadata, localityTable);
  const taskColumns = columnsFor(metadata, taskTable);
  const vendorColumns = columnsFor(metadata, vendorTable);
 
  const localityState = firstColumn(localityColumns, ["state_code", "state"]);
  const localityWorkspace = firstColumn(localityColumns, ["workspace_id", "firm_id", "organization_id"]);
  const localityType = firstColumn(localityColumns, ["locality_type", "type"]);
 
  const taskState = firstColumn(taskColumns, ["state_code", "state"]);
  const taskWorkspace = firstColumn(taskColumns, ["workspace_id", "firm_id", "organization_id"]);
  const taskStatus = firstColumn(taskColumns, ["status", "task_status"]);
 
  const vendorState = firstColumn(vendorColumns, ["state_code", "state"]);
  const vendorStates = firstColumn(vendorColumns, ["states", "service_states", "coverage_states"]);
  const vendorWorkspace = firstColumn(vendorColumns, ["workspace_id", "firm_id", "organization_id"]);
 
  const localityCte = localityTable && localityState
    ? `locality AS (
        SELECT
          UPPER(${quoteIdentifier(localityState)}::text) AS state_code,
          COUNT(*) FILTER (
            WHERE ${localityType ? `LOWER(COALESCE(${quoteIdentifier(localityType)}::text, '')) IN ('county', 'parish', 'borough', 'census area')` : "TRUE"}
          )::numeric AS counties_total,
          COUNT(*)::numeric AS counties_active
        FROM ${quoteIdentifier(localityTable)}
        WHERE ${localityWorkspace ? `${quoteIdentifier(localityWorkspace)} = $1` : "TRUE"}
          ${stateParam ? `AND UPPER(${quoteIdentifier(localityState)}::text) = ${stateParam}` : ""}
        GROUP BY UPPER(${quoteIdentifier(localityState)}::text)
      )`
    : `locality AS (
        SELECT NULL::text AS state_code, 0::numeric AS counties_total, 0::numeric AS counties_active
        WHERE FALSE
      )`;
 
  const taskCte = taskTable && taskState
    ? `task_counts AS (
        SELECT
          UPPER(${quoteIdentifier(taskState)}::text) AS state_code,
          COUNT(*) FILTER (
            WHERE ${taskStatus ? `LOWER(COALESCE(${quoteIdentifier(taskStatus)}::text, 'open')) NOT IN ('complete', 'completed', 'closed', 'resolved')` : "TRUE"}
          )::numeric AS open_tasks
        FROM ${quoteIdentifier(taskTable)}
        WHERE ${taskWorkspace ? `${quoteIdentifier(taskWorkspace)} = $1` : "TRUE"}
          ${stateParam ? `AND UPPER(${quoteIdentifier(taskState)}::text) = ${stateParam}` : ""}
        GROUP BY UPPER(${quoteIdentifier(taskState)}::text)
      )`
    : `task_counts AS (
        SELECT NULL::text AS state_code, 0::numeric AS open_tasks
        WHERE FALSE
      )`;
 
  let vendorCte;
 
  if (vendorTable && (vendorState || vendorStates)) {
    const stateExpression = vendorState
      ? `UPPER(${quoteIdentifier(vendorState)}::text)`
      : "NULL::text";
 
    const scopeFilter = stateParam
      ? vendorState
        ? `AND UPPER(${quoteIdentifier(vendorState)}::text) = ${stateParam}`
        : `AND COALESCE(${quoteIdentifier(vendorStates)}::text, '') ILIKE '%' || ${stateParam} || '%'`
      : "";
 
    vendorCte = `vendor_counts AS (
      SELECT
        ${stateExpression} AS state_code,
        0::numeric AS vendor_gaps
      FROM ${quoteIdentifier(vendorTable)}
      WHERE ${vendorWorkspace ? `${quoteIdentifier(vendorWorkspace)} = $1` : "TRUE"}
        ${scopeFilter}
      GROUP BY ${stateExpression}
    )`;
  } else {
    vendorCte = `vendor_counts AS (
      SELECT NULL::text AS state_code, 0::numeric AS vendor_gaps
      WHERE FALSE
    )`;
  }
 
  const sql = `
    WITH
    ${localityCte},
    ${taskCte},
    ${vendorCte},
    states AS (
      SELECT state_code FROM locality
      UNION
      SELECT state_code FROM task_counts
      UNION
      SELECT state_code FROM vendor_counts
    )
    SELECT
      s.state_code,
      s.state_code AS state_name,
      GREATEST(
        0,
        LEAST(
          100,
          100 - COALESCE(t.open_tasks, 0) * 3 - COALESCE(v.vendor_gaps, 0) * 8
        )
      )::numeric AS readiness_score,
      CASE
        WHEN COALESCE(t.open_tasks, 0) >= 10 THEN 'high'
        WHEN COALESCE(t.open_tasks, 0) >= 5 THEN 'medium'
        ELSE 'low'
      END AS risk_level,
      COALESCE(l.counties_total, 0)::numeric AS counties_total,
      COALESCE(l.counties_active, 0)::numeric AS counties_active,
      COALESCE(t.open_tasks, 0)::numeric AS open_tasks,
      COALESCE(v.vendor_gaps, 0)::numeric AS vendor_gaps,
      NOW() AS updated_at
    FROM states s
    LEFT JOIN locality l USING (state_code)
    LEFT JOIN task_counts t USING (state_code)
    LEFT JOIN vendor_counts v USING (state_code)
    WHERE s.state_code IS NOT NULL
    ORDER BY readiness_score ASC, s.state_code ASC
    LIMIT ${clampLimit(limit, 100, 100)}
  `;
 
  const result = await safeQuery(sql, params, "state_operations_summary");
 
  return {
    ...result,
    table: "derived",
    configured: true,
    degraded: result.ok ? false : true,
    details: {
      derived_from: [localityTable, taskTable, vendorTable].filter(Boolean),
    },
  };
}
 
export async function readStateOperationsSignals({
  workspaceId,
  scope = {},
  limit = 100,
}) {
  const metadata = await getPublicSchemaMetadata().catch(() => null);
 
  if (!metadata) {
    return sourceResult({
      source: "state_operations_summary",
      rows: [],
      ok: false,
      configured: false,
      degraded: true,
      error: "Unable to inspect state operations schema.",
    });
  }
 
  const direct = await readStateOperationsSummaryTable({
    metadata,
    workspaceId,
    scope,
    limit,
  });
 
  if (direct) return direct;
 
  return buildStateOperationsFromExistingTables({
    metadata,
    workspaceId,
    scope,
    limit,
  });
}
 
export async function readInfluenceSignals({
  workspaceId,
  limit = 100,
}) {
  return runDynamicSource({
    source: "influence_scores",
    tableCandidates: [
      "influence_scores",
      "influence_forecasts",
      "candidate_influence_scores",
      "influence_entities",
      "political_influence_scores",
    ],
    workspaceId,
    scope: {},
    limit,
    maxLimit: 500,
    selectBuilder: (columns) => [
      textExpression(columns, ["entity_type", "type"], "entity_type", "'influence_entity'"),
      selectExpression(columns, ["entity_id", "id"], "entity_id", "NULL"),
      textExpression(columns, ["entity_name", "name", "candidate_name"], "entity_name", "'Influence entity'"),
      textExpression(columns, ["state_code", "state"], "state_code"),
      numericExpression(columns, ["influence_score", "score"], "influence_score"),
      numericExpression(columns, ["risk_score", "risk"], "risk_score"),
      numericExpression(columns, ["momentum_score", "momentum"], "momentum_score"),
      dateExpression(columns, ["updated_at", "created_at"], "updated_at"),
    ],
    orderByCandidates: ["influence_score", "score", "updated_at"],
  });
}
 
export async function readCoalitionSignals({
  workspaceId,
  scope = {},
  limit = 100,
}) {
  const tableCandidates = [
    "coalition_intelligence",
    "coalition_scores",
    "national_coalition_intelligence",
  ];

  let table = null;

  for (const candidate of tableCandidates) {
    if (await tableExists(candidate)) {
      table = candidate;
      break;
    }
  }

  if (!table) {
    return {
      source: "coalition_intelligence",
      rows: [],
      ok: false,
      configured: false,
      degraded: true,
      error:
        "Coalition intelligence table is not configured.",
      table: null,
      details: {
        searched_tables: tableCandidates,
      },
    };
  }

  const columns = await readColumns(table);

  const workspaceColumn =
    firstExisting(columns, [
      "workspace_id",
      "firm_id",
    ]);

  const stateColumn =
    firstExisting(columns, [
      "state_code",
      "state",
      "jurisdiction_code",
      "geography",
      "scope_value",
    ]);

  const nameColumn =
    firstExisting(columns, [
      "coalition_name",
      "name",
      "title",
      "entity_name",
    ]);

  const supportColumn =
    firstExisting(columns, [
      "support_score",
      "coalition_score",
      "score",
    ]);

  const mobilizationColumn =
    firstExisting(columns, [
      "mobilization_score",
      "cohesion_score",
      "engagement_score",
      "activation_score",
    ]);

  const fragmentationColumn =
    firstExisting(columns, [
      "fragmentation_risk",
      "risk_score",
      "fragmentation_score",
    ]);

  const memberCountColumn =
    firstExisting(columns, [
      "member_count",
      "entity_count",
      "relationship_count",
    ]);

  const confidenceColumn =
    firstExisting(columns, [
      "confidence",
      "confidence_score",
    ]);

  const opportunityColumn =
    firstExisting(columns, [
      "opportunity_score",
      "opportunity",
    ]);

  const forecastColumn =
    firstExisting(columns, [
      "forecast_probability",
      "forecast_score",
      "win_probability",
    ]);

  const recommendationColumn =
    firstExisting(columns, [
      "recommended_action",
      "recommendation",
      "summary",
    ]);

  const updatedColumn =
    firstExisting(columns, [
      "updated_at",
      "calculated_at",
      "created_at",
    ]);

  const state = upperState(
    scope?.state_code ||
      scope?.scope_value
  );

  const conditions = [];
  const params = [];

  if (workspaceColumn) {
    params.push(workspaceId);

    conditions.push(
      `${quoteIdentifier(workspaceColumn)} = $${params.length}`
    );
  }

  if (state && stateColumn) {
    params.push(state);

    conditions.push(
      `UPPER(COALESCE(${quoteIdentifier(stateColumn)}::text, '')) = $${params.length}`
    );
  }

  const nameExpression = nameColumn
    ? `${quoteIdentifier(nameColumn)}::text AS coalition_name`
    : "'Coalition'::text AS coalition_name";

  const stateExpression = stateColumn
    ? `${quoteIdentifier(stateColumn)}::text AS state_code`
    : "NULL::text AS state_code";

  /*
   * These columns are genuine PostgreSQL numeric/integer fields.
   * Do not cast them through JSONB.
   */
  const supportExpression = supportColumn
    ? `COALESCE(${quoteIdentifier(supportColumn)}::numeric, 50)::numeric AS support_score`
    : "50::numeric AS support_score";

  const mobilizationExpression =
    mobilizationColumn
      ? `COALESCE(${quoteIdentifier(mobilizationColumn)}::numeric, 50)::numeric AS mobilization_score`
      : "50::numeric AS mobilization_score";

  const fragmentationExpression =
    fragmentationColumn
      ? `COALESCE(${quoteIdentifier(fragmentationColumn)}::numeric, 0)::numeric AS fragmentation_risk`
      : "0::numeric AS fragmentation_risk";

  const memberCountExpression =
    memberCountColumn
      ? `COALESCE(${quoteIdentifier(memberCountColumn)}::numeric, 0)::numeric AS member_count`
      : "0::numeric AS member_count";

  const confidenceExpression =
    confidenceColumn
      ? `COALESCE(${quoteIdentifier(confidenceColumn)}::numeric, 70)::numeric AS confidence_score`
      : "70::numeric AS confidence_score";

  const opportunityExpression =
    opportunityColumn
      ? `COALESCE(${quoteIdentifier(opportunityColumn)}::numeric, 0)::numeric AS opportunity_score`
      : "0::numeric AS opportunity_score";

  const forecastExpression =
    forecastColumn
      ? `COALESCE(${quoteIdentifier(forecastColumn)}::numeric, 0)::numeric AS forecast_probability`
      : "0::numeric AS forecast_probability";

  const recommendationExpression =
    recommendationColumn
      ? `${quoteIdentifier(recommendationColumn)}::text AS recommended_action`
      : "NULL::text AS recommended_action";

  /*
   * JSONB arrays remain JSONB evidence fields.
   * They are not converted into scalar scores.
   */
  const membersExpression =
    columns.has("members")
      ? `${quoteIdentifier("members")} AS members`
      : "'[]'::jsonb AS members";

  const relationshipsExpression =
    columns.has("relationships")
      ? `${quoteIdentifier("relationships")} AS relationships`
      : "'[]'::jsonb AS relationships";

  const metadataExpression =
    columns.has("metadata")
      ? `${quoteIdentifier("metadata")} AS metadata`
      : "'{}'::jsonb AS metadata";

  const updatedExpression =
    updatedColumn
      ? `${quoteIdentifier(updatedColumn)} AS updated_at`
      : "NULL::timestamp AS updated_at";

  const whereSql = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const safeLimit = Math.max(
    1,
    Math.min(
      Number(limit) || 100,
      500
    )
  );

  const sql = `
    SELECT
      ${nameExpression},
      ${stateExpression},
      ${supportExpression},
      ${mobilizationExpression},
      ${fragmentationExpression},
      ${memberCountExpression},
      ${confidenceExpression},
      ${opportunityExpression},
      ${forecastExpression},
      ${recommendationExpression},
      ${membersExpression},
      ${relationshipsExpression},
      ${metadataExpression},
      ${updatedExpression}

    FROM ${quoteIdentifier(table)}

    ${whereSql}

    ORDER BY
      fragmentation_risk DESC NULLS LAST,
      support_score DESC NULLS LAST

    LIMIT ${safeLimit}
  `;

  return safeQuery(
    sql,
    params,
    "coalition_intelligence",
    {
      table,
      configured: true,
      degraded: false,
      details: {
        selected_table: table,
        support_column: supportColumn,
        mobilization_column:
          mobilizationColumn,
        fragmentation_column:
          fragmentationColumn,
        member_count_column:
          memberCountColumn,
        state_column: stateColumn,
        numeric_columns_are_native: true,
      },
    }
  );
}
 
export async function collectPoliticalSignals({
  workspaceId,
  scope = {},
}) {
  const results = await Promise.all([
    readCandidateSignals({ workspaceId, scope }),
    readTaskSignals({ workspaceId, scope }),
    readVendorSignals({ workspaceId, scope }),
    readStrategySignals({ workspaceId }),
    readDecisionSignals({ workspaceId }),
    readStateOperationsSignals({ workspaceId, scope }),
    readInfluenceSignals({ workspaceId }),
    readCoalitionSignals({ workspaceId }),
  ]);
 
  const sourceHealth = Object.fromEntries(
    results.map((result) => [
      result.source,
      {
        ok: result.ok,
        configured: result.configured,
        degraded: result.degraded,
        count: result.rows.length,
        error: result.error,
        table: result.table,
        details: result.details || {},
        checked_at: new Date().toISOString(),
      },
    ])
  );
 
  return {
    scope,
    sourceHealth,
    sources: Object.fromEntries(
      results.map((result) => [
        result.source,
        result.rows,
      ])
    ),
    collectedAt: new Date().toISOString(),
  };
}
 
export function clearPoliticalFabricSchemaCache() {
  metadataCache.clear();
 
  return {
    ok: true,
    cleared_at: new Date().toISOString(),
  };
}
