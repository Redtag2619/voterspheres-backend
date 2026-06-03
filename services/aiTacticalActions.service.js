import { pool } from "../db/pool.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

async function getTaskColumns() {
  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'tasks'
    `
  );

  return new Set(rows.map((row) => row.column_name));
}

function priorityFromSeverity(severity = "") {
  const value = String(severity || "").toLowerCase();
  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "elevated" || value === "medium") return "medium";
  return "normal";
}

export async function createAiTacticalTask({ user = {}, payload = {} }) {
  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) {
    throw new Error("Missing firm context.");
  }

  const title = text(payload.title);
  if (!title) {
    throw new Error("Task title is required.");
  }

  const columns = await getTaskColumns();

  const metadata = {
    source: "ai_tactical_action_center",
    recommendation_type: payload.type || "recommendation",
    recommendation_action: payload.action || "",
    workspace_name: payload.workspace_name || "",
    signal_count: payload.signal_count || 0,
    created_from: "AI Tactical Intelligence",
  };

  const insert = {};
  const add = (column, value) => {
    if (columns.has(column)) insert[column] = value;
  };

  add("firm_id", firmId);
  add("workspace_id", payload.workspace_id && payload.workspace_id !== "national-signals" ? payload.workspace_id : null);
  add("title", title);
  add("description", text(payload.action) || text(payload.description) || "AI Tactical recommendation task.");
  add("status", "open");
  add("priority", priorityFromSeverity(payload.severity));
  add("state", payload.state && payload.state !== "National" ? payload.state : null);
  add("source", "AI Tactical");
  add("assigned_to", payload.assigned_to || null);
  add("created_by", userId);
  add("updated_by", userId);
  add("metadata", metadata);
  add("created_at", new Date());
  add("updated_at", new Date());

  const keys = Object.keys(insert);

  if (!keys.length) {
    throw new Error("Tasks table has no compatible columns.");
  }

  const values = keys.map((key) => insert[key]);
  const placeholders = keys.map((key, index) => {
    if (key === "metadata") return `$${index + 1}::jsonb`;
    return `$${index + 1}`;
  });

  const { rows } = await pool.query(
    `
      INSERT INTO tasks (${keys.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `,
    values.map((value) => {
      if (value && typeof value === "object" && !(value instanceof Date)) {
        return JSON.stringify(value);
      }
      return value;
    })
  );

  return rows[0];
}
