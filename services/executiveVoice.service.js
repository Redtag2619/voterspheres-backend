import crypto from "node:crypto";

const OPENAI_REALTIME_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

const DEFAULT_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";

const DEFAULT_REALTIME_VOICE =
  process.env.OPENAI_REALTIME_VOICE || "marin";

const ALLOWED_REALTIME_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

const AGENT_PROFILES = {
  executive_chief_of_staff: {
    name: "Executive Chief of Staff",
    purpose:
      "Coordinate executive priorities, synthesize cross-functional analysis, identify decisions requiring leadership attention, and deliver concise action-oriented briefings.",
  },

  campaign_strategist: {
    name: "Campaign Strategist",
    purpose:
      "Develop campaign strategy, paths to victory, targeting priorities, message sequencing, resource allocation, and operational plans.",
  },

  polling_analyst: {
    name: "Polling and Data Analyst",
    purpose:
      "Interpret polling, turnout models, voter movement, demographic changes, geographic trends, uncertainty, and data quality.",
  },

  fundraising_director: {
    name: "Fundraising Director",
    purpose:
      "Analyze fundraising performance, donor strategy, revenue risk, event opportunities, finance pacing, and resource development.",
  },

  communications_director: {
    name: "Communications Director",
    purpose:
      "Develop message strategy, speeches, press responses, talking points, media plans, narrative positioning, and public communications.",
  },

  rapid_response: {
    name: "Rapid Response Director",
    purpose:
      "Assess emerging political threats, opposition attacks, media events, reputational risk, response timing, and escalation options.",
  },

  mailops_director: {
    name: "MailOps Director",
    purpose:
      "Advise on direct-mail strategy, production schedules, targeting, creative approval, vendor capacity, postal timing, and delivery risk.",
  },

  compliance_advisor: {
    name: "Compliance Advisor",
    purpose:
      "Identify campaign-finance, disclosure, approval, documentation, and operational compliance issues. Clearly recommend review by qualified legal counsel when appropriate.",
  },
};

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function cleanText(value, maxLength = 500) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAgentKey(value) {
  const normalized = cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return AGENT_PROFILES[normalized]
    ? normalized
    : "executive_chief_of_staff";
}

function normalizeVoice(value) {
  const requested = cleanText(value, 30).toLowerCase();

  if (ALLOWED_REALTIME_VOICES.has(requested)) {
    return requested;
  }

  if (ALLOWED_REALTIME_VOICES.has(DEFAULT_REALTIME_VOICE)) {
    return DEFAULT_REALTIME_VOICE;
  }

  return "marin";
}

function getUserIdentity(user = {}) {
  return (
    user.id ||
    user.user_id ||
    user.sub ||
    user.email ||
    user.username ||
    "anonymous-authenticated-user"
  );
}

function getWorkspaceId(user = {}, payload = {}) {
  return (
    payload.workspace_id ||
    payload.workspaceId ||
    user.workspace_id ||
    user.workspaceId ||
    null
  );
}

function createSafetyIdentifier(user = {}) {
  const identity = String(getUserIdentity(user));

  const secret =
    process.env.EXECUTIVE_VOICE_SAFETY_SECRET ||
    process.env.JWT_SECRET ||
    process.env.OPENAI_API_KEY;

  if (!secret) {
    throw new Error(
      "EXECUTIVE_VOICE_SAFETY_SECRET, JWT_SECRET, or OPENAI_API_KEY is required."
    );
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`voterspheres-executive-voice:${identity}`)
    .digest("hex");
}

function buildGeographicContext(payload = {}) {
  const executiveContext = asObject(payload.executive_context);

  const selectedState = cleanText(
    executiveContext.selected_state ||
      payload.selected_state ||
      payload.state,
    100
  );

  const county = cleanText(
    executiveContext.county ||
      executiveContext.parish ||
      payload.county ||
      payload.parish,
    140
  );

  const district = cleanText(
    executiveContext.district || payload.district,
    140
  );

  const locality = cleanText(
    executiveContext.locality ||
      executiveContext.city ||
      payload.locality ||
      payload.city,
    140
  );

  const scope = cleanText(
    executiveContext.geographic_scope ||
      payload.geographic_scope ||
      "National",
    160
  );

  return {
    scope,
    selectedState,
    county,
    district,
    locality,
  };
}

function buildOperationalContext(payload = {}) {
  const executiveContext = asObject(payload.executive_context);

  return {
    missionId:
      executiveContext.mission_id || payload.mission_id || null,

    missionTitle: cleanText(
      executiveContext.mission_title ||
        payload.mission_title,
      240
    ),

    nationalReadiness: cleanNumber(
      executiveContext.national_readiness_percentage
    ),

    executionRisk: cleanNumber(
      executiveContext.execution_risk_percentage
    ),

    mapRiskFilter: cleanText(
      executiveContext.map_risk_filter || "all",
      40
    ),

    consultationMode: cleanText(
      executiveContext.consultation_mode ||
        payload.consultation_mode ||
        "single_agent",
      40
    ),
  };
}

function formatContextLine(label, value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return `${label}: ${value}`;
}

function buildRealtimeInstructions({
  user,
  payload,
  agentKey,
}) {
  const profile =
    AGENT_PROFILES[agentKey] ||
    AGENT_PROFILES.executive_chief_of_staff;

  const geographic = buildGeographicContext(payload);
  const operational = buildOperationalContext(payload);

  const userName = cleanText(
    user?.name ||
      [user?.first_name, user?.last_name]
        .filter(Boolean)
        .join(" "),
    120
  );

  const firmName = cleanText(
    user?.firm_name ||
      user?.organization_name ||
      user?.organization,
    160
  );

  const contextLines = [
    formatContextLine("Workspace", getWorkspaceId(user, payload)),
    formatContextLine("User", userName),
    formatContextLine("Firm", firmName),
    formatContextLine("Geographic scope", geographic.scope),
    formatContextLine("Selected state", geographic.selectedState),
    formatContextLine("County or parish", geographic.county),
    formatContextLine("District", geographic.district),
    formatContextLine("Locality", geographic.locality),
    formatContextLine("Active mission ID", operational.missionId),
    formatContextLine(
      "Active mission",
      operational.missionTitle
    ),
    formatContextLine(
      "National readiness percentage",
      operational.nationalReadiness
    ),
    formatContextLine(
      "Execution risk percentage",
      operational.executionRisk
    ),
    formatContextLine(
      "Map risk filter",
      operational.mapRiskFilter
    ),
    formatContextLine(
      "Consultation mode",
      operational.consultationMode
    ),
  ].filter(Boolean);

  return `
You are the ${profile.name} inside VoterSpheres, an executive political campaign operating platform.

PRIMARY ROLE
${profile.purpose}

CONVERSATION STYLE
- Speak naturally, professionally, and confidently.
- Use concise spoken answers first, then provide supporting detail.
- Ask one focused follow-up question when important context is missing.
- Preserve context across follow-up questions.
- Do not describe yourself as a generic chatbot.
- When the user asks for a plan, provide clear priorities, owners, timing, risks, and next actions.
- When the user asks for a briefing, begin with the most important executive conclusion.

POLITICAL COVERAGE
You may discuss national, state, congressional district, legislative district, county, parish, municipal, local, campaign, election, fundraising, polling, communications, direct mail, digital, field, voter-contact, vendor, donor, and operational topics.

ACCURACY AND DATA
- Clearly distinguish live VoterSpheres workspace data from general political knowledge.
- Do not invent polling, fundraising totals, election results, legal deadlines, officeholders, or local facts.
- When current or local information is unavailable, say what information is missing.
- Treat modeled scores and fallback data as estimates, not verified facts.
- Never claim that an action was completed unless a VoterSpheres tool confirms it.

LEGAL AND COMPLIANCE
- Provide general operational and compliance information, not legal advice.
- Recommend qualified election-law counsel for jurisdiction-specific legal conclusions.
- Do not provide instructions to evade campaign-finance, disclosure, election, ethics, or communications laws.

VOICE BEHAVIOR
- Expect interruptions and stop promptly when the user begins speaking.
- Avoid reading long tables aloud.
- Summarize numbers conversationally.
- Offer deeper detail after the initial answer.

CURRENT VOTERSPHERES CONTEXT
${contextLines.length ? contextLines.join("\n") : "No additional workspace context was supplied."}
  `.trim();
}

async function readOpenAiResponse(response) {
  const text = await response.text();

  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message =
      parsed?.error?.message ||
      parsed?.error ||
      text ||
      `OpenAI Realtime request failed with status ${response.status}.`;

    const error = new Error(message);
    error.status = response.status;
    error.openaiResponse = parsed || text;
    throw error;
  }

  if (!parsed) {
    throw new Error(
      "OpenAI returned an empty or invalid Realtime client-secret response."
    );
  }

  return parsed;
}

export async function createExecutiveVoiceSession({
  user = {},
  payload = {},
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error(
      "OPENAI_API_KEY is not configured."
    );
    error.status = 503;
    throw error;
  }

  const safePayload = asObject(payload);
  const agentKey = normalizeAgentKey(
    safePayload.agent ||
      safePayload.agent_key ||
      safePayload.agentKey
  );

  const voice = normalizeVoice(safePayload.voice);
  const model = DEFAULT_REALTIME_MODEL;

  const instructions = buildRealtimeInstructions({
    user,
    payload: safePayload,
    agentKey,
  });

  const safetyIdentifier = createSafetyIdentifier(user);

  /*
   * Keep the token-creation session deliberately conservative.
   * Model and voice are fixed before the browser connects.
   * Rich instructions are also returned as a session.update event,
   * which the frontend should send after the WebRTC data channel opens.
   */
  const sessionRequest = {
    session: {
      type: "realtime",
      model,
      audio: {
        output: {
          voice,
        },
      },
    },
  };

  const response = await fetch(
    OPENAI_REALTIME_CLIENT_SECRETS_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify(sessionRequest),
    }
  );

  const clientSecretResponse =
    await readOpenAiResponse(response);

  const clientSecret =
    clientSecretResponse.value ||
    clientSecretResponse.client_secret?.value ||
    null;

  if (!clientSecret) {
    const error = new Error(
      "OpenAI did not return a Realtime client secret."
    );
    error.status = 502;
    error.openaiResponse = clientSecretResponse;
    throw error;
  }

  return {
    client_secret: clientSecret,

    expires_at:
      clientSecretResponse.expires_at ||
      clientSecretResponse.client_secret?.expires_at ||
      null,

    model,
    voice,
    agent: agentKey,

    realtime_calls_url:
      "https://api.openai.com/v1/realtime/calls",

    /*
     * Send this event through the WebRTC data channel after it opens.
     */
    session_update: {
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
      },
    },

    /*
     * Useful for the frontend UI and debugging.
     * This contains no permanent API key.
     */
    session: {
      type: "realtime",
      model,
      voice,
      agent: agentKey,
      agent_name: AGENT_PROFILES[agentKey].name,
      workspace_id: getWorkspaceId(user, safePayload),
    },
  };
}

export function getExecutiveVoiceConfiguration() {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY),
    model: DEFAULT_REALTIME_MODEL,
    default_voice: normalizeVoice(DEFAULT_REALTIME_VOICE),
    voices: [...ALLOWED_REALTIME_VOICES],
    transport: "webrtc",
    session_endpoint: "/api/executive-voice/session",
    realtime_calls_url:
      "https://api.openai.com/v1/realtime/calls",
  };
}