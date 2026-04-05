import { pool } from "../db/pool.js";
import { publishEvent } from "../lib/intelligence.events.js";
import { getDemoCampaignBundle, isDemoModeEnabled } from "./demo.service.js";

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

function safeRows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function runQuery(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch {
    return { rows: [] };
  }
}

export async function getAIChatData() {
  return CHAT_FALLBACK;
}

export async function postAIChatPrompt({ prompt }) {
  return {
    answer: `VoterSpheres AI response: ${prompt || "No prompt provided."}`
  };
}

export async function getWarRoomData() {
  if (isDemoModeEnabled()) {
    return getDemoCampaignBundle().warRoom;
  }

  const threatsRes = await runQuery(`
    select *
    from war_room_threats
    order by coalesce(created_at, now()) desc, id desc
    limit 25
  `);

  const signalsRes = await runQuery(`
    select *
    from war_room_signals
    order by coalesce(created_at, now()) desc, id desc
    limit 25
  `);

  const queueRes = await runQuery(`
    select *
    from war_room_queue
    order by coalesce(created_at, now()) desc, id desc
    limit 25
  `);

  const threats = safeRows(threatsRes).map((row, index) => ({
    id: row.id || index + 1,
    title: row.title || "Threat detected",
    severity: row.severity || "Medium",
    source: row.source || "Live monitoring",
    velocity: row.velocity || "+0%",
    recommendation: row.recommendation || "Review and respond."
  }));

  const signals = safeRows(signalsRes).map((row, index) => ({
    id: row.id || index + 1,
    time: row.time || new Date(row.created_at || Date.now()).toLocaleTimeString(),
    channel: row.channel || "Live Signal",
    text: row.text || row.summary || "Signal captured"
  }));

  const queue = safeRows(queueRes).map((row, index) => ({
    id: row.id || index + 1,
    priority: row.priority || "P2",
    owner: row.owner || "Operations",
    item: row.item || "Review signal",
    eta: row.eta || "2 hrs"
  }));

  if (!threats.length && !signals.length && !queue.length) {
    return getDemoCampaignBundle().warRoom;
  }

  return {
    metrics: [
      {
        label: "Active Threats",
        value: String(threats.length),
        delta: `${threats.filter((t) => String(t.severity).toLowerCase() === "high").length} high severity`,
        tone: threats.length ? "down" : "up"
      },
      {
        label: "Narrative Spikes",
        value: String(signals.length),
        delta: "Recent live signals",
        tone: "up"
      },
      {
        label: "Response Window",
        value: "43 min",
        delta: "Average target",
        tone: "neutral"
      },
      {
        label: "Signal Confidence",
        value: "89%",
        delta: "+ live ingestion",
        tone: "up"
      }
    ],
    threats,
    queue,
    signals
  };
}

export async function recordWarRoomThreat(input = {}) {
  const threat = {
    id: Date.now(),
    title: input.title || "Education narrative moving into mainstream local pickup",
    severity: input.severity || "Medium",
    source: input.source || "Media monitoring",
    velocity: input.velocity || "+21%",
    recommendation: input.recommendation || "Push validator-driven local messaging."
  };

  if (!isDemoModeEnabled()) {
    await runQuery(
      `
        insert into war_room_threats (
          title,
          severity,
          source,
          velocity,
          recommendation,
          created_at
        )
        values ($1, $2, $3, $4, $5, now())
      `,
      [threat.title, threat.severity, threat.source, threat.velocity, threat.recommendation]
    );
  }

  publishEvent({
    type: "warroom.threat_detected",
    channel: "intelligence:warroom",
    timestamp: new Date().toISOString(),
    payload: threat
  });

  publishEvent({
    type: "warroom.threat_detected",
    channel: "intelligence:command-center",
    timestamp: new Date().toISOString(),
    payload: threat
  });

  return { ok: true, threat };
}

export async function recordWarRoomSignal(input = {}) {
  const signal = {
    id: Date.now(),
    time: input.time || new Date().toLocaleTimeString(),
    channel: input.channel || "Live Signal",
    text: input.text || "New narrative signal detected"
  };

  if (!isDemoModeEnabled()) {
    await runQuery(
      `
        insert into war_room_signals (
          time,
          channel,
          text,
          created_at
        )
        values ($1, $2, $3, now())
      `,
      [signal.time, signal.channel, signal.text]
    );
  }

  publishEvent({
    type: "warroom.signal_detected",
    channel: "intelligence:warroom",
    timestamp: new Date().toISOString(),
    payload: signal
  });

  publishEvent({
    type: "warroom.signal_detected",
    channel: "intelligence:command-center",
    timestamp: new Date().toISOString(),
    payload: signal
  });

  return { ok: true, signal };
}

export async function recordWarRoomQueueItem(input = {}) {
  const item = {
    id: Date.now(),
    priority: input.priority || "P2",
    owner: input.owner || "Operations",
    item: input.item || "Review signal",
    eta: input.eta || "2 hrs"
  };

  if (!isDemoModeEnabled()) {
    await runQuery(
      `
        insert into war_room_queue (
          priority,
          owner,
          item,
          eta,
          created_at
        )
        values ($1, $2, $3, $4, now())
      `,
      [item.priority, item.owner, item.item, item.eta]
    );
  }

  publishEvent({
    type: "warroom.queue_updated",
    channel: "intelligence:warroom",
    timestamp: new Date().toISOString(),
    payload: item
  });

  publishEvent({
    type: "warroom.queue_updated",
    channel: "intelligence:command-center",
    timestamp: new Date().toISOString(),
    payload: item
  });

  return { ok: true, item };
}

export async function getSimulatorData() {
  return SIMULATOR_FALLBACK;
}

export async function getCommandCenterData() {
  if (isDemoModeEnabled()) {
    return getDemoCampaignBundle().commandCenter;
  }

  const warRoom = await getWarRoomData();
  if (warRoom?.threats?.length || warRoom?.signals?.length) {
    return {
      metrics: [
        { label: "National Win Index", value: "61.4", delta: "+2.8", tone: "up" },
        { label: "Active Threats", value: String(warRoom.threats.length || 0), delta: "+ live risk", tone: "down" },
        { label: "Fundraising Pulse", value: "$12.6M", delta: "+11.2%", tone: "up" },
        { label: "Persuasion Opportunity", value: "8.7", delta: "+0.6", tone: "up" }
      ],
      battlegrounds: getDemoCampaignBundle().commandCenter.battlegrounds,
      actions: warRoom.queue?.length
        ? warRoom.queue.slice(0, 3).map((item) => ({
            title: item.item,
            owner: item.owner,
            due: item.eta,
            detail: `${item.priority} response item in live queue.`
          }))
        : getDemoCampaignBundle().commandCenter.actions,
      feed: [
        ...(warRoom.threats || []).slice(0, 4).map((item, index) => ({
          id: item.id || `threat-${index}`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          title: item.title,
          source: item.source,
          severity: item.severity,
          type: "warroom.threat_detected"
        })),
        ...(warRoom.signals || []).slice(0, 4).map((item, index) => ({
          id: item.id || `signal-${index}`,
          time: item.time,
          title: item.text,
          source: item.channel,
          severity: "Medium",
          type: "warroom.signal_detected"
        }))
      ]
    };
  }

  return getDemoCampaignBundle().commandCenter;
}
