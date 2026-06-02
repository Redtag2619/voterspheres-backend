import { pool } from "../db/pool.js";

function riskFromScore(score = 0) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function status(value = "") {
  const v = String(value || "").toLowerCase();
  if (["complete", "completed", "done", "resolved"].includes(v)) return "complete";
  if (["blocked", "paused", "hold"].includes(v)) return "blocked";
  if (["in_progress", "active", "started"].includes(v)) return "in_progress";
  return "open";
}

function meta(task = {}) {
  if (!task.metadata) return {};
  if (typeof task.metadata === "object") return task.metadata;
  try {
    return JSON.parse(task.metadata);
  } catch {
    return {};
  }
}

function isCountyTask(task = {}) {
  const m = meta(task);
  const source = String(task.source || m.source || "").toLowerCase();
  return source.includes("county") || source.includes("state_operations") || Boolean(m.county || m.heat_score);
}

function buildRecommendation({ workspace, tasks }) {
  const open = tasks.filter((t) => status(t.status) !== "complete");
  const blocked = tasks.filter((t) => status(t.status) === "blocked");
  const high = tasks.filter((t) => ["critical", "high"].includes(String(t.priority || "").toLowerCase()));
  const county = tasks.filter(isCountyTask);
  const activeCounty = county.filter((t) => status(t.status) !== "complete");

  const pressure = Math.min(
    100,
    Math.round(open.length * 6 + blocked.length * 12 + high.length * 10 + activeCounty.length * 14)
  );

  const risk = riskFromScore(pressure);

  const recommendations = [];

  if (activeCounty.length) {
    recommendations.push({
      type: "county_escalation",
      severity: "High",
      title: `${activeCounty.length} county escalation${activeCounty.length === 1 ? "" : "s"} require attention`,
      action: "Open State Operations, verify the top heat drivers, and assign an owner before closing the escalation.",
    });
  }

  if (blocked.length) {
    recommendations.push({
      type: "blocked_execution",
      severity: "High",
      title: `${blocked.length} blocked task${blocked.length === 1 ? "" : "s"} could slow campaign execution`,
      action: "Clear blocker or reassign the task to an executive owner today.",
    });
  }

  if (high.length) {
    recommendations.push({
      type: "high_priority_load",
      severity: risk,
      title: `${high.length} high-priority task${high.length === 1 ? "" : "s"} in workspace`,
      action: "Move high-priority work into the Command Center top queue.",
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      type: "stable_monitoring",
      severity: "Stable",
      title: "Workspace is stable",
      action: "Continue monitoring county heat, vendors, MailOps, and task aging.",
    });
  }

  return {
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    state: workspace.state || "National",
    office: workspace.office || "Statewide",
    pressure_score: pressure,
    risk,
    open_tasks: open.length,
    blocked_tasks: blocked.length,
    high_priority_tasks: high.length,
    county_escalations: activeCounty.length,
    recommendations,
  };
}

export async function getAiTacticalDashboard({ firmId }) {
  const workspacesRes = await pool.query(
    `SELECT * FROM workspaces WHERE firm_id = $1 ORDER BY updated_at DESC, created_at DESC`,
    [firmId]
  );

  const tasksRes = await pool.query(
    `SELECT * FROM tasks WHERE firm_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1000`,
    [firmId]
  );

  const workspaces = workspacesRes.rows || [];
  const tasks = tasksRes.rows || [];

  const workspaceInsights = workspaces.map((workspace) => {
    const workspaceTasks = tasks.filter((task) => String(task.workspace_id || "") === String(workspace.id));
    return buildRecommendation({ workspace, tasks: workspaceTasks });
  });

  const ranked = workspaceInsights.sort((a, b) => b.pressure_score - a.pressure_score);

  return {
    summary: {
      workspaces: ranked.length,
      critical: ranked.filter((x) => x.risk === "Critical").length,
      high: ranked.filter((x) => x.risk === "High").length,
      total_recommendations: ranked.reduce((sum, x) => sum + x.recommendations.length, 0),
      national_pressure: ranked.length
        ? Math.round(ranked.reduce((sum, x) => sum + x.pressure_score, 0) / ranked.length)
        : 0,
    },
    workspaces: ranked,
    top_recommendations: ranked.flatMap((x) =>
      x.recommendations.map((r) => ({ ...r, workspace_id: x.workspace_id, workspace_name: x.workspace_name, state: x.state }))
    ).slice(0, 20),
    updated_at: new Date().toISOString(),
  };
}

export async function getAiTacticalWorkspace({ firmId, workspaceId }) {
  const workspaceRes = await pool.query(
    `SELECT * FROM workspaces WHERE id = $1 AND firm_id = $2 LIMIT 1`,
    [workspaceId, firmId]
  );

  const workspace = workspaceRes.rows[0];
  if (!workspace) throw new Error("Workspace not found");

  const tasksRes = await pool.query(
    `SELECT * FROM tasks WHERE firm_id = $1 AND workspace_id = $2 ORDER BY updated_at DESC, created_at DESC LIMIT 500`,
    [firmId, workspaceId]
  );

  const tasks = tasksRes.rows || [];
  return buildRecommendation({ workspace, tasks });
}
