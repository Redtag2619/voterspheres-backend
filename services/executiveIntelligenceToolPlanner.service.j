function clean(value = "") {
  return String(value ?? "").trim();
}

const STATE_NAMES = {
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

function detectState(question, supplied = "") {
  const explicit = clean(supplied).toUpperCase();
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  const lower = clean(question).toLowerCase();
  for (const [name, abbr] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(lower)) return abbr;
  }
  const abbreviation = lower.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i);
  return abbreviation?.[1]?.toUpperCase() || "";
}

function detectCycle(question, supplied = "") {
  const explicit = clean(supplied);
  if (/^20\d{2}$/.test(explicit)) return explicit;
  return clean(question).match(/\b(20\d{2})\b/)?.[1] || "";
}

function detectOffice(question, supplied = "") {
  if (clean(supplied)) return clean(supplied);
  const lower = clean(question).toLowerCase();
  if (/\bpresident(?:ial)?\b/.test(lower)) return "President";
  if (/\bu\.?s\.? senate|senator|senate race\b/.test(lower)) return "U.S. Senate";
  if (/\bgovernor|gubernatorial\b/.test(lower)) return "Governor";
  if (/\bcongress|house race|representative\b/.test(lower)) return "U.S. House";
  if (/\bmayor|mayoral\b/.test(lower)) return "Mayor";
  return "";
}

function detectIntent(question) {
  const lower = clean(question).toLowerCase();
  if (/fec|filing|fundrais|donor|receipt|disbursement/.test(lower)) return "finance";
  if (/poll|approval|favorability|survey|leading|ahead/.test(lower)) return "polling";
  if (/news|latest|recent|today|activity|development/.test(lower)) return "latest_intelligence";
  if (/forecast|probability|win chance|path to victory/.test(lower)) return "forecast";
  if (/state operations|county|parish|field operation|readiness/.test(lower)) return "operations";
  if (/relationship|network|influence|coalition|endorsement/.test(lower)) return "political_graph";
  return "executive_brief";
}

function detectCandidate(question, supplied = "") {
  if (clean(supplied)) return clean(supplied);
  const patterns = [
    /(?:about|for|on|candidate)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})/,
    /what(?:'s| is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})/,
  ];
  for (const pattern of patterns) {
    const match = clean(question).match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

export function buildExecutiveIntelligencePlan(input = {}) {
  const question = clean(input.question || input.prompt || input.message);
  const context = {
    question,
    workspace_id: Number(input.workspace_id || 1),
    candidate_name: detectCandidate(question, input.candidate),
    state: detectState(question, input.state),
    office: detectOffice(question, input.office),
    cycle: detectCycle(question, input.cycle),
    locality: clean(input.locality),
    intent: detectIntent(question),
    limit: Math.max(1, Math.min(25, Number(input.limit || 10))),
  };

  const tools = [];
  const add = (tool, reason, priority = 50) => {
    if (!tools.some((item) => item.tool === tool)) tools.push({ tool, reason, priority });
  };

  add("search_live_news", "Current external political intelligence and recent developments", 90);
  add("get_unified_executive_intelligence", "Cross-platform VoterSpheres executive evidence", 100);

  if (context.candidate_name) {
    add("get_candidate_live_intelligence", "Candidate-specific intelligence and resolution", 110);
  }
  if (context.intent === "finance" || context.candidate_name) {
    add("get_fec_intelligence", "Campaign finance filings, receipts, and disbursements", 85);
  }
  if (context.intent === "polling" || context.intent === "forecast") {
    add("get_polling_intelligence", "Polling and trend evidence", 95);
    add("get_forecast_intelligence", "Forecast and modeled probability evidence", 92);
  }
  if (context.state || context.intent === "operations") {
    add("get_state_operations_intelligence", "State and locality operational posture", 88);
  }
  if (context.intent === "political_graph" || context.candidate_name) {
    add("get_political_graph_intelligence", "Influence, coalition, and relationship evidence", 72);
  }

  return {
    context,
    tools: tools.sort((a, b) => b.priority - a.priority),
    generated_at: new Date().toISOString(),
  };
}

