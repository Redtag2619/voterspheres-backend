import { pool } from "../db/pool.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";
import { getAiStrategicAdvisor } from "./aiStrategicAdvisor.service.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
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

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function reportTitle(type = "daily_brief", state = "") {
  const label = {
    daily_brief: "Daily Intelligence Brief",
    executive_summary: "Executive Summary",
    state_report: "State Intelligence Report",
    donor_report: "Donor & Fundraising Report",
    opposition_watch: "Opposition Watch Report",
    rapid_response: "Rapid Response Brief",
  }[type] || "Intelligence Report";

  return state ? `${state} ${label}` : label;
}

export async function ensureIntelligenceReportsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_reports (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      title TEXT NOT NULL,
      report_type TEXT DEFAULT 'daily_brief',
      state TEXT NULL,
      status TEXT DEFAULT 'generated',
      executive_summary TEXT NULL,
      report_body TEXT NOT NULL,
      sections JSONB DEFAULT '{}'::jsonb,
      source_snapshot JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intelligence_reports_firm
    ON intelligence_reports (firm_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_intelligence_reports_workspace
    ON intelligence_reports (firm_id, workspace_id, created_at DESC);
  `);
}

function buildReportBody({ title, type, state, mission, advisor }) {
  const summary = mission.summary || {};
  const advisorSummary = advisor.summary || {};
  const recommendations = advisor.recommendations || [];
  const missionItems = mission.mission_items || [];
  const signals = mission.critical_signals || [];
  const tasks = mission.open_tasks || [];
  const crm = mission.crm_followups || [];
  const workspaces = mission.workspace_health || [];

  const topRecommendations = recommendations.slice(0, 6);
  const topMissionItems = missionItems.slice(0, 8);
  const topSignals = signals.slice(0, 6);
  const topTasks = tasks.slice(0, 6);
  const topCrm = crm.slice(0, 5);
  const topWorkspaces = workspaces.slice(0, 6);

  const lines = [];

  lines.push(`# ${title}`);
  lines.push(`Generated: ${todayLabel()}`);
  if (state) lines.push(`Scope: ${state}`);
  lines.push("");

  lines.push("## Executive Summary");
  lines.push(
    `Current mission risk is ${summary.mission_risk || advisorSummary.strategic_risk || "Stable"} with a pressure score of ${summary.pressure_score || advisorSummary.pressure_score || 0}%.`
  );
  lines.push(
    `VoterSpheres is tracking ${summary.critical_signals || advisorSummary.signals || 0} priority signals, ${summary.open_tasks || advisorSummary.open_tasks || 0} open tasks, ${summary.crm_followups || advisorSummary.crm_followups || 0} CRM follow-ups, and ${summary.vendor_gaps || advisorSummary.vendor_gaps || 0} vendor gaps.`
  );
  lines.push("");

  lines.push("## Recommended Actions");
  if (topRecommendations.length) {
    topRecommendations.forEach((item, index) => {
      lines.push(`${index + 1}. ${clean(item.title)} — ${clean(item.expected_impact || item.why || "Review and assign owner.")}`);
    });
  } else {
    lines.push("No urgent strategic recommendations detected. Continue monitoring.");
  }
  lines.push("");

  lines.push("## Next 24 Hours Mission Queue");
  if (topMissionItems.length) {
    topMissionItems.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.type || "Mission"}] ${clean(item.title)} — Priority: ${item.priority || "Medium"}; State: ${item.state || "National"}.`);
    });
  } else {
    lines.push("No mission queue items detected.");
  }
  lines.push("");

  lines.push("## Political Signal Watch");
  if (topSignals.length) {
    topSignals.forEach((signal, index) => {
      lines.push(`${index + 1}. ${clean(signal.title)} — ${signal.state || "National"} • ${signal.risk || signal.severity || "Stable"} • Score ${signal.signal_score || 0}.`);
    });
  } else {
    lines.push("No priority political signals detected.");
  }
  lines.push("");

  lines.push("## Execution Task Review");
  if (topTasks.length) {
    topTasks.forEach((task, index) => {
      lines.push(`${index + 1}. ${clean(task.title || "Task")} — ${task.status || "open"} • ${task.priority || "medium"} • ${task.assigned_to || "Unassigned"}.`);
    });
  } else {
    lines.push("No open execution tasks detected.");
  }
  lines.push("");

  lines.push("## CRM Follow-Ups");
  if (topCrm.length) {
    topCrm.forEach((item, index) => {
      lines.push(`${index + 1}. ${clean(item.title)} — ${clean(item.contact_name || item.outcome || "Follow-up required")}.`);
    });
  } else {
    lines.push("No open CRM follow-ups detected.");
  }
  lines.push("");

  lines.push("## Workspace Health");
  if (topWorkspaces.length) {
    topWorkspaces.forEach((workspace, index) => {
      lines.push(`${index + 1}. ${workspace.name} — ${workspace.risk || "Stable"} risk; ${workspace.pressure_score || 0}% pressure; ${workspace.open_tasks || 0} open tasks; ${workspace.signals || 0} signals.`);
    });
  } else {
    lines.push("No workspace health records available.");
  }
  lines.push("");

  lines.push("## Consultant Notes");
  lines.push("Use this brief to guide client calls, internal staff standups, rapid response planning, and next-cycle execution decisions.");

  return lines.join("\n");
}

export async function generateIntelligenceReport({ user = {}, payload = {} }) {
  await ensureIntelligenceReportsTable();

  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) throw new Error("Missing firm context.");

  const reportType = payload.report_type || "daily_brief";
  const state = payload.state || null;
  const workspaceId = payload.workspace_id || null;
  const title = payload.title || reportTitle(reportType, state);

  const mission = await getExecutiveMissionControl({ user });
  const advisor = await getAiStrategicAdvisor({ user });

  const reportBody = buildReportBody({
    title,
    type: reportType,
    state,
    mission,
    advisor,
  });

  const executiveSummary = clean(
    advisor.ai_brief?.assessment ||
      `Mission risk is ${mission.summary?.mission_risk || "Stable"} with ${mission.summary?.critical_signals || 0} critical signals and ${mission.summary?.open_tasks || 0} open tasks.`
  );

  const sections = {
    executive_summary: executiveSummary,
    recommended_actions: advisor.recommendations?.slice(0, 8) || [],
    mission_items: mission.mission_items?.slice(0, 12) || [],
    signals: mission.critical_signals?.slice(0, 10) || [],
    tasks: mission.open_tasks?.slice(0, 10) || [],
    crm_followups: mission.crm_followups?.slice(0, 10) || [],
    workspace_health: mission.workspace_health?.slice(0, 10) || [],
  };

  const result = await pool.query(
    `
      INSERT INTO intelligence_reports (
        firm_id, workspace_id, title, report_type, state, status,
        executive_summary, report_body, sections, source_snapshot,
        created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,'generated',$6,$7,$8::jsonb,$9::jsonb,$10,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      workspaceId,
      title,
      reportType,
      state,
      executiveSummary,
      reportBody,
      JSON.stringify(sections),
      JSON.stringify({
        mission_summary: mission.summary || {},
        advisor_summary: advisor.summary || {},
        generated_at: new Date().toISOString(),
      }),
      userId,
    ]
  );

  return result.rows[0];
}

export async function listIntelligenceReports({ user = {}, limit = 50 }) {
  await ensureIntelligenceReportsTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT id, firm_id, workspace_id, title, report_type, state, status,
             executive_summary, created_at, updated_at
      FROM intelligence_reports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [firmId, Number(limit || 50)]
  );

  return result.rows;
}

export async function getIntelligenceReport({ user = {}, id }) {
  await ensureIntelligenceReportsTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT *
      FROM intelligence_reports
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [id, firmId]
  );

  if (!result.rows[0]) throw new Error("Report not found.");
  return result.rows[0];
}

export async function deleteIntelligenceReport({ user = {}, id }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  await pool.query(
    `
      DELETE FROM intelligence_reports
      WHERE id = $1 AND firm_id = $2
    `,
    [id, firmId]
  );

  return { ok: true };
}
