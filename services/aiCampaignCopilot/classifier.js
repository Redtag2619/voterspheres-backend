import { includesAny, lower } from "./utils.js";
import { isUnsafeElectionRequest } from "./safety.js";

export const PLATFORM_SOURCE_LABELS = [
  "Mission Control",
  "Election War Room",
  "Strategic Advisor",
  "Intelligence Reports",
  "Campaign CRM",
  "Tasks",
  "Vendor Network",
  "Workspace Health",
];

export const GENERAL_POLITICAL_TOPICS = [
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

export const CURRENT_EVENT_WORDS = [
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

export function detectIntent(prompt = "") {
  const value = lower(prompt);

  if (isUnsafeElectionRequest(value)) return "unsafe";

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
  ) return "strategy";

  if (includesAny(value, ["signal", "threat", "risk", "narrative", "attack", "crisis"])) return "signals";
  if (includesAny(value, ["task", "owner", "execution", "backlog", "deadline"])) return "tasks";
  if (includesAny(value, ["crm", "contact", "stakeholder", "follow up", "client", "relationship"])) return "crm";
  if (includesAny(value, ["report", "brief", "memo", "summary", "client-ready"])) return "reports";
  if (includesAny(value, ["vendor", "mail", "digital", "field", "capacity"])) return "vendors";

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
  ) return "political_knowledge";

  return "general";
}

export function classifyQuestion(prompt = "", { hasOpenAI = false } = {}) {
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
    ]) || ["strategy", "signals", "tasks", "crm", "reports", "vendors"].includes(intent);

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
      answerType: hasOpenAI
        ? "general_political_analysis_current_limited"
        : "current_limited_static",
      needsPlatform: false,
      needsLLM: hasOpenAI,
      needsLiveResearch: true,
      sources: hasOpenAI ? ["General Political Analysis"] : ["Static Fallback"],
    };
  }

  if (wantsPlatform && wantsGeneralPolitical && hasOpenAI) {
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
      answerType: hasOpenAI ? "platform_intelligence_enhanced" : "platform_intelligence",
      needsPlatform: true,
      needsLLM: hasOpenAI,
      needsLiveResearch: wantsLive,
      sources: hasOpenAI
        ? [...PLATFORM_SOURCE_LABELS, "AI Strategic Reasoning"]
        : PLATFORM_SOURCE_LABELS,
    };
  }

  return {
    intent,
    answerType: hasOpenAI ? "general_political_analysis" : "static_political_fallback",
    needsPlatform: false,
    needsLLM: hasOpenAI,
    needsLiveResearch: wantsLive,
    sources: hasOpenAI ? ["General Political Analysis"] : ["Static Fallback"],
  };
}
