import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function riskTone(score = 0) {
  if (score >= 85) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function normalizeRows(result) {
  return result?.rows || [];
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return normalizeRows(result);
  } catch (error) {
    console.warn("[mission-control] skipped query:", error.message);
    return [];
  }
}

export async function getExecutiveMissionControl({ user = {} }) {
  const firmId = getFirmId(user);

  if (!firmId) {
    throw new Error("Missing firm context.");
  }

  const signals = await safeQuery(
    `
      SELECT *
      FROM political_signals
      WHERE firm_id = $1
      ORDER BY signal_score DESC NULLS LAST, observed_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 75
    `,
    [firmId]
  );

  const tasks = await safeQuery(
    `
      SELECT *
      FROM tasks
      WHERE firm_id = $1
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(priority, '')) = 'critical' THEN 1
          WHEN LOWER(COALESCE(priority, '')) = 'high' THEN 2
          WHEN LOWER(COALESCE(priority, '')) = 'medium' THEN 3
          ELSE 4
        END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
      LIMIT 75
    `,
    [firmId]
  );

  const workspaces = await safeQuery(
    `
      SELECT *
      FROM workspaces
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId]
  );

  const crmContacts = await safeQuery(
    `
      SELECT *
      FROM campaign_crm_contacts
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId]
  );

  const crmActivities = await safeQuery(
    `
      SELECT a.*, c.full_name AS contact_name
      FROM campaign_crm_activities a
      LEFT JOIN campaign_crm_contacts c ON c.id = a.contact_id
      WHERE a.firm_id = $1
      ORDER BY a.created_at DESC
      LIMIT 50
    `,
    [firmId]
  );

  const rapidResponses = await safeQuery(
    `
      SELECT *
      FROM narrative_rapid_responses
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId]
  );

  const vendors = await safeQuery(
    `
      SELECT *
      FROM vendors
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId]
  );

  const openTasks = tasks.filter(
    (task) =>
      !["complete", "completed", "done", "resolved"].includes(
        String(task.status || "").toLowerCase()
      )
  );

  const criticalSignals = signals.filter((signal) => {
    const risk = String(signal.risk || signal.severity || "").toLowerCase();
    const score = Number(signal.signal_score || 0);
    return risk === "critical" || risk === "high" || score >= 65;
  });

  const openResponses = rapidResponses.filter(
    (item) =>
      !["complete", "completed", "done", "resolved"].includes(
        String(item.status || "").toLowerCase()
      )
  );

  const openCrmFollowUps = crmActivities.filter((item) => !item.completed_at);

  const vendorGaps = vendors.filter((vendor) => {
    const status = String(vendor.status || "").toLowerCase();
    const coverage = String(vendor.coverage_tier || vendor.risk || "").toLowerCase();
    return status.includes("gap") || coverage.includes("thin") || coverage.includes("risk");
  });

  const missionScore =
    Math.min(100, criticalSignals.length * 12) +
    Math.min(30, openTasks.length * 2) +
    Math.min(20, openResponses.length * 4);

  const pressureScore = Math.min(100, missionScore);

  const missionItems = [
    ...criticalSignals.slice(0, 8).map((signal) => ({
      id: `signal-${signal.id}`,
      type: "Political Signal",
      title: signal.title || "Political signal",
      description: signal.summary || signal.source || "Review political signal.",
      priority: signal.risk || signal.severity || riskTone(signal.signal_score || 0),
      state: signal.state || "National",
      source: signal.source || signal.signal_type || "Signal Engine",
      action: "Review signal and assign response.",
      url: signal.url || null,
      created_at: signal.observed_at || signal.created_at,
    })),
    ...openTasks.slice(0, 8).map((task) => ({
      id: `task-${task.id}`,
      type: "Execution Task",
      title: task.title || "Open task",
      description: task.description || task.source || "Execution item needs attention.",
      priority: task.priority || "Medium",
      state: task.state || "National",
      source: task.source || "Command Center",
      action: "Assign owner or complete task.",
      url: null,
      created_at: task.updated_at || task.created_at,
    })),
    ...openResponses.slice(0, 6).map((response) => ({
      id: `response-${response.id}`,
      type: "Rapid Response",
      title: response.title || "Narrative response",
      description:
        response.response_strategy ||
        response.narrative_summary ||
        "Narrative response requires action.",
      priority: response.threat_level || response.status || "Medium",
      state: response.state || "National",
      source: "Narrative Rapid Response",
      action: "Finalize response and assign owner.",
      url: null,
      created_at: response.updated_at || response.created_at,
    })),
    ...openCrmFollowUps.slice(0, 6).map((activity) => ({
      id: `crm-${activity.id}`,
      type: "CRM Follow-Up",
      title: activity.title || "CRM follow-up",
      description:
        activity.body ||
        activity.outcome ||
        activity.contact_name ||
        "CRM activity needs follow-up.",
      priority: "Medium",
      state: activity.state || "National",
      source: "Campaign CRM",
      action: "Complete CRM activity.",
      url: null,
      created_at: activity.created_at,
    })),
  ]
    .sort((a, b) => {
      const ap = ["Critical", "High"].includes(String(a.priority)) ? 1 : 2;
      const bp = ["Critical", "High"].includes(String(b.priority)) ? 1 : 2;
      return ap - bp;
    })
    .slice(0, 24);

  const workspaceHealth = workspaces.slice(0, 12).map((workspace) => {
    const workspaceTasks = tasks.filter(
      (task) => String(task.workspace_id || "") === String(workspace.id)
    );

    const workspaceSignals = signals.filter(
      (signal) => String(signal.workspace_id || "") === String(workspace.id)
    );

    const open = workspaceTasks.filter(
      (task) =>
        !["complete", "completed", "done", "resolved"].includes(
          String(task.status || "").toLowerCase()
        )
    ).length;

    const signalScore = workspaceSignals.reduce(
      (sum, signal) => sum + Number(signal.signal_score || 0),
      0
    );

    const score = Math.min(
      100,
      Math.round(open * 8 + signalScore / Math.max(1, workspaceSignals.length || 1))
    );

    return {
      id: workspace.id,
      name: workspace.name || workspace.campaign_name || workspace.title || `Workspace ${workspace.id}`,
      state: workspace.state || "National",
      office: workspace.office || "Campaign",
      cycle: workspace.cycle || "2026",
      open_tasks: open,
      signals: workspaceSignals.length,
      pressure_score: score,
      risk: riskTone(score),
    };
  });

  return {
    summary: {
      pressure_score: pressureScore,
      mission_risk: riskTone(pressureScore),
      critical_signals: criticalSignals.length,
      open_tasks: openTasks.length,
      rapid_responses: openResponses.length,
      crm_followups: openCrmFollowUps.length,
      workspaces: workspaces.length,
      vendor_gaps: vendorGaps.length,
    },
    mission_items: missionItems,
    critical_signals: criticalSignals.slice(0, 15),
    open_tasks: openTasks.slice(0, 20),
    rapid_responses: openResponses.slice(0, 12),
    crm_followups: openCrmFollowUps.slice(0, 12),
    workspace_health: workspaceHealth,
    vendor_gaps: vendorGaps.slice(0, 12),
    ai_recommendations: [
      criticalSignals.length
        ? "Critical political signals are active. Assign rapid response owners before the next news cycle."
        : "No critical political signal surge detected. Continue monitoring.",
      openTasks.length
        ? "Open execution tasks remain. Prioritize high and critical tasks for the next 24 hours."
        : "Execution queue is clean. Maintain current operating cadence.",
      openCrmFollowUps.length
        ? "CRM follow-ups are open. Complete stakeholder touches before new outreach begins."
        : "No urgent CRM follow-up backlog detected.",
      vendorGaps.length
        ? "Vendor coverage gaps exist. Review vendor network before launching new field, mail, or digital actions."
        : "Vendor coverage appears stable.",
    ],
    updated_at: new Date().toISOString(),
  };
}
