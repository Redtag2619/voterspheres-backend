import { pool } from "../db/pool.js";
import { getElectionWarRoom } from "./electionWarRoom.service.js";
import { getAiStrategicAdvisor } from "./aiStrategicAdvisor.service.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";

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

function lower(value = "") {
  return String(value || "").toLowerCase();
}

function includesAny(text, words = []) {
  const value = lower(text);
  return words.some((word) => value.includes(lower(word)));
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[ai-campaign-copilot] skipped query:", error.message);
    return [];
  }
}

export async function ensureAiCampaignCopilotTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_campaign_copilot_threads (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      title TEXT DEFAULT 'Campaign Co-Pilot Conversation',
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_campaign_copilot_messages (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      thread_id INTEGER NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      context_snapshot JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_campaign_copilot_threads_firm
    ON ai_campaign_copilot_threads (firm_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ai_campaign_copilot_messages_firm_thread
    ON ai_campaign_copilot_messages (firm_id, thread_id, created_at ASC);
  `);
}

function summarizeTop(items = [], mapper, limit = 5) {
  return items.slice(0, limit).map(mapper).filter(Boolean);
}

function buildAnswer({ prompt, warRoom, advisor, mission, reports }) {
  const normalizedPrompt = lower(prompt);

  const recommendations = advisor.recommendations || [];
  const threats = warRoom.threats || [];
  const queue = warRoom.queue || [];
  const signals = warRoom.signals || [];
  const workspaces = warRoom.command_cards || mission.workspace_health || [];
  const tasks = mission.open_tasks || [];
  const crm = mission.crm_followups || [];
  const rapidResponses = mission.rapid_responses || [];
  const vendorGaps = mission.vendor_gaps || [];

  const wantsState = normalizedPrompt.match(/\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy)\b/i)?.[0]?.toUpperCase();

  const stateFilter = (item) => {
    if (!wantsState) return true;
    return String(item.state || "").toUpperCase() === wantsState;
  };

  const scopedRecommendations = recommendations.filter(stateFilter);
  const scopedThreats = threats.filter(stateFilter);
  const scopedQueue = queue.filter(stateFilter);
  const scopedSignals = signals.filter(stateFilter);
  const scopedWorkspaces = workspaces.filter(stateFilter);
  const scopedTasks = tasks.filter(stateFilter);
  const scopedCrm = crm.filter(stateFilter);

  let intent = "general";
  if (includesAny(prompt, ["what should", "next", "do", "recommend", "strategy", "plan"])) intent = "strategy";
  if (includesAny(prompt, ["signal", "threat", "risk", "narrative", "attack"])) intent = "signals";
  if (includesAny(prompt, ["task", "owner", "execution", "backlog"])) intent = "tasks";
  if (includesAny(prompt, ["crm", "contact", "stakeholder", "follow up", "client"])) intent = "crm";
  if (includesAny(prompt, ["report", "brief", "memo", "summary"])) intent = "reports";
  if (includesAny(prompt, ["vendor", "mail", "digital", "field"])) intent = "vendors";

  const scopeText = wantsState ? ` for ${wantsState}` : "";

  const topActions = summarizeTop(
    scopedRecommendations.length ? scopedRecommendations : recommendations,
    (item, index) => `${index + 1}. ${clean(item.title)} — ${clean(item.expected_impact || item.why || "Assign owner and track outcome.")}`,
    5
  );

  const topThreats = summarizeTop(
    scopedThreats.length ? scopedThreats : threats,
    (item, index) => `${index + 1}. ${clean(item.title)} — ${item.severity || item.risk || "Signal"} from ${item.source || "War Room"}.`,
    5
  );

  const topQueue = summarizeTop(
    scopedQueue.length ? scopedQueue : queue,
    (item, index) => `${index + 1}. ${clean(item.item)} — Owner: ${item.owner || "Command Team"}; ETA: ${item.eta || "Today"}.`,
    5
  );

  const topTasks = summarizeTop(
    scopedTasks.length ? scopedTasks : tasks,
    (item, index) => `${index + 1}. ${clean(item.title || "Task")} — ${item.priority || "Medium"} priority; ${item.assigned_to || "Unassigned"}.`,
    5
  );

  const topCrm = summarizeTop(
    scopedCrm.length ? scopedCrm : crm,
    (item, index) => `${index + 1}. ${clean(item.title || "CRM follow-up")} — ${clean(item.contact_name || item.outcome || "Follow up required")}.`,
    5
  );

  const topWorkspaces = summarizeTop(
    scopedWorkspaces.length ? scopedWorkspaces : workspaces,
    (item, index) => `${index + 1}. ${clean(item.title || item.name || "Workspace")} — ${item.risk || "Stable"} risk; ${item.pressure_score || 0}% pressure.`,
    5
  );

  const latestReports = summarizeTop(
    reports,
    (item, index) => `${index + 1}. ${clean(item.title)} — ${item.report_type || "report"}; ${item.state || "National"}.`,
    4
  );

  const lines = [];

  if (intent === "strategy") {
    lines.push(`Here is the recommended campaign plan${scopeText} for the next operating cycle:`);
    lines.push("");
    lines.push("Priority actions:");
    lines.push(...(topActions.length ? topActions : ["1. No urgent recommendations detected. Continue monitoring Mission Control."]));
    lines.push("");
    lines.push("War Room queue:");
    lines.push(...(topQueue.length ? topQueue : ["1. No active response queue items."]));
    lines.push("");
    lines.push("Workspace pressure:");
    lines.push(...(topWorkspaces.length ? topWorkspaces : ["1. No workspace pressure records available."]));
  } else if (intent === "signals") {
    lines.push(`Signal and threat assessment${scopeText}:`);
    lines.push("");
    lines.push("Top threats:");
    lines.push(...(topThreats.length ? topThreats : ["1. No active threats detected."]));
    lines.push("");
    lines.push("Signal stream:");
    lines.push(...summarizeTop(scopedSignals.length ? scopedSignals : signals, (item, index) => `${index + 1}. ${clean(item.text || item.title)} — ${item.channel || "Signal"}; ${item.risk || "Watch"}.`, 5));
  } else if (intent === "tasks") {
    lines.push(`Execution task assessment${scopeText}:`);
    lines.push("");
    lines.push("Open tasks:");
    lines.push(...(topTasks.length ? topTasks : ["1. No open execution tasks detected."]));
    lines.push("");
    lines.push("Response queue:");
    lines.push(...(topQueue.length ? topQueue : ["1. No response queue items."]));
  } else if (intent === "crm") {
    lines.push(`CRM and stakeholder follow-up assessment${scopeText}:`);
    lines.push("");
    lines.push("Open CRM follow-ups:");
    lines.push(...(topCrm.length ? topCrm : ["1. No open CRM follow-ups detected."]));
    lines.push("");
    lines.push("Recommended CRM move:");
    lines.push("1. Log all stakeholder outcomes and connect important touches to the relevant workspace.");
  } else if (intent === "reports") {
    lines.push(`Available reporting intelligence${scopeText}:`);
    lines.push("");
    lines.push("Recent reports:");
    lines.push(...(latestReports.length ? latestReports : ["1. No generated reports found. Generate a Daily Intelligence Brief."]));
    lines.push("");
    lines.push("Recommended next report:");
    lines.push(`1. Generate a ${wantsState ? `${wantsState} ` : ""}Daily Intelligence Brief from the Reports page.`);
  } else if (intent === "vendors") {
    lines.push(`Vendor and operational capacity assessment${scopeText}:`);
    lines.push("");
    lines.push("Vendor gaps:");
    lines.push(
      ...(vendorGaps.length
        ? summarizeTop(vendorGaps.filter(stateFilter), (item, index) => `${index + 1}. ${clean(item.name || item.vendor_name || "Vendor gap")} — ${item.state || "National"}; ${item.risk || item.coverage_tier || "Review"}.`, 5)
        : ["1. No vendor gaps detected."])
    );
    lines.push("");
    lines.push("Recommended move:");
    lines.push("1. Confirm backup vendor coverage before launching mail, field, or digital actions.");
  } else {
    lines.push(`Current campaign operating assessment${scopeText}:`);
    lines.push("");
    lines.push(`Mission risk: ${mission.summary?.mission_risk || warRoom.summary?.mission_risk || "Stable"}`);
    lines.push(`Pressure score: ${mission.summary?.pressure_score || warRoom.summary?.pressure_score || 0}%`);
    lines.push("");
    lines.push("Top recommended actions:");
    lines.push(...(topActions.length ? topActions : ["1. No urgent advisor actions detected."]));
    lines.push("");
    lines.push("Top threats:");
    lines.push(...(topThreats.length ? topThreats : ["1. No active threats detected."]));
  }

  lines.push("");
  lines.push("Suggested next step:");
  lines.push(
    scopedRecommendations[0]?.title
      ? `Assign an owner for: ${clean(scopedRecommendations[0].title)}`
      : "Open Mission Control and review the highest-priority action queue."
  );

  return {
    answer: lines.join("\n"),
    intent,
    state: wantsState || null,
    citations: {
      recommendations: scopedRecommendations.slice(0, 5),
      threats: scopedThreats.slice(0, 5),
      queue: scopedQueue.slice(0, 5),
      tasks: scopedTasks.slice(0, 5),
      crm_followups: scopedCrm.slice(0, 5),
      reports: reports.slice(0, 5),
    },
  };
}

export async function askAiCampaignCopilot({ user = {}, payload = {} }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) throw new Error("Missing firm context.");

  const prompt = clean(payload.prompt || payload.message || "");
  if (!prompt) throw new Error("Prompt is required.");

  const workspaceId = payload.workspace_id || null;
  let threadId = payload.thread_id || null;

  if (!threadId) {
    const thread = await pool.query(
      `
        INSERT INTO ai_campaign_copilot_threads (
          firm_id, workspace_id, title, created_by, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,NOW(),NOW())
        RETURNING *
      `,
      [firmId, workspaceId, prompt.slice(0, 80) || "Campaign Co-Pilot Conversation", userId]
    );

    threadId = thread.rows[0].id;
  }

  const mission = await getExecutiveMissionControl({ user });
  const advisor = await getAiStrategicAdvisor({ user });
  const warRoom = await getElectionWarRoom({ user });

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

  const result = buildAnswer({
    prompt,
    warRoom,
    advisor,
    mission,
    reports,
  });

  const contextSnapshot = {
    intent: result.intent,
    state: result.state,
    mission_summary: mission.summary || {},
    advisor_summary: advisor.summary || {},
    war_room_summary: warRoom.summary || {},
    generated_at: new Date().toISOString(),
  };

  await pool.query(
    `
      INSERT INTO ai_campaign_copilot_messages (
        firm_id, thread_id, role, content, context_snapshot, created_by, created_at
      )
      VALUES ($1,$2,'user',$3,$4::jsonb,$5,NOW())
    `,
    [firmId, threadId, prompt, JSON.stringify(contextSnapshot), userId]
  );

  const assistantMessage = await pool.query(
    `
      INSERT INTO ai_campaign_copilot_messages (
        firm_id, thread_id, role, content, context_snapshot, created_by, created_at
      )
      VALUES ($1,$2,'assistant',$3,$4::jsonb,$5,NOW())
      RETURNING *
    `,
    [firmId, threadId, result.answer, JSON.stringify(contextSnapshot), userId]
  );

  await pool.query(
    `
      UPDATE ai_campaign_copilot_threads
      SET updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
    `,
    [threadId, firmId]
  );

  return {
    thread_id: Number(threadId),
    message: assistantMessage.rows[0],
    answer: result.answer,
    intent: result.intent,
    state: result.state,
    citations: result.citations,
    updated_at: new Date().toISOString(),
  };
}

export async function listAiCampaignCopilotThreads({ user = {} }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT *
      FROM ai_campaign_copilot_threads
      WHERE firm_id = $1
      ORDER BY updated_at DESC
      LIMIT 50
    `,
    [firmId]
  );

  return result.rows;
}

export async function getAiCampaignCopilotThread({ user = {}, threadId }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const thread = await pool.query(
    `
      SELECT *
      FROM ai_campaign_copilot_threads
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [threadId, firmId]
  );

  if (!thread.rows[0]) throw new Error("Thread not found.");

  const messages = await pool.query(
    `
      SELECT *
      FROM ai_campaign_copilot_messages
      WHERE firm_id = $1 AND thread_id = $2
      ORDER BY created_at ASC
    `,
    [firmId, threadId]
  );

  return {
    thread: thread.rows[0],
    messages: messages.rows,
  };
}
