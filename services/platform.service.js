import { publishEvent } from "../lib/intelligence.events.js";

const CHAT_FALLBACK = {
  metrics: [
    { label: "AI Queries Today", value: "184", delta: "+26%", tone: "up" },
    { label: "Briefs Generated", value: "39", delta: "+11", tone: "up" },
    { label: "Strategic Alerts Referenced", value: "72", delta: "+8", tone: "up" },
    { label: "Response Confidence", value: "91%", delta: "+2.4", tone: "up" }
  ],
  quickPrompts: [
    "Which battlegrounds moved most in the last 72 hours?",
    "Summarize fundraising risk across top senate races.",
    "What is the fastest path to improve win probability in Arizona?"
  ],
  conversation: [
    {
      role: "assistant",
      title: "AI Analyst Brief",
      text: "National control probability improved modestly overnight, driven by suburban persuasion gains."
    }
  ],
  outputs: [
    {
      type: "Executive Memo",
      title: "National battleground briefing",
      note: "Combines map movement, donor confidence, and war room pressure into one brief."
    }
  ]
};

const WARROOM_FALLBACK = {
  metrics: [
    { label: "Active Threats", value: "12", delta: "+3 in last 6 hrs", tone: "down" },
    { label: "Narrative Spikes", value: "7", delta: "2 containable", tone: "up" },
    { label: "Response Window", value: "43 min", delta: "Average target", tone: "neutral" },
    { label: "Signal Confidence", value: "89%", delta: "+4.1", tone: "up" }
  ],
  threats: [
    {
      title: "Cost-of-living attack cluster accelerating in suburban paid media",
      severity: "High",
      source: "Ad monitoring",
      velocity: "+38%",
      recommendation: "Deploy affordability rebuttal pack across surrogates."
    },
    {
      title: "Education narrative moving into mainstream local pickup",
      severity: "Medium",
      source: "Media monitoring",
      velocity: "+21%",
      recommendation: "Push validator-driven local messaging."
    }
  ],
  queue: [
    { priority: "P1", owner: "Rapid Response", item: "Finalize affordability contrast memo", eta: "45 min" },
    { priority: "P2", owner: "Comms", item: "Draft surrogate talking points", eta: "2 hrs" }
  ],
  signals: [
    { time: "08:44", channel: "Cable / Clips", text: "Opposition segment repetition crossed threshold." },
    { time: "09:12", channel: "Social / X", text: "Narrative crossover detected into persuadable clusters." }
  ]
};

const COMMAND_CENTER_FALLBACK = {
  metrics: [
    { label: "National Win Index", value: "61.4", delta: "+2.8", tone: "up" },
    { label: "Active Threats", value: "12", delta: "+3", tone: "down" },
    { label: "Fundraising Pulse", value: "$12.6M", delta: "+11.2%", tone: "up" },
    { label: "Persuasion Opportunity", value: "8.7", delta: "+0.6", tone: "up" }
  ],
  battlegrounds: [
    { race: "PA Senate", probability: "54%", momentum: "+2.1", risk: "Elevated", priority: "Tier 1" },
    { race: "AZ-01", probability: "51%", momentum: "+1.4", risk: "Watch", priority: "Tier 1" }
  ],
  actions: [
    {
      title: "Reallocate persuasion spend",
      owner: "Paid Media",
      due: "Today",
      detail: "Shift 14% of digital spend into three suburban battleground segments."
    }
  ],
  feed: [
    {
      time: "08:12",
      title: "Opposition message spike detected",
      source: "Ad monitoring",
      severity: "High"
    }
  ]
};

const SIMULATOR_FALLBACK = {
  metrics: [
    { label: "Base Win Scenario", value: "54%", delta: "+2.1", tone: "up" },
    { label: "Upside Ceiling", value: "63%", delta: "+3.7", tone: "up" },
    { label: "Downside Risk", value: "41%", delta: "-2.9", tone: "down" },
    { label: "Model Confidence", value: "78", delta: "+4.2", tone: "up" }
  ],
  scenarios: [
    { title: "Base Case", probability: "44%", outcome: "Stable suburban gains and neutral media conditions.", status: "Most Likely" },
    { title: "Narrative Shock", probability: "18%", outcome: "Negative media cycle compresses margins.", status: "Risk" }
  ],
  board: [
    { race: "PA Senate", base: "54%", upside: "61%", downside: "47%", trigger: "Women suburban turnout" }
  ],
  notes: [
    { title: "Best upside path", note: "Affordability discipline plus suburban turnout remains the cleanest route." }
  ]
};

export async function getAIChatData() {
  return CHAT_FALLBACK;
}

export async function postAIChatPrompt({ prompt }) {
  return {
    answer: `VoterSpheres AI response: ${prompt || "No prompt provided."}`
  };
}

export async function getWarRoomData() {
  return WARROOM_FALLBACK;
}

export async function recordWarRoomThreat(input = {}) {
  const threat = {
    title:
      input.title ||
      "Education narrative moving into mainstream local pickup",
    severity: input.severity || "Medium",
    source: input.source || "Media monitoring",
    velocity: input.velocity || "+21%",
    recommendation:
      input.recommendation || "Push validator-driven local messaging."
  };

  publishEvent({
    type: "warroom.threat_detected",
    channel: "intelligence:warroom",
    timestamp: new Date().toISOString(),
    payload: threat
  });

  return { ok: true, threat };
}

export async function getSimulatorData() {
  return SIMULATOR_FALLBACK;
}

export async function getCommandCenterData() {
  return COMMAND_CENTER_FALLBACK;
}
