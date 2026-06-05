import { pool } from "../db/pool.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";
import { getAiStrategicAdvisor } from "./aiStrategicAdvisor.service.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[election-war-room] skipped query:", error.message);
    return [];
  }
}

function clean(value = "") {
  return String(value || "")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<font\b[^>]*>(.*?)<\/font>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function riskFromScore(score = 0) {
  if (score >= 85) return "Critical";
  if (score >= 65) return "High";
  if (score >= 35) return "Elevated";
  return "Stable";
}

function normalizeStatus(value = "") {
  return String(value || "").toLowerCase();
}

export async function getElectionWarRoom({ user = {} }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const mission = await getExecutiveMissionControl({ user });
  const advisor = await getAiStrategicAdvisor({ user });

  const reports = await safeQuery(
    `
      SELECT id, title, report_type, state, status, executive_summary, created_at
      FROM intelligence_reports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `,
    [firmId]
  );

  const signals = mission.critical_signals || [];
  const missionItems = mission.mission_items || [];
  const tasks = mission.open_tasks || [];
  const workspaces = mission.workspace_health || [];
  const crmFollowups = mission.crm_followups || [];
  const rapidResponses = mission.rapid_responses || [];
  const vendorGaps = mission.vendor_gaps || [];
  const recommendations = advisor.recommendations || [];

  const threats = signals.slice(0, 12).map((signal) => ({
    id: `signal-${signal.id}`,
    title: clean(signal.title || "Political signal"),
    severity:
      signal.risk && signal.risk !== "Stable"
        ? signal.risk
        : riskFromScore(signal.signal_score || 0),
    source: signal.source || signal.signal_type || "Political Signals",
    velocity: signal.signal_score ? `${signal.signal_score}` : "Live",
    recommendation: clean(signal.summary || "Review signal and assign response owner."),
    state: signal.state || "National",
    office: signal.office || "Campaign",
    risk: signal.risk || signal.severity || riskFromScore(signal.signal_score || 0),
    score: signal.signal_score || 0,
    url: signal.url || null,
    created_at: signal.observed_at || signal.created_at,
  }));

  const queue = missionItems.slice(0, 14).map((item, index) => ({
    id: item.id || `mission-${index}`,
    priority:
      ["Critical", "High"].includes(String(item.priority || "")) || index < 3
        ? "P1"
        : "P2",
    owner:
      item.type === "CRM Follow-Up"
        ? "CRM"
        : item.type === "Rapid Response"
          ? "Rapid Response"
          : item.type === "Execution Task"
            ? "Command Center"
            : "War Room",
    item: clean(item.title || "Mission item"),
    eta: index < 3 ? "Now" : "Today",
    state: item.state || "National",
    office: item.office || "Campaign",
    risk: item.priority || "Elevated",
    source: item.source || "Mission Control",
    action: item.action || "Review and assign owner.",
  }));

  const signalStream = [
    ...signals.slice(0, 10).map((signal) => ({
      id: `stream-signal-${signal.id}`,
      time: signal.observed_at
        ? new Date(signal.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "Now",
      channel: signal.source || signal.signal_type || "Signal",
      text: clean(signal.title || signal.summary || "Political signal"),
      state: signal.state || "National",
      office: signal.office || "Campaign",
      risk: signal.risk || signal.severity || riskFromScore(signal.signal_score || 0),
    })),
    ...recommendations.slice(0, 6).map((item) => ({
      id: `stream-advisor-${item.id}`,
      time: "Advisor",
      channel: "Strategic Advisor",
      text: clean(item.title || item.why || "Strategic recommendation"),
      state: item.state || "National",
      office: "Campaign",
      risk: item.priority || "Elevated",
    })),
  ].slice(0, 16);

  const commandCards = workspaces.slice(0, 8).map((workspace) => ({
    id: workspace.id,
    title: workspace.name || `Workspace ${workspace.id}`,
    state: workspace.state || "National",
    office: workspace.office || "Campaign",
    cycle: workspace.cycle || "2026",
    pressure_score: workspace.pressure_score || 0,
    risk: workspace.risk || riskFromScore(workspace.pressure_score || 0),
    open_tasks: workspace.open_tasks || 0,
    signals: workspace.signals || 0,
  }));

  const openTasks = tasks.filter(
    (task) =>
      !["complete", "completed", "done", "resolved"].includes(
        normalizeStatus(task.status)
      )
  );

  const metrics = [
    {
      label: "Mission Pressure",
      value: `${mission.summary?.pressure_score || 0}%`,
      delta: mission.summary?.mission_risk || "Stable",
      tone: Number(mission.summary?.pressure_score || 0) >= 65 ? "down" : "up",
    },
    {
      label: "Active Threats",
      value: String(threats.length),
      delta: `${threats.filter((t) => ["Critical", "High"].includes(t.severity)).length} high`,
      tone: threats.length ? "down" : "up",
    },
    {
      label: "Response Queue",
      value: String(queue.length),
      delta: "Mission items",
      tone: queue.length ? "neutral" : "up",
    },
    {
      label: "Advisor Actions",
      value: String(recommendations.length),
      delta: "Strategic recommendations",
      tone: recommendations.length ? "up" : "neutral",
    },
  ];

  return {
    metrics,
    summary: {
      mission_risk: mission.summary?.mission_risk || "Stable",
      pressure_score: mission.summary?.pressure_score || 0,
      threats: threats.length,
      queue: queue.length,
      signals: signalStream.length,
      workspaces: commandCards.length,
      open_tasks: openTasks.length,
      crm_followups: crmFollowups.length,
      rapid_responses: rapidResponses.length,
      vendor_gaps: vendorGaps.length,
      reports: reports.length,
      recommendations: recommendations.length,
    },
    threats,
    queue,
    signals: signalStream,
    command_cards: commandCards,
    recommendations: recommendations.slice(0, 10),
    tasks: openTasks.slice(0, 10),
    crm_followups: crmFollowups.slice(0, 8),
    rapid_responses: rapidResponses.slice(0, 8),
    vendor_gaps: vendorGaps.slice(0, 8),
    reports,
    updated_at: new Date().toISOString(),
  };
}
