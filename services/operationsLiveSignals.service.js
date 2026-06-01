import { pool } from "../db/pool.js";

async function tableExists(tableName) {
  const { rows } = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(rows[0]?.exists);
}

async function getColumns(tableName) {
  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );

  return new Set(rows.map((row) => row.column_name));
}

function firstExisting(columns, options) {
  return options.find((column) => columns.has(column));
}

function norm(value) {
  return String(value || "").trim().toUpperCase();
}

function keyFor(stateCode, countyName = "") {
  return `${norm(stateCode)}::${norm(countyName)}`;
}

function addToMap(map, key, amount = 1) {
  map.set(key, Number(map.get(key) || 0) + Number(amount || 0));
}

function safeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isResolvedStatus(status) {
  return ["complete", "completed", "done", "resolved", "archived"].includes(
    String(status || "").toLowerCase()
  );
}

async function loadVendorSignals() {
  const stateMap = new Map();
  const countyMap = new Map();

  if (!(await tableExists("vendors"))) return { stateMap, countyMap };

  const columns = await getColumns("vendors");
  const stateCol = firstExisting(columns, ["state_code", "state", "service_state", "vendor_state"]);
  const countyCol = firstExisting(columns, ["county", "county_name", "locality", "service_county"]);
  const statusCol = firstExisting(columns, ["status", "active_status"]);

  if (!stateCol) return { stateMap, countyMap };

  const selectCounty = countyCol ? `, ${countyCol} AS county_name` : `, NULL::text AS county_name`;
  const whereStatus = statusCol
    ? `AND COALESCE(${statusCol}, 'active') NOT IN ('inactive', 'disabled', 'archived')`
    : "";

  const { rows } = await pool.query(`
    SELECT UPPER(${stateCol}) AS state_code ${selectCounty}, COUNT(*)::int AS total
    FROM vendors
    WHERE COALESCE(${stateCol}, '') <> ''
    ${whereStatus}
    GROUP BY UPPER(${stateCol}), county_name
  `);

  for (const row of rows) {
    addToMap(stateMap, norm(row.state_code), row.total);
    if (row.county_name) addToMap(countyMap, keyFor(row.state_code, row.county_name), row.total);
  }

  return { stateMap, countyMap };
}

async function loadMailOpsSignals() {
  const stateMap = new Map();
  const countyMap = new Map();

  if (!(await tableExists("mailops_events"))) return { stateMap, countyMap };

  const columns = await getColumns("mailops_events");
  const stateCol = firstExisting(columns, ["state_code", "state"]);
  const countyCol = firstExisting(columns, ["county", "county_name", "locality"]);
  const statusCol = firstExisting(columns, ["status", "production_status"]);
  const volumeCol = firstExisting(columns, ["quantity", "pieces", "mail_pieces", "volume"]);

  if (!stateCol) return { stateMap, countyMap };

  const selectCounty = countyCol ? `, ${countyCol} AS county_name` : `, NULL::text AS county_name`;
  const amount = volumeCol
    ? `GREATEST(1, CEIL(SUM(COALESCE(${volumeCol}, 1)) / 1000.0))::int`
    : `COUNT(*)::int`;
  const whereStatus = statusCol
    ? `AND COALESCE(${statusCol}, 'active') NOT IN ('cancelled', 'canceled', 'archived')`
    : "";

  const { rows } = await pool.query(`
    SELECT UPPER(${stateCol}) AS state_code ${selectCounty}, ${amount} AS total
    FROM mailops_events
    WHERE COALESCE(${stateCol}, '') <> ''
    ${whereStatus}
    GROUP BY UPPER(${stateCol}), county_name
  `);

  for (const row of rows) {
    addToMap(stateMap, norm(row.state_code), row.total);
    if (row.county_name) addToMap(countyMap, keyFor(row.state_code, row.county_name), row.total);
  }

  return { stateMap, countyMap };
}

async function loadTaskSignals() {
  const stateMap = new Map();
  const countyMap = new Map();
  const activeCountyTasks = new Map();
  const resolvedCountyTasks = new Map();

  if (!(await tableExists("tasks"))) {
    return { stateMap, countyMap, activeCountyTasks, resolvedCountyTasks };
  }

  const columns = await getColumns("tasks");
  const stateCol = firstExisting(columns, ["state_code", "state"]);
  const countyCol = firstExisting(columns, ["county", "county_name", "locality"]);
  const statusCol = firstExisting(columns, ["status"]);
  const metadataCol = columns.has("metadata") ? "metadata" : null;

  const stateExpr = stateCol
    ? `COALESCE(${stateCol}, ${metadataCol ? "metadata->>'state'" : "''"}, ${metadataCol ? "metadata->>'state_code'" : "''"}, '')`
    : metadataCol
      ? `COALESCE(metadata->>'state', metadata->>'state_code', '')`
      : `''`;

  const countyExpr = countyCol
    ? `COALESCE(${countyCol}, ${metadataCol ? "metadata->>'county'" : "''"}, ${metadataCol ? "metadata->>'county_name'" : "''"}, '')`
    : metadataCol
      ? `COALESCE(metadata->>'county', metadata->>'county_name', '')`
      : `''`;

  const statusExpr = statusCol ? `COALESCE(${statusCol}, 'open')` : `'open'`;
  const metadataSelect = metadataCol ? `metadata` : `NULL::jsonb AS metadata`;

  const { rows } = await pool.query(`
    SELECT
      id,
      UPPER(${stateExpr}) AS state_code,
      ${countyExpr} AS county_name,
      ${statusExpr} AS status,
      ${metadataSelect}
    FROM tasks
    WHERE COALESCE(${stateExpr}, '') <> ''
  `);

  for (const row of rows) {
    const metadata = safeJson(row.metadata);
    const stateCode = norm(row.state_code || metadata.state || metadata.state_code);
    const countyName = row.county_name || metadata.county || metadata.county_name;
    const taskKey = countyName ? keyFor(stateCode, countyName) : null;
    const isCountyTask =
      metadata.task_kind === "county_escalation" ||
      metadata.source === "state_operations_drilldown" ||
      metadata.tactical_source === "County Heat" ||
      Boolean(metadata.county && metadata.heat_score);

    if (!stateCode) continue;

    if (isResolvedStatus(row.status)) {
      if (isCountyTask && taskKey) {
        addToMap(resolvedCountyTasks, taskKey, 1);
      }
      continue;
    }

    addToMap(stateMap, stateCode, 1);
    if (countyName) addToMap(countyMap, taskKey, 1);
    if (isCountyTask && taskKey) addToMap(activeCountyTasks, taskKey, 1);
  }

  return { stateMap, countyMap, activeCountyTasks, resolvedCountyTasks };
}

async function loadFundraisingSignals() {
  const stateMap = new Map();

  if (!(await tableExists("fec_candidates"))) return { stateMap };

  const columns = await getColumns("fec_candidates");
  const stateCol = firstExisting(columns, ["state_code", "state", "candidate_state"]);

  if (!stateCol) return { stateMap };

  const { rows } = await pool.query(`
    SELECT UPPER(${stateCol}) AS state_code, COUNT(*)::int AS total
    FROM fec_candidates
    WHERE COALESCE(${stateCol}, '') <> ''
    GROUP BY UPPER(${stateCol})
  `);

  for (const row of rows) {
    addToMap(stateMap, norm(row.state_code), row.total);
  }

  return { stateMap };
}

async function loadAlertSignals() {
  const stateMap = new Map();
  const countyMap = new Map();

  if (!(await tableExists("executive_alerts"))) return { stateMap, countyMap };

  const columns = await getColumns("executive_alerts");
  const stateCol = firstExisting(columns, ["state_code", "state"]);
  const countyCol = firstExisting(columns, ["county", "county_name", "locality"]);
  const severityCol = firstExisting(columns, ["severity", "risk", "level"]);

  if (!stateCol) return { stateMap, countyMap };

  const selectCounty = countyCol ? `, ${countyCol} AS county_name` : `, NULL::text AS county_name`;
  const severityWeight = severityCol
    ? `
      SUM(
        CASE LOWER(COALESCE(${severityCol}, 'signal'))
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'elevated' THEN 2
          ELSE 1
        END
      )::int
    `
    : `COUNT(*)::int`;

  const { rows } = await pool.query(`
    SELECT UPPER(${stateCol}) AS state_code ${selectCounty}, ${severityWeight} AS total
    FROM executive_alerts
    WHERE COALESCE(${stateCol}, '') <> ''
    GROUP BY UPPER(${stateCol}), county_name
  `);

  for (const row of rows) {
    addToMap(stateMap, norm(row.state_code), row.total);
    if (row.county_name) addToMap(countyMap, keyFor(row.state_code, row.county_name), row.total);
  }

  return { stateMap, countyMap };
}

export async function loadOperationsLiveSignals() {
  const [vendors, mailops, tasks, fundraising, alerts] = await Promise.all([
    loadVendorSignals(),
    loadMailOpsSignals(),
    loadTaskSignals(),
    loadFundraisingSignals(),
    loadAlertSignals(),
  ]);

  return {
    vendors,
    mailops,
    tasks,
    fundraising,
    alerts,
    keyFor,
  };
}
