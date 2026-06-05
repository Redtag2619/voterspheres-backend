import { getElectionWarRoom } from "./electionWarRoom.service.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";
import { getAiStrategicAdvisor } from "./aiStrategicAdvisor.service.js";
import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[national-command] skipped query:", error.message);
    return [];
  }
}

export async function getNationalElectionCommandCenter({ user = {} }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const [mission, warRoom, advisor] = await Promise.all([
    getExecutiveMissionControl({ user }),
    getElectionWarRoom({ user }),
    getAiStrategicAdvisor({ user }),
  ]);

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

  const exports = await safeQuery(
    `
      SELECT id, report_id, export_type, title, status, metadata, created_at
      FROM report_exports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `,
    [firmId]
  );

  const clients = await safeQuery(
    `
      SELECT id, client_name, organization, email, access_level, status,
             workspace_id, last_viewed_at, created_at
      FROM client_portal_clients
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `,
    [firmId]
  );

  const missionItems = mission.mission_items || [];
  const threats = warRoom.threats || [];
  const recommendations = advisor.recommendations || [];

  const command_items = [
    ...missionItems.slice(0, 6),
    ...threats.slice(0, 6).map((item) => ({
      id: `threat-${item.id}`,
      title: item.title,
      description: item.recommendation,
      priority: item.severity || item.risk,
      state: item.state || "National",
      source: item.source || "Election War Room",
      type: "Threat",
    })),
    ...recommendations.slice(0, 6).map((item) => ({
      id: `advisor-${item.id}`,
      title: item.title,
      description: item.why || item.expected_impact,
      priority: item.priority,
      state: item.state || "National",
      source: "AI Strategic Advisor",
      type: item.category || "Recommendation",
    })),
  ].slice(0, 18);

  const pressureScore =
    mission.summary?.pressure_score ??
    warRoom.summary?.pressure_score ??
    advisor.summary?.pressure_score ??
    0;

  const missionRisk =
    mission.summary?.mission_risk ||
    warRoom.summary?.mission_risk ||
    advisor.summary?.strategic_risk ||
    "Stable";

  return {
    summary: {
      mission_risk: missionRisk,
      pressure_score: pressureScore,
      command_items: command_items.length,
      threats: threats.length,
      response_queue: (warRoom.queue || []).length,
      recommendations: recommendations.length,
      reports: reports.length,
      exports: exports.length,
      client_portals: clients.length,
      active_clients: clients.filter((c) => c.status === "active").length,
      workspaces: (mission.workspace_health || warRoom.command_cards || []).length,
    },
    mission,
    war_room: warRoom,
    advisor,
    command_items,
    workspace_health: mission.workspace_health || warRoom.command_cards || [],
    response_queue: warRoom.queue || [],
    reports,
    exports,
    clients,
    updated_at: new Date().toISOString(),
  };
}
