import OpenAI from "openai";
import { pool } from "../db/pool.js";
import { getElectionWarRoom } from "./electionWarRoom.service.js";
import { getAiStrategicAdvisor } from "./aiStrategicAdvisor.service.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js"; 

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const PLATFORM_SOURCE_LABELS = [
  "Mission Control",
  "Election War Room",
  "Strategic Advisor",
  "Intelligence Reports",
  "Campaign CRM",
  "Tasks",
  "Vendor Network",
  "Workspace Health",
];

const GENERAL_POLITICAL_TOPICS = [
  "campaign strategy",
  "messaging",
  "turnout",
  "gotv",
  "polling",
  "fundraising",
  "direct mail",
  "digital advertising",
  "earned media",
  "debate prep",
  "opposition research",
  "voter persuasion",
  "coalition building",
  "field operations",
  "political history",
  "civics",
  "election systems",
  "ranked choice voting",
  "redistricting",
  "campaign management",
];

const CURRENT_EVENT_WORDS = [
  "today",
  "latest",
  "breaking",
  "current",
  "this morning",
  "this week",
  "news",
  "recent",
  "right now",
  "polling average",
  "new poll",
  "fec filing",
  "supreme court",
  "ruling",
  "deadline",
  "2026",
  "2027",
  "2028",
];

const UNSAFE_ELECTION_WORDS = [
  "hack voting machine",
  "hack ballot",
  "suppress votes",
  "intimidate voters",
  "deceive voters",
  "mislead voters",
  "fake ballot",
  "discard ballots",
  "illegal voting",
  "steal election",
  "voter fraud scheme",
];

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

function truncate(value = "", max = 2200) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeWorkspaceId(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
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
    ALTER TABLE ai_campaign_copilot_messages
      ADD COLUMN IF NOT EXISTS answer_type TEXT DEFAULT 'platform_intelligence',
      ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 88;
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

function detectState(prompt = "") {
  return (
    lower(prompt).match(
      /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy|dc)\b/i
    )?.[0]?.toUpperCase() || null
  );
}

function detectIntent(prompt = "") {
  const value = lower(prompt);

  if (includesAny(value, UNSAFE_ELECTION_WORDS)) {
    return "unsafe";
  }

  if (
    includesAny(value, [
      "what should",
      "next",
      "do",
      "recommend",
      "strategy",
      "plan",
      "win",
      "path to victory",
    ])
  ) {
    return "strategy";
  }

  if (
    includesAny(value, [
      "signal",
      "threat",
      "risk",
      "narrative",
      "attack",
      "crisis",
    ])
  ) {
    return "signals";
  }

  if (
    includesAny(value, [
      "task",
      "owner",
      "execution",
      "backlog",
      "deadline",
    ])
  ) {
    return "tasks";
  }

  if (
    includesAny(value, [
      "crm",
      "contact",
      "stakeholder",
      "follow up",
      "client",
      "relationship",
    ])
  ) {
    return "crm";
  }

  if (
    includesAny(value, [
      "report",
      "brief",
      "memo",
      "summary",
      "client-ready",
    ])
  ) {
    return "reports";
  }

  if (
    includesAny(value, [
      "vendor",
      "mail",
      "digital",
      "field",
      "capacity",
    ])
  ) {
    return "vendors";
  }

  if (
    includesAny(value, [
      "explain",
      "what is",
      "why",
      "how does",
      "compare",
      "history",
      "ranked-choice",
      "ranked choice",
      "turnout",
      "midterm",
    ])
  ) {
    return "political_knowledge";
  }

  return "general";
}

function classifyQuestion(prompt = "") {
  const value = lower(prompt);
  const intent = detectIntent(prompt);

  const wantsPlatform =
    includesAny(value, [
      "my",
      "our",
      "workspace",
      "mission control",
      "war room",
      "crm",
      "task",
      "vendor",
      "report",
      "client",
      "donor",
      "state operations",
      "voterspheres",
      "dashboard",
      "notification",
    ]) ||
    ["strategy", "signals", "tasks", "crm", "reports", "vendors"].includes(
      intent
    );

  const wantsLive =
    includesAny(value, CURRENT_EVENT_WORDS) ||
    /\b202[6-9]\b/.test(value) ||
    includesAny(value, ["latest", "currently", "new poll", "poll today"]);

  const wantsGeneralPolitical =
    includesAny(value, GENERAL_POLITICAL_TOPICS) ||
    ["political_knowledge", "general"].includes(intent);

  if (intent === "unsafe") {
    return {
      intent,
      answerType: "safety_redirect",
      needsPlatform: false,
      needsLLM: false,
      needsLiveResearch: false,
      sources: ["Safety Policy"],
    };
  }

  if (wantsLive && !wantsPlatform) {
    return {
      intent,
      answerType: openai
        ? "general_political_analysis_current_limited"
        : "current_limited_static",
      needsPlatform: false,
      needsLLM: Boolean(openai),
      needsLiveResearch: true,
      sources: openai
        ? ["General Political Analysis"]
        : ["Static Fallback"],
    };
  }

  if (wantsPlatform && wantsGeneralPolitical && openai) {
    return {
      intent,
      answerType: "hybrid_platform_plus_political_analysis",
      needsPlatform: true,
      needsLLM: true,
      needsLiveResearch: wantsLive,
      sources: [...PLATFORM_SOURCE_LABELS, "General Political Analysis"],
    };
  }

  if (wantsPlatform) {
    return {
      intent,
      answerType: openai
        ? "platform_intelligence_enhanced"
        : "platform_intelligence",
      needsPlatform: true,
      needsLLM: Boolean(openai),
      needsLiveResearch: wantsLive,
      sources: openai
        ? [...PLATFORM_SOURCE_LABELS, "AI Strategic Reasoning"]
        : PLATFORM_SOURCE_LABELS,
    };
  }

  return {
    intent,
    answerType: openai
      ? "general_political_analysis"
      : "static_political_fallback",
    needsPlatform: false,
    needsLLM: Boolean(openai),
    needsLiveResearch: wantsLive,
    sources: openai ? ["General Political Analysis"] : ["Static Fallback"],
  };
}

async function getPlatformContext({ user, firmId, workspaceId }) {
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

function compactPlatformContext(context = {}) {
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

function buildStaticPlatformAnswer({ prompt, platformContext }) {
  const normalizedPrompt = lower(prompt);

  const warRoom = platformContext.warRoom || {};
  const advisor = platformContext.advisor || {};
  const mission = platformContext.mission || {};
  const reports = platformContext.reports || [];

  const recommendations = advisor.recommendations || [];
  const threats = warRoom.threats || [];
  const queue = warRoom.queue || [];
  const signals = warRoom.signals || [];
  const workspaces = warRoom.command_cards || mission.workspace_health || [];
  const tasks = mission.open_tasks || [];
  const crm = mission.crm_followups || [];
  const vendorGaps = mission.vendor_gaps || [];

  const wantsState = detectState(prompt);

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

  if (
    includesAny(normalizedPrompt, [
      "what should",
      "next",
      "do",
      "recommend",
      "strategy",
      "plan",
    ])
  ) {
    intent = "strategy";
  }

  if (
    includesAny(normalizedPrompt, [
      "signal",
      "threat",
      "risk",
      "narrative",
      "attack",
    ])
  ) {
    intent = "signals";
  }

  if (
    includesAny(normalizedPrompt, [
      "task",
      "owner",
      "execution",
      "backlog",
    ])
  ) {
    intent = "tasks";
  }

  if (
    includesAny(normalizedPrompt, [
      "crm",
      "contact",
      "stakeholder",
      "follow up",
      "client",
    ])
  ) {
    intent = "crm";
  }

  if (
    includesAny(normalizedPrompt, [
      "report",
      "brief",
      "memo",
      "summary",
    ])
  ) {
    intent = "reports";
  }

  if (
    includesAny(normalizedPrompt, [
      "vendor",
      "mail",
      "digital",
      "field",
    ])
  ) {
    intent = "vendors";
  }

  const scopeText = wantsState ? ` for ${wantsState}` : "";

  const topActions = summarizeTop(
    scopedRecommendations.length ? scopedRecommendations : recommendations,
    (item, index) =>
      `${index + 1}. ${clean(item.title)} — ${clean(
        item.expected_impact || item.why || "Assign owner and track outcome."
      )}`,
    5
  );

  const topThreats = summarizeTop(
    scopedThreats.length ? scopedThreats : threats,
    (item, index) =>
      `${index + 1}. ${clean(item.title)} — ${
        item.severity || item.risk || "Signal"
      } from ${item.source || "War Room"}.`,
    5
  );

  const topQueue = summarizeTop(
    scopedQueue.length ? scopedQueue : queue,
    (item, index) =>
      `${index + 1}. ${clean(item.item)} — Owner: ${
        item.owner || "Command Team"
      }; ETA: ${item.eta || "Today"}.`,
    5
  );

  const topTasks = summarizeTop(
    scopedTasks.length ? scopedTasks : tasks,
    (item, index) =>
      `${index + 1}. ${clean(item.title || "Task")} — ${
        item.priority || "Medium"
      } priority; ${item.assigned_to || "Unassigned"}.`,
    5
  );

  const topCrm = summarizeTop(
    scopedCrm.length ? scopedCrm : crm,
    (item, index) =>
      `${index + 1}. ${clean(item.title || "CRM follow-up")} — ${clean(
        item.contact_name || item.outcome || "Follow up required"
      )}.`,
    5
  );

  const topWorkspaces = summarizeTop(
    scopedWorkspaces.length ? scopedWorkspaces : workspaces,
    (item, index) =>
      `${index + 1}. ${clean(item.title || item.name || "Workspace")} — ${
        item.risk || "Stable"
      } risk; ${item.pressure_score || 0}% pressure.`,
    5
  );

  const latestReports = summarizeTop(
    reports,
    (item, index) =>
      `${index + 1}. ${clean(item.title)} — ${
        item.report_type || "report"
      }; ${item.state || "National"}.`,
    4
  );

  const lines = [];

  if (intent === "strategy") {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(
      `Here is the recommended campaign plan${scopeText} for the next operating cycle:`
    );
    lines.push("");
    lines.push("Priority actions:");
    lines.push(
      ...(topActions.length
        ? topActions
        : ["1. No urgent recommendations detected. Continue monitoring Mission Control."])
    );
    lines.push("");
    lines.push("War Room queue:");
    lines.push(...(topQueue.length ? topQueue : ["1. No active response queue items."]));
    lines.push("");
    lines.push("Workspace pressure:");
    lines.push(
      ...(topWorkspaces.length
        ? topWorkspaces
        : ["1. No workspace pressure records available."])
    );
  } else if (intent === "signals") {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(`Signal and threat assessment${scopeText}:`);
    lines.push("");
    lines.push("Top threats:");
    lines.push(...(topThreats.length ? topThreats : ["1. No active threats detected."]));
    lines.push("");
    lines.push("Signal stream:");
    lines.push(
      ...summarizeTop(
        scopedSignals.length ? scopedSignals : signals,
        (item, index) =>
          `${index + 1}. ${clean(item.text || item.title)} — ${
            item.channel || "Signal"
          }; ${item.risk || "Watch"}.`,
        5
      )
    );
  } else if (intent === "tasks") {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(`Execution task assessment${scopeText}:`);
    lines.push("");
    lines.push("Open tasks:");
    lines.push(...(topTasks.length ? topTasks : ["1. No open execution tasks detected."]));
    lines.push("");
    lines.push("Response queue:");
    lines.push(...(topQueue.length ? topQueue : ["1. No response queue items."]));
  } else if (intent === "crm") {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(`CRM and stakeholder follow-up assessment${scopeText}:`);
    lines.push("");
    lines.push("Open CRM follow-ups:");
    lines.push(...(topCrm.length ? topCrm : ["1. No open CRM follow-ups detected."]));
    lines.push("");
    lines.push("Recommended CRM move:");
    lines.push(
      "1. Log all stakeholder outcomes and connect important touches to the relevant workspace."
    );
  } else if (intent === "reports") {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(`Available reporting intelligence${scopeText}:`);
    lines.push("");
    lines.push("Recent reports:");
    lines.push(
      ...(latestReports.length
        ? latestReports
        : ["1. No generated reports found. Generate a Daily Intelligence Brief."])
    );
    lines.push("");
    lines.push("Recommended next report:");
    lines.push(
      `1. Generate a ${wantsState ? `${wantsState} ` : ""}Daily Intelligence Brief from the Reports page.`
    );
  } else if (intent === "vendors") {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(`Vendor and operational capacity assessment${scopeText}:`);
    lines.push("");
    lines.push("Vendor gaps:");
    lines.push(
      ...(vendorGaps.length
        ? summarizeTop(
            vendorGaps.filter(stateFilter),
            (item, index) =>
              `${index + 1}. ${clean(
                item.name || item.vendor_name || "Vendor gap"
              )} — ${item.state || "National"}; ${
                item.risk || item.coverage_tier || "Review"
              }.`,
            5
          )
        : ["1. No vendor gaps detected."])
    );
    lines.push("");
    lines.push("Recommended move:");
    lines.push(
      "1. Confirm backup vendor coverage before launching mail, field, or digital actions."
    );
  } else {
    lines.push("Source label: Platform intelligence");
    lines.push("");
    lines.push(`Current campaign operating assessment${scopeText}:`);
    lines.push("");
    lines.push(
      `Mission risk: ${
        mission.summary?.mission_risk ||
        warRoom.summary?.mission_risk ||
        "Stable"
      }`
    );
    lines.push(
      `Pressure score: ${
        mission.summary?.pressure_score ||
        warRoom.summary?.pressure_score ||
        0
      }%`
    );
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
    confidence: 84,
    sources: PLATFORM_SOURCE_LABELS,
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

function buildGeneralFallbackAnswer({ prompt, classification }) {
  const intent = classification.intent;
  const lines = [];

  lines.push("Source label: General political analysis");
  lines.push("");

  if (classification.needsLiveResearch) {
    lines.push(
      "I do not have a live news/search feed connected in this backend service yet, so I cannot verify current facts, latest polls, breaking news, filings, or today’s developments from here."
    );
    lines.push("");
  }

  if (intent === "unsafe") {
    return {
      answer:
        "I can’t help with voter intimidation, deception, ballot interference, hacking voting systems, or suppressing lawful participation. I can help with lawful voter education, turnout planning, compliance-safe messaging, field operations, and campaign strategy.",
      confidence: 96,
      sources: ["Safety Policy"],
    };
  }

  lines.push(
    "Here is a campaign-safe strategic answer based on general political knowledge:"
  );
  lines.push("");

  if (includesAny(prompt, ["turnout", "midterm"])) {
    lines.push(
      "Midterm turnout is usually lower than presidential turnout because there is less national media attention, fewer casual voters participate, and campaigns must work harder to identify, persuade, and mobilize lower-propensity voters."
    );
    lines.push("");
    lines.push("Campaign implication:");
    lines.push("1. Invest early in voter identification.");
    lines.push("2. Segment persuasion and turnout universes separately.");
    lines.push("3. Use repeated contact for lower-propensity supporters.");
    lines.push("4. Build local urgency around offices, issues, and consequences.");
  } else if (includesAny(prompt, ["ranked choice", "ranked-choice"])) {
    lines.push(
      "Ranked-choice voting lets voters rank candidates in order of preference. If no candidate wins an outright majority, the lowest-performing candidate is eliminated and their voters’ next choices are redistributed until someone reaches a majority."
    );
    lines.push("");
    lines.push("Campaign implication:");
    lines.push("1. Avoid alienating supporters of adjacent candidates.");
    lines.push("2. Compete for second-choice support.");
    lines.push("3. Educate voters clearly on how to rank their ballot.");
  } else if (includesAny(prompt, ["fundraising"])) {
    lines.push(
      "A strong fundraising program combines major donor cultivation, recurring small-dollar asks, event-based fundraising, deadline-driven urgency, and clear proof of campaign momentum."
    );
    lines.push("");
    lines.push("Recommended structure:");
    lines.push("1. Segment donors by capacity and prior giving.");
    lines.push("2. Prioritize personal outreach for high-capacity prospects.");
    lines.push("3. Use email/SMS for broad urgency moments.");
    lines.push("4. Tie asks to specific strategic needs.");
  } else if (includesAny(prompt, ["message", "messaging", "persuasion"])) {
    lines.push(
      "Effective political messaging should be clear, repeated, emotionally resonant, and tied to voter concerns. The best messages connect a candidate’s contrast, credibility, and plan to the lived priorities of the audience."
    );
    lines.push("");
    lines.push("Recommended structure:");
    lines.push("1. Name the voter problem.");
    lines.push("2. Explain why it matters now.");
    lines.push("3. Connect the candidate to a credible solution.");
    lines.push("4. Contrast with the opponent without overcomplicating the message.");
  } else if (includesAny(prompt, ["gotv", "field"])) {
    lines.push(
      "A strong GOTV program starts with voter targeting, then builds repeated contact through canvass, phones, relational organizing, digital reminders, mail, and Election Day cure/turnout operations."
    );
    lines.push("");
    lines.push("Recommended phases:");
    lines.push("1. Build the turnout universe.");
    lines.push("2. Confirm support and voting method.");
    lines.push("3. Push early vote and mail deadlines.");
    lines.push("4. Track ballots and recontact remaining supporters.");
  } else {
    lines.push(
      "For most campaign questions, the best answer starts by separating the problem into four parts: audience, geography, timing, and available resources."
    );
    lines.push("");
    lines.push("Recommended framework:");
    lines.push("1. Define the persuadable or turnout universe.");
    lines.push("2. Identify the geography that can move the outcome.");
    lines.push("3. Match message and channel to the target audience.");
    lines.push("4. Assign owners, deadlines, and measurable outcomes.");
    lines.push(
      "5. Reassess weekly based on polling, field data, fundraising, and media pressure."
    );
  }

  lines.push("");
  lines.push(
    "To make this more specific, ask with a state, race type, audience, budget, and timeline."
  );

  return {
    answer: lines.join("\n"),
    confidence: classification.needsLiveResearch ? 68 : 82,
    sources: classification.needsLiveResearch
      ? ["General Political Analysis", "Live Research Not Connected"]
      : ["General Political Analysis"],
  };
}

async function askOpenAI({ prompt, classification, platformContext, recentMessages }) {
  if (!openai) {
    return null;
  }

  const compactContext = platformContext
    ? compactPlatformContext(platformContext)
    : null;

  const sourceLabel =
    classification.answerType === "general_political_analysis"
      ? "General political analysis"
      : classification.answerType.includes("current")
        ? "General political analysis; live research not connected"
        : classification.answerType.includes("hybrid")
          ? "Hybrid: VoterSpheres platform intelligence + general political analysis"
          : "VoterSpheres platform intelligence enhanced by AI strategic reasoning";

  const currentWarning = classification.needsLiveResearch
    ? "The backend does not currently include a live web/news/search connector. Do not claim current or breaking facts. If asked for current events, clearly say live verification is not connected and provide only general strategic guidance."
    : "";

  const systemPrompt = `
You are the VoterSpheres AI Campaign Co-Pilot.

You are a senior political campaign strategist, executive chief of staff, and campaign operations analyst.

Answer style:
- Be direct, practical, and executive-ready.
- Use headings and numbered actions.
- Make clear whether the answer uses VoterSpheres platform intelligence, general political analysis, or current/live research limitations.
- Do not pretend to have live news, polling, legal, FEC, or current-event access unless explicitly provided in context.
- For legal/compliance/election administration issues, provide general information and recommend consulting qualified counsel or official election authorities when appropriate.
- Refuse voter suppression, intimidation, ballot interference, hacking, deception, or unlawful election manipulation.

Source label for this answer: ${sourceLabel}.
${currentWarning}
`;

  const userPrompt = `
User question:
${prompt}

Classification:
${JSON.stringify(classification, null, 2)}

Recent conversation:
${JSON.stringify(recentMessages.slice(-8), null, 2)}

VoterSpheres platform context:
${JSON.stringify(compactContext || {}, null, 2)}

Return a complete answer that can be shown directly in the AI Campaign Co-Pilot.
`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.35,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return clean(response.choices?.[0]?.message?.content || "");
}

async function getRecentThreadMessages({ firmId, threadId }) {
  if (!threadId) return [];

  return safeQuery(
    `
      SELECT role, content, created_at
      FROM ai_campaign_copilot_messages
      WHERE firm_id = $1 AND thread_id = $2
      ORDER BY created_at DESC
      LIMIT 12
    `,
    [firmId, threadId]
  );
}

async function storeMessage({
  firmId,
  threadId,
  role,
  content,
  contextSnapshot,
  userId,
  answerType,
  sources,
  confidence,
}) {
  const result = await pool.query(
    `
      INSERT INTO ai_campaign_copilot_messages (
        firm_id,
        thread_id,
        role,
        content,
        context_snapshot,
        created_by,
        answer_type,
        sources,
        confidence,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,NOW())
      RETURNING *
    `,
    [
      firmId,
      threadId,
      role,
      content,
      JSON.stringify(contextSnapshot || {}),
      userId,
      answerType || "platform_intelligence",
      JSON.stringify(sources || []),
      confidence || 88,
    ]
  );

  return result.rows[0];
}

export async function askAiCampaignCopilot({ user = {}, payload = {} }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) throw new Error("Missing firm context.");

  const prompt = clean(payload.prompt || payload.message || "");
  if (!prompt) throw new Error("Prompt is required.");

  const workspaceId = normalizeWorkspaceId(payload.workspace_id);
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
      [
        firmId,
        workspaceId,
        prompt.slice(0, 80) || "Campaign Co-Pilot Conversation",
        userId,
      ]
    );

    threadId = thread.rows[0].id;
  }

  const classification = classifyQuestion(prompt);
  const recentMessages = await getRecentThreadMessages({ firmId, threadId });

  let platformContext = null;

  if (classification.needsPlatform) {
    platformContext = await getPlatformContext({
      user,
      firmId,
      workspaceId,
    });
  }

  let generated = null;
  let answer = "";
  let confidence = 82;
  let citations = {};
  let sources = classification.sources;

  if (classification.intent === "unsafe") {
    generated = buildGeneralFallbackAnswer({
      prompt,
      classification,
    });
  } else if (classification.needsLLM) {
    try {
      const llmAnswer = await askOpenAI({
        prompt,
        classification,
        platformContext,
        recentMessages,
      });

      if (llmAnswer) {
        generated = {
          answer: llmAnswer,
          confidence: classification.needsLiveResearch ? 72 : 92,
          sources: classification.sources,
        };
      }
    } catch (error) {
      console.warn(
        "[ai-campaign-copilot] OpenAI failed, using fallback:",
        error.message
      );
    }
  }

  if (!generated && classification.needsPlatform && platformContext) {
    generated = buildStaticPlatformAnswer({
      prompt,
      platformContext,
    });
  }

  if (!generated) {
    generated = buildGeneralFallbackAnswer({
      prompt,
      classification,
    });
  }

  answer = generated.answer;
  confidence = generated.confidence || confidence;
  citations = generated.citations || {};
  sources = unique(generated.sources || sources || []);

  const contextSnapshot = {
    classification,
    answer_type: classification.answerType,
    sources,
    confidence,
    platform_context_available: Boolean(platformContext),
    platform_summary: platformContext
      ? {
          mission_summary: platformContext.mission?.summary || {},
          advisor_summary: platformContext.advisor?.summary || {},
          war_room_summary: platformContext.warRoom?.summary || {},
        }
      : {},
    generated_at: new Date().toISOString(),
  };

  await storeMessage({
    firmId,
    threadId,
    role: "user",
    content: prompt,
    contextSnapshot,
    userId,
    answerType: "user_prompt",
    sources: [],
    confidence: 100,
  });

  const assistantMessage = await storeMessage({
    firmId,
    threadId,
    role: "assistant",
    content: answer,
    contextSnapshot,
    userId,
    answerType: classification.answerType,
    sources,
    confidence,
  });

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
    message: assistantMessage,
    answer,
    intent: classification.intent,
    answer_type: classification.answerType,
    needs_live_research: classification.needsLiveResearch,
    live_research_connected: false,
    sources,
    confidence,
    citations,
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
