import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { emitRealtimeEvent } from "../services/realtime.service.js";

const router = express.Router();

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizeStatus(value = "open") {
  const status = text(value).toLowerCase();
  if (["complete", "completed", "done", "resolved"].includes(status)) return "complete";
  if (["blocked", "paused", "hold"].includes(status)) return "blocked";
  if (["in_progress", "in progress", "active", "started"].includes(status)) return "in_progress";
  return "open";
}

function riskFromScore(score = 0) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function isCountyEscalation(task = {}) {
  const metadata = task.metadata || {};
  const source = String(task.source || metadata.source || "").toLowerCase();

  return (
    source.includes("state_operations") ||
    source.includes("county") ||
    Boolean(metadata.county || metadata.county_name || metadata.heat_score)
  );
}

function hoursOld(task = {}) {
  const raw = task.updated_at || task.created_at;
  if (!raw) return 0;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 36e5));
}

async function requireWorkspaceAccess(req, res) {
  const firmId = getFirmId(req);
  const workspaceId = Number(req.params.id);

  if (!firmId) {
    res.status(401).json({ error: "Missing firm context" });
    return null;
  }

  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return null;
  }

  const result = await pool.query(
    `
      SELECT *
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [workspaceId, firmId]
  );

  const workspace = result.rows[0];

  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return null;
  }

  return { firmId, workspaceId, workspace };
}

function buildInsights({ workspace, tasks, countyEscalations, pressureScore, risk }) {
  const insights = [];

  if (risk === "Critical" || risk === "High") {
    insights.push({
      id: "pressure-risk",
      severity: risk,
      title: `${workspace.name} operating pressure is ${risk.toLowerCase()}`,
      recommendation: "Assign owners to unresolved high-priority tasks and review county escalation status.",
      source: "Workspace Pressure Engine",
    });
  }

  const blocked = tasks.filter((task) => normalizeStatus(task.status) === "blocked");

  if (blocked.length) {
    insights.push({
      id: "blocked-tasks",
      severity: "High",
      title: `${blocked.length} blocked task${blocked.length === 1 ? "" : "s"} need executive review`,
      recommendation: "Clear blocker, reassign owner, or escalate to Command Center.",
      source: "Workspace Command Center",
    });
  }

  const activeCounty = countyEscalations.filter((task) => normalizeStatus(task.status) !== "complete");

  if (activeCounty.length) {
    insights.push({
      id: "active-county-escalations",
      severity: "High",
      title: `${activeCounty.length} active county escalation${activeCounty.length === 1 ? "" : "s"}`,
      recommendation: "Open State Operations and verify top heat drivers before closing tasks.",
      source: "County Operations Layer",
    });
  }

  if (!insights.length) {
    insights.push({
      id: "stable-workspace",
      severity: "Stable",
      title: "Workspace is operationally stable",
      recommendation: "Continue monitoring tasks, county pressure, vendors, and MailOps.",
      source: "Workspace Intelligence",
    });
  }

  return insights.slice(0, 8);
}

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const tasksResult = await pool.query(
      `
        SELECT *
        FROM tasks
        WHERE firm_id = $1
          AND workspace_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 500
      `,
      [access.firmId, access.workspaceId]
    );

    const tasks = tasksResult.rows || [];

    const openTasks = tasks.filter((task) => normalizeStatus(task.status) !== "complete");
    const completedTasks = tasks.filter((task) => normalizeStatus(task.status) === "complete");
    const blockedTasks = tasks.filter((task) => normalizeStatus(task.status) === "blocked");
    const inProgressTasks = tasks.filter((task) => normalizeStatus(task.status) === "in_progress");
    const highPriorityTasks = tasks.filter((task) =>
      ["critical", "high"].includes(String(task.priority || "").toLowerCase())
    );
    const countyEscalations = tasks.filter(isCountyEscalation);
    const activeCountyEscalations = countyEscalations.filter(
      (task) => normalizeStatus(task.status) !== "complete"
    );

    const agingTasks = openTasks.filter((task) => hoursOld(task) >= 24);
    const completionRate = tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

    const pressureScore = Math.min(
      100,
      Math.round(
        openTasks.length * 6 +
          blockedTasks.length * 12 +
          highPriorityTasks.length * 9 +
          activeCountyEscalations.length * 14 +
          agingTasks.length * 4 +
          Math.max(0, 70 - completionRate) * 0.25
      )
    );

    const risk = riskFromScore(pressureScore);

    const ownerMap = new Map();

    for (const task of tasks) {
      const owner = task.assigned_to || "Command Team";
      const current = ownerMap.get(owner) || {
        owner,
        total: 0,
        open: 0,
        complete: 0,
        blocked: 0,
        high: 0,
      };

      current.total += 1;
      if (normalizeStatus(task.status) !== "complete") current.open += 1;
      if (normalizeStatus(task.status) === "complete") current.complete += 1;
      if (normalizeStatus(task.status) === "blocked") current.blocked += 1;
      if (["critical", "high"].includes(String(task.priority || "").toLowerCase())) current.high += 1;

      ownerMap.set(owner, current);
    }

    const insights = buildInsights({
      workspace: access.workspace,
      tasks,
      countyEscalations,
      pressureScore,
      risk,
    });

    return res.json({
      ok: true,
      workspace: access.workspace,
      summary: {
        workspace_id: access.workspaceId,
        workspace_name: access.workspace.name,
        pressure_score: pressureScore,
        risk,
        total_tasks: tasks.length,
        open_tasks: openTasks.length,
        completed_tasks: completedTasks.length,
        blocked_tasks: blockedTasks.length,
        in_progress_tasks: inProgressTasks.length,
        high_priority_tasks: highPriorityTasks.length,
        aging_tasks: agingTasks.length,
        completion_rate: completionRate,
        county_escalations: countyEscalations.length,
        active_county_escalations: activeCountyEscalations.length,
      },
      tasks: tasks.slice(0, 100),
      countyEscalations: countyEscalations.slice(0, 50),
      owners: Array.from(ownerMap.values()).sort((a, b) => b.open - a.open),
      insights,
      activity: tasks.slice(0, 30).map((task) => ({
        id: `task-${task.id}`,
        type: `task.${normalizeStatus(task.status)}`,
        title: task.title,
        description: task.description,
        state: task.state,
        priority: task.priority,
        status: task.status,
        owner: task.assigned_to || "Command Team",
        created_at: task.updated_at || task.created_at,
      })),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[workspace-operating-room] failed", error);
    return res.status(500).json({
      error: "Failed to load campaign workspace operating room.",
      detail: error.message,
    });
  }
});

router.post("/:id/pulse", requireAuth, async (req, res) => {
  try {
    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const event = emitRealtimeEvent({
      type: "workspace.pressure.changed",
      channel: "workspace:operating-room",
      workspace_id: access.workspaceId,
      firm_id: access.firmId,
      state: access.workspace.state,
      payload: {
        workspace_id: access.workspaceId,
        workspace_name: access.workspace.name,
        message: req.body?.message || "Workspace pulse emitted.",
      },
    });

    return res.json({ ok: true, event });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to emit workspace pulse.",
    });
  }
});

export default router;
