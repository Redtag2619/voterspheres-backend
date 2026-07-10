import { pool } from "../../db/pool.js";
import { getElectionWarRoom } from "../electionWarRoom.service.js";
import { getAiStrategicAdvisor } from "../aiStrategicAdvisor.service.js";
import { getExecutiveMissionControl } from "../executiveMissionControl.service.js";
import { clean, truncate } from "./utils.js";

export async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[ai-campaign-copilot] skipped query:", error.message);
    return [];
  }
}

export async function getPlatformContext({ user, firmId, workspaceId }) {
  const [mission, advisor, warRoom] = await Promise.all([
    getExecutiveMissionControl({ user }),
    getAiStrategicAdvisor({ user }),
    getElectionWarRoom({ user }),
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

  const donors = await safeQuery(
    `
      SELECT id, full_name, name, amount, state, committee_name, created_at
      FROM donors
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `,
    [firmId]
  );

  const vendors = await safeQuery(
    `
      SELECT id, vendor_name, name, category, state, status, contract_value, updated_at
      FROM vendors
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 10
    `
  );

  const crm = await safeQuery(
    `
      SELECT id, name, contact_name, organization, stage, status, next_step, updated_at
      FROM crm_contacts
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 10
    `,
    [firmId]
  );

  const workspaceRows = workspaceId
    ? await safeQuery(
        `
          SELECT *
          FROM campaign_workspaces
          WHERE id = $1 AND firm_id = $2
          LIMIT 1
        `,
        [workspaceId, firmId]
      )
    : [];

  return {
    mission,
    advisor,
    warRoom,
    reports,
    donors,
    vendors,
    crm,
    workspace: workspaceRows[0] || null,
  };
}

export function compactPlatformContext(context = {}) {
  const mission = context.mission || {};
  const advisor = context.advisor || {};
  const warRoom = context.warRoom || {};

  return {
    mission_summary: mission.summary || {},
    advisor_summary: advisor.summary || {},
    war_room_summary: warRoom.summary || {},
    recommendations: (advisor.recommendations || []).slice(0, 8).map((item) => ({
      title: clean(item.title),
      state: item.state || null,
      impact: clean(item.expected_impact || item.why || ""),
      priority: item.priority || item.severity || null,
    })),
    threats: (warRoom.threats || []).slice(0, 8).map((item) => ({
      title: clean(item.title),
      state: item.state || null,
      severity: item.severity || item.risk || null,
      source: item.source || "War Room",
    })),
    tasks: (mission.open_tasks || []).slice(0, 8).map((item) => ({
      title: clean(item.title || "Task"),
      priority: item.priority || "Medium",
      assigned_to: item.assigned_to || "Unassigned",
      state: item.state || null,
    })),
    crm_followups: (mission.crm_followups || context.crm || [])
      .slice(0, 8)
      .map((item) => ({
        title: clean(item.title || item.name || item.contact_name || "CRM follow-up"),
        contact: clean(item.contact_name || item.organization || ""),
        stage: item.stage || item.status || null,
        next_step: clean(item.next_step || item.outcome || ""),
      })),
    reports: (context.reports || []).slice(0, 6).map((item) => ({
      title: clean(item.title),
      type: item.report_type || "report",
      state: item.state || "National",
      summary: truncate(item.executive_summary || "", 400),
    })),
    donors: (context.donors || []).slice(0, 6).map((item) => ({
      name: clean(item.full_name || item.name || "Donor"),
      amount: item.amount || null,
      state: item.state || null,
      committee: clean(item.committee_name || ""),
    })),
    vendors: (context.vendors || []).slice(0, 6).map((item) => ({
      name: clean(item.vendor_name || item.name || "Vendor"),
      category: item.category || "General",
      state: item.state || null,
      status: item.status || null,
      contract_value: item.contract_value || null,
    })),
    workspace: context.workspace || null,
  };
}
