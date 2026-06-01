import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

function riskFromScore(score = 0) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function normalizeStatus(value = "") {
  const status = String(value || "").toLowerCase();
  if (["complete", "completed", "done", "resolved"].includes(status)) return "complete";
  if (["blocked", "paused", "hold"].includes(status)) return "blocked";
  if (["in_progress", "in progress", "active", "started"].includes(status)) return "in_progress";
  return "open";
}

router.get("/executive-overview", requireAuth, async (req, res) => {
  try {
    const firmId = getFirmId(req);

    if (!firmId) {
      return res.status(401).json({ error: "Missing firm context" });
    }

    const workspaceResult = await pool.query(
      `
        SELECT *
        FROM workspaces
        WHERE firm_id = $1
        ORDER BY
          CASE LOWER(COALESCE(status, 'active')) WHEN 'active' THEN 0 ELSE 1 END,
          updated_at DESC,
          created_at DESC
      `,
      [firmId]
    );

    const taskResult = await pool.query(
      `
        SELECT *
        FROM tasks
        WHERE firm_id = $1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1000
      `,
      [firmId]
    );

    const workspaces = workspaceResult.rows || [];
    const tasks = taskResult.rows || [];

    const rows = workspaces.map((workspace) => {
      const workspaceTasks = tasks.filter(
        (task) => String(task.workspace_id || "") === String(workspace.id)
      );

      const openTasks = workspaceTasks.filter((task) => normalizeStatus(task.status) !== "complete");
      const completedTasks = workspaceTasks.filter((task) => normalizeStatus(task.status) === "complete");
      const blockedTasks = workspaceTasks.filter((task) => normalizeStatus(task.status) === "blocked");
      const highPriorityTasks = workspaceTasks.filter((task) =>
        ["critical", "high"].includes(String(task.priority || "").toLowerCase())
      );

      const countyEscalations = workspaceTasks.filter((task) => {
        const metadata = task.metadata || {};
        const source = String(task.source || metadata.source || "").toLowerCase();

        return (
          source.includes("state_operations") ||
          source.includes("county") ||
          Boolean(metadata.county || metadata.county_name || metadata.heat_score)
        );
      });

      const activeCountyEscalations = countyEscalations.filter(
        (task) => normalizeStatus(task.status) !== "complete"
      );

      const completionRate = workspaceTasks.length
        ? Math.round((completedTasks.length / workspaceTasks.length) * 100)
        : 0;

      const pressureScore = Math.min(
        100,
        Math.round(
          openTasks.length * 6 +
            blockedTasks.length * 10 +
            highPriorityTasks.length * 9 +
            activeCountyEscalations.length * 14 +
            Math.max(0, 70 - completionRate) * 0.25
        )
      );

      const risk = riskFromScore(pressureScore);

      return {
        id: workspace.id,
        name: workspace.name,
        candidate_name: workspace.candidate_name,
        state: workspace.state || "National",
        office: workspace.office || "Statewide",
        cycle: workspace.cycle || "2026",
        status: workspace.status || "active",
        description: workspace.description,
        pressure_score: pressureScore,
        risk,
        task_count: workspaceTasks.length,
        open_task_count: openTasks.length,
        completed_task_count: completedTasks.length,
        blocked_task_count: blockedTasks.length,
        high_priority_task_count: highPriorityTasks.length,
        county_escalation_count: countyEscalations.length,
        active_county_escalation_count: activeCountyEscalations.length,
        completion_rate: completionRate,
        latest_tasks: workspaceTasks.slice(0, 5),
        updated_at: workspace.updated_at,
      };
    });

    const ranked = [...rows].sort((a, b) => b.pressure_score - a.pressure_score);

    return res.json({
      ok: true,
      summary: {
        total_workspaces: rows.length,
        active_workspaces: rows.filter((item) => String(item.status).toLowerCase() === "active").length,
        critical_workspaces: rows.filter((item) => item.risk === "Critical").length,
        high_risk_workspaces: rows.filter((item) => ["Critical", "High"].includes(item.risk)).length,
        total_tasks: tasks.length,
        open_tasks: tasks.filter((task) => normalizeStatus(task.status) !== "complete").length,
        completed_tasks: tasks.filter((task) => normalizeStatus(task.status) === "complete").length,
        blocked_tasks: tasks.filter((task) => normalizeStatus(task.status) === "blocked").length,
        national_pressure_score: rows.length
          ? Math.round(rows.reduce((sum, item) => sum + item.pressure_score, 0) / rows.length)
          : 0,
      },
      workspaces: ranked,
      urgent_workspaces: ranked.filter((item) => ["Critical", "High"].includes(item.risk)).slice(0, 10),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[workspace-intelligence] executive overview failed", error);
    return res.status(500).json({
      error: "Failed to load cross-workspace executive intelligence.",
      detail: error.message,
    });
  }
});

export default router;
