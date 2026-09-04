import { pool } from "../db/pool.js";

 

const INACTIVE_WORKSPACE_STATUSES = new Set([

  "archived",

  "inactive",

  "disabled",

]);

 

function text(value = "") {

  return String(value ?? "").trim();

}

 

function getFirmId(user = {}) {

  return user.firmId || user.firm_id || user.firm?.id || null;

}

 

function getUserId(user = {}) {

  return user.id || user.user_id || user.sub || null;

}

 

function normalizeWorkspaceId(value) {

  if (

    value === undefined ||

    value === null ||

    value === "" ||

    value === "national-signals"

  ) {

    return null;

  }

 

  const workspaceId = Number(value);

 

  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {

    const error = new Error("Invalid workspace id.");

    error.statusCode = 400;

    error.code = "INVALID_WORKSPACE_ID";

    throw error;

  }

 

  return workspaceId;

}

 

async function validateWorkspaceAccess({ workspaceId, firmId }) {

  if (!workspaceId) return null;

 

  const result = await pool.query(

    `

      SELECT

        id,

        firm_id,

        name,

        status,

        state,

        office,

        cycle

      FROM workspaces

      WHERE id = $1

        AND firm_id = $2

      LIMIT 1

    `,

    [workspaceId, firmId]

  );

 

  const workspace = result.rows?.[0] || null;

 

  if (!workspace) {

    const error = new Error("Workspace is not available for this firm.");

    error.statusCode = 403;

    error.code = "WORKSPACE_NOT_AVAILABLE";

    throw error;

  }

 

  const status = text(workspace.status || "active").toLowerCase();

 

  if (INACTIVE_WORKSPACE_STATUSES.has(status)) {

    const error = new Error("Workspace is archived, inactive, or disabled.");

    error.statusCode = 409;

    error.code = "WORKSPACE_INACTIVE";

    throw error;

  }

 

  return workspace;

}

 

async function getTaskColumns() {

  const { rows } = await pool.query(

    `

      SELECT column_name

      FROM information_schema.columns

      WHERE table_schema = 'public'

        AND table_name = 'tasks'

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

 

export async function createAiTacticalTask({

  user = {},

  payload = {},

}) {

  const firmId = Number(getFirmId(user));

  const userId = getUserId(user);

 

  if (!Number.isInteger(firmId) || firmId <= 0) {

    const error = new Error("Missing firm context.");

    error.statusCode = 401;

    error.code = "MISSING_FIRM_CONTEXT";

    throw error;

  }

 

  const title = text(payload.title);

 

  if (!title) {

    const error = new Error("Task title is required.");

    error.statusCode = 400;

    error.code = "TASK_TITLE_REQUIRED";

    throw error;

  }

 

  const workspaceId = normalizeWorkspaceId(payload.workspace_id);

 

  const workspace = await validateWorkspaceAccess({

    workspaceId,

    firmId,

  });

 

  const columns = await getTaskColumns();

 

  const metadata = {

    source: "ai_tactical_action_center",

    recommendation_type: payload.type || "recommendation",

    recommendation_action: payload.action || "",

    workspace_name:

      workspace?.name ||

      payload.workspace_name ||

      "",

    signal_count: payload.signal_count || 0,

    created_from: "AI Tactical Intelligence",

  };

 

  const insert = {};

 

  const add = (column, value) => {

    if (columns.has(column)) {

      insert[column] = value;

    }

  };

 

  add("firm_id", firmId);

  add("workspace_id", workspaceId);

  add("title", title);

  add(

    "description",

    text(payload.action) ||

      text(payload.description) ||

      "AI Tactical recommendation task."

  );

  add("status", "open");

  add("priority", priorityFromSeverity(payload.severity));

  add(

    "state",

    payload.state && payload.state !== "National"

      ? payload.state

      : workspace?.state && workspace.state !== "National"

        ? workspace.state

        : null

  );

  add("source", "AI Tactical");

  add("assigned_to", payload.assigned_to || null);

  add("created_by", userId);

  add("updated_by", userId);

  add("metadata", metadata);

  add("created_at", new Date());

  add("updated_at", new Date());

 

  const keys = Object.keys(insert);

 

  if (!keys.length) {

    const error = new Error("Tasks table has no compatible columns.");

    error.statusCode = 500;

    error.code = "TASKS_SCHEMA_INCOMPATIBLE";

    throw error;

  }

 

  const values = keys.map((key) => insert[key]);

 

  const placeholders = keys.map((key, index) => {

    if (key === "metadata") {

      return `$${index + 1}::jsonb`;

    }

 

    return `$${index + 1}`;

  });

 

  const { rows } = await pool.query(

    `

      INSERT INTO tasks (${keys.join(", ")})

      VALUES (${placeholders.join(", ")})

      RETURNING *

    `,

    values.map((value) => {

      if (

        value &&

        typeof value === "object" &&

        !(value instanceof Date)

      ) {

        return JSON.stringify(value);

      }

 

      return value;

    })

  );

 

  return rows[0];

}

