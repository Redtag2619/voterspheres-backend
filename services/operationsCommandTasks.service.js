import { pool } from "../db/pool.js";

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

function has(columns, name) {
  return columns.has(name);
}

function priorityFromRisk(risk) {
  const value = String(risk || "").toLowerCase();

  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "elevated") return "medium";

  return "normal";
}

export async function createCountyCommandTask({ payload, user }) {
  const columns = await getColumns("tasks");

  if (!columns.size) {
    throw new Error("tasks table was not found.");
  }

  const stateCode = String(payload.state || payload.state_code || "").toUpperCase();
  const countyName = payload.county || payload.county_name || payload.name || "Selected locality";
  const risk = payload.risk || "Elevated";
  const heatScore = Number(payload.heat_score || payload.pressure || 0).toFixed(2);
  const topDriver = payload.top_driver || payload.top_drivers?.[0]?.label || "Operational Heat";

  const title = `${String(risk).toUpperCase()}: ${countyName} operational escalation`;

  const description = [
    `County/Parish: ${countyName}`,
    `State: ${stateCode}`,
    `Risk: ${risk}`,
    `Heat Score: ${heatScore}`,
    `Top Driver: ${topDriver}`,
    "",
    payload.recommendation || "Review vendor coverage, MailOps timing, turnout pressure, and operational readiness.",
  ].join("\n");

  const metadata = {
    source: "state_operations_drilldown",
    tactical_source: "County Heat",
    state: stateCode,
    county: countyName,
    risk,
    heat_score: Number(heatScore),
    top_driver: topDriver,
    recommendation: payload.recommendation || null,
    county_fips: payload.county_fips || null,
    full_fips: payload.full_fips || null,
    top_drivers: payload.top_drivers || [],
    scoring_breakdown: payload.scoring_breakdown || {},
    live_signal_counts: payload.live_signal_counts || {},
  };

  const insert = {};
  if (has(columns, "title")) insert.title = title;
  if (has(columns, "name")) insert.name = title;
  if (has(columns, "description")) insert.description = description;
  if (has(columns, "details")) insert.details = description;
  if (has(columns, "status")) insert.status = "open";
  if (has(columns, "priority")) insert.priority = priorityFromRisk(risk);
  if (has(columns, "source")) insert.source = "state_operations";
  if (has(columns, "state")) insert.state = stateCode;
  if (has(columns, "state_code")) insert.state_code = stateCode;
  if (has(columns, "county")) insert.county = countyName;
  if (has(columns, "county_name")) insert.county_name = countyName;
  if (has(columns, "type")) insert.type = "county_escalation";
  if (has(columns, "category")) insert.category = "operations";
  if (has(columns, "metadata")) insert.metadata = JSON.stringify(metadata);
  if (has(columns, "created_by")) insert.created_by = user?.id || user?.user_id || null;
  if (has(columns, "user_id")) insert.user_id = user?.id || user?.user_id || null;
  if (has(columns, "workspace_id")) insert.workspace_id = payload.workspace_id || user?.workspace_id || user?.active_workspace_id || null;

  if (has(columns, "created_at")) insert.created_at = new Date();
  if (has(columns, "updated_at")) insert.updated_at = new Date();

  const keys = Object.keys(insert);

  if (!keys.length) {
    throw new Error("No compatible task columns were found.");
  }

  const values = keys.map((key) => insert[key]);
  const placeholders = keys.map((_, index) => `$${index + 1}`);

  const { rows } = await pool.query(
    `
      INSERT INTO tasks (${keys.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `,
    values
  );

  return rows[0];
}
