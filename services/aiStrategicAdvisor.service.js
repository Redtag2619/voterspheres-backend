import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";

function scoreRecommendation(item = {}) {
  const priority = String(item.priority || item.risk || "").toLowerCase();
  const score = Number(item.signal_score || item.pressure_score || 0);

  if (priority.includes("critical")) return 95;
  if (priority.includes("high")) return 85;
  if (priority.includes("elevated")) return 70;
  return Math.max(45, Math.min(75, score || 50));
}

function actionFor(item = {}) {
  const type = String(item.type || item.signal_type || "").toLowerCase();

  if (type.includes("signal")) {
    return [
      "Assign a rapid response owner.",
      "Review state and workspace context.",
      "Prepare donor, media, and field talking points.",
    ];
  }

  if (type.includes("task")) {
    return [
      "Confirm owner and deadline.",
      "Move blocked items into Command Center review.",
      "Escalate high-priority execution gaps.",
    ];
  }

  if (type.includes("crm")) {
    return [
      "Complete stakeholder follow-up.",
      "Log outcome in Campaign CRM.",
      "Connect follow-up to active workspace or signal.",
    ];
  }

  if (type.includes("vendor")) {
    return [
      "Review vendor coverage.",
      "Identify backup vendor options.",
      "Assign operations owner.",
    ];
  }

  return [
    "Review operational context.",
    "Assign owner.",
    "Track outcome in workspace.",
  ];
}

export async function getAiStrategicAdvisor({ user = {} }) {
  const mission = await getExecutiveMissionControl({ user });

  const missionItems = mission.mission_items || [];
  const workspaceHealth = mission.workspace_health || [];
  const signals = mission.critical_signals || [];
  const tasks = mission.open_tasks || [];
  const crm = mission.crm_followups || [];
  const vendors = mission.vendor_gaps || [];

  const recommendations = [
    ...missionItems.map((item) => ({
      id: `advisor-${item.id}`,
      title: item.title || "Strategic recommendation",
      category: item.type || "Mission",
      priority: item.priority || "Medium",
      state: item.state || "National",
      source: item.source || "Mission Control",
      confidence: scoreRecommendation(item),
      why:
        item.description ||
        "This item is creating operational pressure across the campaign environment.",
      recommended_actions: actionFor(item),
      expected_impact:
        scoreRecommendation(item) >= 85
          ? "High impact if addressed in the next 24 hours."
          : "Moderate impact if handled during the next operating cycle.",
      created_at: item.created_at || new Date().toISOString(),
    })),
    ...workspaceHealth
      .filter((w) => Number(w.pressure_score || 0) >= 40)
      .map((w) => ({
        id: `advisor-workspace-${w.id}`,
        title: `${w.name} workspace pressure requires review`,
        category: "Workspace Health",
        priority: w.risk || "Elevated",
        state: w.state || "National",
        source: "Workspace Intelligence",
        confidence: Number(w.pressure_score || 55),
        why: `${w.open_tasks || 0} open tasks and ${w.signals || 0} signals are contributing to workspace pressure.`,
        recommended_actions: [
          "Review open workspace tasks.",
          "Assign owners to unresolved pressure points.",
          "Use Mission Control to prioritize next 24-hour actions.",
        ],
        expected_impact: "Improves execution clarity and reduces workspace pressure.",
        created_at: new Date().toISOString(),
      })),
  ]
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 30);

  return {
    summary: {
      recommendations: recommendations.length,
      high_priority: recommendations.filter((r) => Number(r.confidence || 0) >= 85).length,
      signals: signals.length,
      open_tasks: tasks.length,
      crm_followups: crm.length,
      vendor_gaps: vendors.length,
      strategic_risk: mission.summary?.mission_risk || "Stable",
      pressure_score: mission.summary?.pressure_score || 0,
    },
    recommendations,
    ai_brief: {
      headline:
        recommendations[0]?.title ||
        "No urgent strategic advisory actions detected.",
      assessment:
        recommendations.length > 0
          ? "VoterSpheres detected active operating pressure. Review the ranked recommendations and assign owners."
          : "Current operating environment is stable. Continue monitoring signals, tasks, and CRM follow-ups.",
      next_24_hours: recommendations.slice(0, 5).map((r) => r.title),
    },
    source_summary: mission.summary,
    updated_at: new Date().toISOString(),
  };
}
