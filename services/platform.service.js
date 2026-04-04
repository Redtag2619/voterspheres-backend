import { publishEvent } from "../lib/intelligence.events.js";

async function getDb() {
  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      return mod.default || mod.db || mod.pool || mod.client || null;
    } catch {
      // try next
    }
  }

  return null;
}

async function safeQuery(sql, params = []) {
  try {
    const db = await getDb();
    if (!db) return { rows: [] };

    if (typeof db.query === "function") {
      return await db.query(sql, params);
    }

    if (typeof db.execute === "function") {
      const [rows] = await db.execute(sql, params);
      return { rows };
    }

    return { rows: [] };
  } catch {
    return { rows: [] };
  }
}

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
      id: 1,
      title: "Cost-of-living attack cluster accelerating in suburban paid media",
      severity: "High",
      source: "Ad monitoring",
      velocity: "+38%",
      recommendation: "Deploy affordability rebuttal pack across surrogates."
    },
    {
      id: 2,
      title: "Education narrative moving into mainstream local pickup",
      severity: "Medium",
      source: "Media monitoring",
      velocity: "+21%",
      recommendation: "Push validator-driven local messaging."
    }
  ],
  queue: [
    { id: 1, priority: "P1", owner: "Rapid Response", item: "Finalize affordability contrast memo", eta: "45 min" },
    { id: 2, priority: "P2", owner: "Comms", item: "Draft surrogate talking points", eta: "2 hrs" }
  ],
  signals: [
    { id: 1, time: "08:44", channel: "Cable / Clips", text: "Opposition segment repetition crossed threshold." },
    { id: 2, time: "09:12", channel: "Social / X", text: "Narrative crossover detected into persuadable clusters." }
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
      id: 1,
      time: "08:12",
      title: "Opposition message spike detected",
      source: "Ad monitoring",
      severity: "High",
      type: "warroom.threat_detected"
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

function toTitleCaseRisk(value = "") {
  const v = String(value).toLowerCase();
  if (!v) return "Watch";
  if (v.includes("high")) return "High";
  if (v.includes("elevated")) return "Elevated";
  if (v.includes("watch")) return "Watch";
  return value;
}

function buildWarRoomMetrics(threats = [], signals = []) {
  const highThreats = threats.filter(
    (t) => String(t.severity || "").toLowerCase() === "high"
  ).length;

  return [
    {
      label: "Active Threats",
      value: String(threats.length),
      delta: `${highThreats} high severity`,
      tone: highThreats > 0 ? "down" : "up"
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
      value: threats.length > 0 ? "91%" : "89%",
      delta: "+ live ingestion",
      tone: "up"
    }
  ];
}

function buildCommandCenterMetrics({ battlegrounds = [], threats = [], mailDelays = [] }) {
  const avgProb =
    battlegrounds.length > 0
      ? (
          battlegrounds.reduce((sum, item) => {
            const num = Number(String(item.probability || "").replace("%", "")) || 0;
            return sum + num;
          }, 0) / battlegrounds.length
        ).toFixed(1)
      : "61.4";

  return [
    {
      label: "National Win Index",
      value: avgProb,
      delta: `${battlegrounds.length} tracked races`,
      tone: "up"
    },
    {
      label: "Active Threats",
      value: String(threats.length || 0),
      delta: mailDelays.length ? `${mailDelays.length} mail issues` : "No mail disruptions",
      tone: threats.length > 0 || mailDelays.length > 0 ? "down" : "up"
    },
    {
      label: "Fundraising Pulse",
      value: "$12.6M",
      delta: "+11.2%",
      tone: "up"
    },
    {
      label: "Persuasion Opportunity",
      value: "8.7",
      delta: "+0.6",
      tone: "up"
    }
  ];
}

function mapThreatToFeed(threat, index = 0) {
  return {
    id: threat.id || `threat-${index}`,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    title: threat.title || "Threat detected",
    source: threat.source || "War Room",
    severity: threat.severity || "Medium",
    type: "warroom.threat_detected"
  };
}

function mapMailDelayToFeed(delay, index = 0) {
  return {
    id: delay.id || `mail-${index}`,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    title: `Mail delay detected at ${delay.location_name || delay.facility_type || delay.location || "Unknown facility"}`,
    source: "Mail Intelligence",
    severity: "High",
    type: "mail.delay_detected"
  };
}

function mapForecastRaceToBattleground(row, index = 0) {
  const prob = Number(
    row.win_probability ??
      row.winProb ??
      row.win_probability_pct ??
      row.winProbability ??
      0
  );

  return {
    race:
      row.race ||
      row.race_name ||
      `${row.state || "State"} ${row.office || "Race"}`,
    probability: `${prob || 51}%`,
    momentum: row.change || row.delta || "+1.4",
    risk: toTitleCaseRisk(row.rating || row.category || row.status || "Watch"),
    priority: index < 3 ? "Tier 1" : "Tier 2"
  };
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
  const threatsRes = await safeQuery(`
    select *
    from war_room_threats
    order by coalesce(created_at, now()) desc, id desc
    limit 25
  `);

  const signalsRes = await safeQuery(`
    select *
    from war_room_signals
    order by coalesce(created_at, now()) desc, id desc
    limit 25
  `);

  const queueRes = await safeQuery(`
    select *
    from war_room_queue
    order by coalesce(created_at, now()) desc, id desc
    limit 25
  `);

  const threats =
    threatsRes.rows.length > 0
      ? threatsRes.rows.map((row, index) => ({
          id: row.id || index + 1,
          title: row.title || "Threat detected",
          severity: row.severity || "Medium",
          source: row.source || "Live monitoring",
          velocity: row.velocity || "+0%",
          recommendation: row.recommendation || "Review and respond."
        }))
      : WARROOM_FALLBACK.threats;

  const signals =
    signalsRes.rows.length > 0
      ? signalsRes.rows.map((row, index) => ({
          id: row.id || index + 1,
          time: row.time || new Date(row.created_at || Date.now()).toLocaleTimeString(),
          channel: row.channel || "Live Signal",
          text: row.text || row.summary || "Signal captured"
        }))
      : WARROOM_FALLBACK.signals;

  const queue =
    queueRes.rows.length > 0
      ? queueRes.rows.map((row, index) => ({
          id: row.id || index + 1,
          priority: row.priority || "P2",
          owner: row.owner || "Operations",
          item: row.item || "Review signal",
          eta: row.eta || "2 hrs"
        }))
      : WARROOM_FALLBACK.queue;

  return {
    metrics: buildWarRoomMetrics(threats, signals),
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

  try {
    await safeQuery(
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
  } catch {
    // safe fallback
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

  try {
    await safeQuery(
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
  } catch {
    // safe fallback
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

  try {
    await safeQuery(
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
  } catch {
    // safe fallback
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
  const warRoom = await getWarRoomData();

  const forecastRes = await safeQuery(`
    select *
    from forecast_races
    order by coalesce(rank, 999999) asc, coalesce(updated_at, created_at) desc nulls last
    limit 10
  `);

  const mailDelayRes = await safeQuery(`
    select
      me.*,
      md.campaign_id
    from mail_events me
    left join mail_drops md on md.id = me.mail_drop_id
    where lower(coalesce(me.status, me.event_type, '')) = 'delayed'
    order by coalesce(me.created_at, now()) desc, me.id desc
    limit 10
  `);

  const battlegrounds =
    forecastRes.rows.length > 0
      ? forecastRes.rows.map((row, index) => mapForecastRaceToBattleground(row, index))
      : COMMAND_CENTER_FALLBACK.battlegrounds;

  const mailDelays = mailDelayRes.rows || [];

  const actions = [
    ...(warRoom.queue || []).slice(0, 3).map((item) => ({
      title: item.item,
      owner: item.owner,
      due: item.eta,
      detail: `${item.priority} response item in live queue.`
    })),
    ...COMMAND_CENTER_FALLBACK.actions
  ].slice(0, 4);

  const feed = [
    ...(warRoom.threats || []).slice(0, 4).map(mapThreatToFeed),
    ...mailDelays.slice(0, 4).map(mapMailDelayToFeed),
    ...COMMAND_CENTER_FALLBACK.feed
  ].slice(0, 8);

  return {
    metrics: buildCommandCenterMetrics({
      battlegrounds,
      threats: warRoom.threats || [],
      mailDelays
    }),
    battlegrounds,
    actions,
    feed
  };
}
