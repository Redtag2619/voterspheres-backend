import { pool } from "../db/pool.js";
import { ensurePoliticalSignalsTable } from "./politicalSignalIngestion.service.js";

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

function signalMeta(signal = {}) {
  if (!signal.metadata) return {};
  if (typeof signal.metadata === "object") return signal.metadata;
  try {
    return JSON.parse(signal.metadata);
  } catch {
    return {};
  }
}

function isCountyTask(task = {}) {
  const m = meta(task);
  const source = String(task.source || m.source || "").toLowerCase();

  return (
    source.includes("county") ||
    source.includes("state_operations") ||
    Boolean(m.county || m.heat_score)
  );
}

function normalizeWorkspaceState(value = "") {
  return String(value || "").trim().toUpperCase();
}

function signalMatchesWorkspace(signal = {}, workspace = {}) {
  const signalWorkspaceId = signal.workspace_id;
  const workspaceId = workspace.id;

  if (signalWorkspaceId && workspaceId && String(signalWorkspaceId) === String(workspaceId)) {
    return true;
  }

  const signalState = normalizeWorkspaceState(signal.state);
  const workspaceState = normalizeWorkspaceState(workspace.state);

  if (signalState && workspaceState && signalState === workspaceState) {
    return true;
  }

  if (!signalState && !workspaceState) {
    return true;
  }

  return false;
}

function summarizeSignals(signals = []) {
  const critical = signals.filter((s) => s.risk === "Critical").length;
  const high = signals.filter((s) => s.risk === "High").length;
  const elevated = signals.filter((s) => s.risk === "Elevated").length;

  const news = signals.filter((s) => s.signal_type === "news");
  const fec = signals.filter((s) => s.signal_type === "fec" || s.signal_type === "fundraising");
  const negativeNarrative = news.filter(
    (s) => signalMeta(s).narrative_direction === "negative"
  );

  const avgScore = signals.length
    ? Math.round(signals.reduce((sum, s) => sum + Number(s.signal_score || 0), 0) / signals.length)
    : 0;

  return {
    total: signals.length,
    critical,
    high,
    elevated,
    news: news.length,
    fec: fec.length,
    negative_narrative: negativeNarrative.length,
    average_signal_score: avgScore,
    signal_risk: riskFromScore(avgScore),
  };
}

function buildTaskRecommendations({ workspace, tasks }) {
  const open = tasks.filter((t) => status(t.status) !== "complete");
  const blocked = tasks.filter((t) => status(t.status) === "blocked");
  const high = tasks.filter((t) =>
    ["critical", "high"].includes(String(t.priority || "").toLowerCase())
  );
  const county = tasks.filter(isCountyTask);
  const activeCounty = county.filter((t) => status(t.status) !== "complete");

  const recommendations = [];

  if (activeCounty.length) {
    recommendations.push({
      type: "county_escalation",
      severity: "High",
      title: `${activeCounty.length} county escalation${activeCounty.length === 1 ? "" : "s"} require attention`,
      action: "Open State Operations, verify the top heat drivers, and assign an owner before closing the escalation.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "County Operations",
    });
  }

  if (blocked.length) {
    recommendations.push({
      type: "blocked_execution",
      severity: "High",
      title: `${blocked.length} blocked task${blocked.length === 1 ? "" : "s"} could slow campaign execution`,
      action: "Clear blocker or reassign the task to an executive owner today.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "Command Center",
    });
  }

  if (high.length) {
    recommendations.push({
      type: "high_priority_load",
      severity: "Elevated",
      title: `${high.length} high-priority task${high.length === 1 ? "" : "s"} in workspace`,
      action: "Move high-priority work into the Command Center top queue.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "Command Center",
    });
  }

  return {
    open,
    blocked,
    high,
    activeCounty,
    recommendations,
  };
}

function buildSignalRecommendations({ workspace, signals }) {
  const recommendations = [];

  const criticalSignals = signals.filter((s) => s.risk === "Critical");
  const highSignals = signals.filter((s) => s.risk === "High");
  const negativeNews = signals.filter(
    (s) => s.signal_type === "news" && signalMeta(s).narrative_direction === "negative"
  );
  const fecSignals = signals.filter(
    (s) => s.signal_type === "fec" || s.signal_type === "fundraising"
  );

  if (criticalSignals.length) {
    recommendations.push({
      type: "critical_political_signal",
      severity: "Critical",
      title: `${criticalSignals.length} critical political signal${criticalSignals.length === 1 ? "" : "s"} detected`,
      action: "Review Political Signals immediately and assign an executive response owner.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "Political Signal Engine",
      signal_count: criticalSignals.length,
    });
  }

  if (negativeNews.length) {
    recommendations.push({
      type: "negative_narrative_pressure",
      severity: negativeNews.length >= 3 ? "High" : "Elevated",
      title: `${negativeNews.length} negative narrative signal${negativeNews.length === 1 ? "" : "s"} detected`,
      action: "Open Narrative Intelligence, review full articles, and prepare rapid-response messaging.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "News Narrative Intelligence",
      signal_count: negativeNews.length,
    });
  }

  if (fecSignals.length) {
    const topFec = fecSignals
      .sort((a, b) => Number(b.signal_score || 0) - Number(a.signal_score || 0))[0];

    recommendations.push({
      type: "fec_fundraising_signal",
      severity: topFec?.risk || "Elevated",
      title: `${fecSignals.length} FEC/fundraising signal${fecSignals.length === 1 ? "" : "s"} detected`,
      action: "Review fundraising movement and compare against campaign resource allocation.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "FEC Political Signals",
      signal_count: fecSignals.length,
    });
  }

  if (highSignals.length && !criticalSignals.length) {
    recommendations.push({
      type: "high_signal_load",
      severity: "High",
      title: `${highSignals.length} high-risk political signal${highSignals.length === 1 ? "" : "s"} detected`,
      action: "Prioritize signal review and decide whether to escalate into Command Center tasks.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "Political Signal Engine",
      signal_count: highSignals.length,
    });
  }

  return recommendations;
}

function buildRecommendation({ workspace, tasks, signals }) {
  const taskIntel = buildTaskRecommendations({ workspace, tasks });
  const signalIntel = summarizeSignals(signals);
  const signalRecommendations = buildSignalRecommendations({ workspace, signals });

  const pressure = Math.min(
    100,
    Math.round(
      taskIntel.open.length * 6 +
        taskIntel.blocked.length * 12 +
        taskIntel.high.length * 10 +
        taskIntel.activeCounty.length * 14 +
        signalIntel.critical * 18 +
        signalIntel.high * 12 +
        signalIntel.negative_narrative * 10 +
        signalIntel.fec * 6 +
        signalIntel.average_signal_score * 0.22
    )
  );

  const risk = riskFromScore(pressure);

  const recommendations = [
    ...signalRecommendations,
    ...taskIntel.recommendations,
  ];

  if (!recommendations.length) {
    recommendations.push({
      type: "stable_monitoring",
      severity: "Stable",
      title: "Workspace is stable",
      action: "Continue monitoring county heat, vendors, MailOps, narrative signals, FEC signals, and task aging.",
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      state: workspace.state || "National",
      source: "AI Tactical Intelligence",
    });
  }

  return {
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    state: workspace.state || "National",
    office: workspace.office || "Statewide",
    pressure_score: pressure,
    risk,
    open_tasks: taskIntel.open.length,
    blocked_tasks: taskIntel.blocked.length,
    high_priority_tasks: taskIntel.high.length,
    county_escalations: taskIntel.activeCounty.length,
    political_signals: signalIntel.total,
    critical_signals: signalIntel.critical,
    high_signals: signalIntel.high,
    narrative_signals: signalIntel.news,
    negative_narrative_signals: signalIntel.negative_narrative,
    fec_signals: signalIntel.fec,
    average_signal_score: signalIntel.average_signal_score,
    signal_risk: signalIntel.signal_risk,
    recommendations: recommendations.slice(0, 10),
  };
}

async function loadPoliticalSignals({ firmId, limit = 1000 } = {}) {
  try {
    await ensurePoliticalSignalsTable();

    const { rows } = await pool.query(
      `
        SELECT *
        FROM political_signals
        WHERE firm_id = $1
        ORDER BY observed_at DESC, created_at DESC
        LIMIT $2
      `,
      [firmId, limit]
    );

    return rows || [];
  } catch (error) {
    console.warn("[ai-tactical] political signals unavailable", error.message);
    return [];
  }
}

export async function getAiTacticalDashboard({ firmId }) {
  const workspacesRes = await pool.query(
    `
      SELECT *
      FROM workspaces
      WHERE firm_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [firmId]
  );

  const tasksRes = await pool.query(
    `
      SELECT *
      FROM tasks
      WHERE firm_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1000
    `,
    [firmId]
  );

  const workspaces = workspacesRes.rows || [];
  const tasks = tasksRes.rows || [];
  const politicalSignals = await loadPoliticalSignals({ firmId });

  const workspaceInsights = workspaces.map((workspace) => {
    const workspaceTasks = tasks.filter(
      (task) => String(task.workspace_id || "") === String(workspace.id)
    );

    const workspaceSignals = politicalSignals.filter((signal) =>
      signalMatchesWorkspace(signal, workspace)
    );

    return buildRecommendation({
      workspace,
      tasks: workspaceTasks,
      signals: workspaceSignals,
    });
  });

  const orphanSignals = politicalSignals.filter((signal) => {
    return !workspaces.some((workspace) => signalMatchesWorkspace(signal, workspace));
  });

  if (orphanSignals.length) {
    workspaceInsights.push(
      buildRecommendation({
        workspace: {
          id: "national-signals",
          name: "National Political Signal Stream",
          state: "National",
          office: "National",
        },
        tasks: [],
        signals: orphanSignals,
      })
    );
  }

  const ranked = workspaceInsights.sort((a, b) => b.pressure_score - a.pressure_score);

  return {
    summary: {
      workspaces: ranked.length,
      critical: ranked.filter((x) => x.risk === "Critical").length,
      high: ranked.filter((x) => x.risk === "High").length,
      elevated: ranked.filter((x) => x.risk === "Elevated").length,
      political_signals: politicalSignals.length,
      narrative_signals: politicalSignals.filter((s) => s.signal_type === "news").length,
      fec_signals: politicalSignals.filter(
        (s) => s.signal_type === "fec" || s.signal_type === "fundraising"
      ).length,
      critical_signals: politicalSignals.filter((s) => s.risk === "Critical").length,
      high_signals: politicalSignals.filter((s) => s.risk === "High").length,
      total_recommendations: ranked.reduce((sum, x) => sum + x.recommendations.length, 0),
      national_pressure: ranked.length
        ? Math.round(ranked.reduce((sum, x) => sum + x.pressure_score, 0) / ranked.length)
        : 0,
    },
    workspaces: ranked,
    top_recommendations: ranked
      .flatMap((x) =>
        x.recommendations.map((r) => ({
          ...r,
          workspace_id: x.workspace_id,
          workspace_name: x.workspace_name,
          state: x.state,
        }))
      )
      .slice(0, 30),
    updated_at: new Date().toISOString(),
  };
}

export async function getAiTacticalWorkspace({ firmId, workspaceId }) {
  const workspaceRes = await pool.query(
    `
      SELECT *
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [workspaceId, firmId]
  );

  const workspace = workspaceRes.rows[0];
  if (!workspace) throw new Error("Workspace not found");

  const tasksRes = await pool.query(
    `
      SELECT *
      FROM tasks
      WHERE firm_id = $1 AND workspace_id = $2
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 500
    `,
    [firmId, workspaceId]
  );

  const politicalSignals = await loadPoliticalSignals({ firmId, limit: 500 });

  const workspaceSignals = politicalSignals.filter((signal) =>
    signalMatchesWorkspace(signal, workspace)
  );

  const intelligence = buildRecommendation({
    workspace,
    tasks: tasksRes.rows || [],
    signals: workspaceSignals,
  });

  return {
    intelligence,
    signals: workspaceSignals.slice(0, 50),
  };
}
