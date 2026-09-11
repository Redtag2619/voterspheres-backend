import { pool } from "../../db/pool.js";
import { getElectionWarRoom } from "../electionWarRoom.service.js";
import { getAiStrategicAdvisor } from "../aiStrategicAdvisor.service.js";
import { getExecutiveMissionControl } from "../executiveMissionControl.service.js";
import { clean, truncate } from "./utils.js";

const STATE_CODES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

export function normalizeStateCode(value = "") {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (STATE_CODES[normalized]) return STATE_CODES[normalized];
  const code = normalized.toUpperCase();
  return Object.values(STATE_CODES).includes(code) ? code : null;
}

function itemStateCode(item = {}) {
  return normalizeStateCode(
    item.state || item.state_code || item.geography || item.jurisdiction || ""
  );
}

function scopeRows(rows = [], state = null, strictGeography = false) {
  if (!strictGeography || !state) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter(
    (item) => itemStateCode(item) === state
  );
}

function scopePlatformSections({ mission = {}, advisor = {}, warRoom = {}, state, strictGeography }) {
  if (!strictGeography || !state) return { mission, advisor, warRoom };

  return {
    mission: {
      ...mission,
      mission_items: scopeRows(mission.mission_items, state, true),
      critical_signals: scopeRows(mission.critical_signals, state, true),
      open_tasks: scopeRows(mission.open_tasks, state, true),
      rapid_responses: scopeRows(mission.rapid_responses, state, true),
      crm_followups: scopeRows(mission.crm_followups, state, true),
      workspace_health: scopeRows(mission.workspace_health, state, true),
      vendor_gaps: scopeRows(mission.vendor_gaps, state, true),
    },
    advisor: {
      ...advisor,
      recommendations: scopeRows(advisor.recommendations, state, true),
      risks: scopeRows(advisor.risks, state, true),
      opportunities: scopeRows(advisor.opportunities, state, true),
    },
    warRoom: {
      ...warRoom,
      threats: scopeRows(warRoom.threats, state, true),
      queue: scopeRows(warRoom.queue, state, true),
      signals: scopeRows(warRoom.signals, state, true),
      command_cards: scopeRows(warRoom.command_cards, state, true),
    },
  };
}

export async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[ai-campaign-copilot] skipped query:", error.message);
    return [];
  }
}

export async function getPlatformContext({
  user,
  firmId,
  workspaceId,
  state: requestedState = null,
  office = null,
  cycle = null,
  campaign = null,
  strictGeography = false,
}) {
  const state = normalizeStateCode(requestedState);
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
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 10
    `,
    [firmId]
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

  const scopedSections = scopePlatformSections({
    mission,
    advisor,
    warRoom,
    state,
    strictGeography,
  });

  const workspace = workspaceRows[0] || null;
  const workspaceMatchesState =
    !strictGeography || !state || !workspace || itemStateCode(workspace) === state;

  return {
    ...scopedSections,
    reports: scopeRows(reports, state, strictGeography),
    donors: scopeRows(donors, state, strictGeography),
    vendors: scopeRows(vendors, state, strictGeography),
    crm: scopeRows(crm, state, strictGeography),
    workspace: workspaceMatchesState ? workspace : null,
    scope: {
      state,
      office: clean(office) || null,
      cycle: clean(cycle) || null,
      campaign: clean(campaign) || null,
      strict_geography: Boolean(strictGeography && state),
    },
  };
}

export function compactPlatformContext(context = {}) {
  const mission = context.mission || {};
  const advisor = context.advisor || {};
  const warRoom = context.warRoom || {};
  const strictGeography = Boolean(context.scope?.strict_geography);
  const scopedState = context.scope?.state || null;

  return {
    mission_summary: strictGeography
      ? {
          state: scopedState,
          open_tasks: (mission.open_tasks || []).length,
          critical_signals: (mission.critical_signals || []).length,
          crm_followups: (mission.crm_followups || []).length,
        }
      : mission.summary || {},
    advisor_summary: strictGeography
      ? { state: scopedState, recommendations: (advisor.recommendations || []).length }
      : advisor.summary || {},
    war_room_summary: strictGeography
      ? {
          state: scopedState,
          threats: (warRoom.threats || []).length,
          signals: (warRoom.signals || []).length,
        }
      : warRoom.summary || {},
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
        state: item.state || item.state_code || null,
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
    scope: context.scope || null,
  };
}

