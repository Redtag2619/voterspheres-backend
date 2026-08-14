import crypto from "crypto";

 

import { EXECUTIVE_VOICE_TOOL_DEFINITIONS } from "./executiveVoiceTools.service.js";

 

 

 

const OPENAI_REALTIME_CLIENT_SECRETS_URL =

 

  process.env.OPENAI_REALTIME_CLIENT_SECRETS_URL ||

 

  "https://api.openai.com/v1/realtime/client_secrets";

 

const OPENAI_SPEECH_URL =

 

  process.env.OPENAI_SPEECH_URL || "https://api.openai.com/v1/audio/speech";

 

const DEFAULT_SPEECH_MODEL =

 

  process.env.OPENAI_SPEECH_MODEL || "gpt-4o-mini-tts";

 

 

 

const DEFAULT_REALTIME_MODEL =

 

  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

 

 

 

const DEFAULT_REALTIME_VOICE =

 

  process.env.OPENAI_REALTIME_VOICE || "marin";

 

 

 

const ALLOWED_REALTIME_VOICES = new Set([

 

  "alloy",

 

  "ash",

 

  "ballad",

 

  "cedar",

 

  "coral",

 

  "echo",

 

  "marin",

 

  "sage",

 

  "shimmer",

 

  "verse",

 

]);

 

 

 

const AGENT_PROFILES = {

 

  executive_chief_of_staff: {

 

    name: "Executive Chief of Staff",

 

    purpose:

 

      "Coordinate VoterSpheres intelligence across strategy, polling, fundraising, operations, communications, vendors, state intelligence, election administration, and executive decision systems.",

 

  },

 

  campaign_strategist: {

 

    name: "Campaign Strategist",

 

    purpose:

 

      "Turn political intelligence into prioritized campaign strategy, state focus, timing, resource allocation, and measurable next actions.",

 

  },

 

  polling_analyst: {

 

    name: "Polling & Data Analyst",

 

    purpose:

 

      "Explain current polling, trend movement, sample quality, uncertainty, geography, and the operational implications of the data.",

 

  },

 

  fundraising_director: {

 

    name: "Fundraising Director",

 

    purpose:

 

      "Analyze FEC finance, receipts, cash, donor activity, fundraising pressure, and resource readiness.",

 

  },

 

  communications_director: {

 

    name: "Communications Director",

 

    purpose:

 

      "Analyze live political news, narrative risk, communications opportunities, rapid response, and message priorities.",

 

  },

 

  rapid_response: {

 

    name: "Rapid Response Director",

 

    purpose:

 

      "Identify urgent threats, current developments, escalation conditions, and the immediate response sequence.",

 

  },

 

  mailops_director: {

 

    name: "MailOps Director",

 

    purpose:

 

      "Analyze direct-mail production, operational readiness, timing, capacity, vendor dependencies, and execution risk.",

 

  },

 

  compliance_advisor: {

 

    name: "Compliance Advisor",

 

    purpose:

 

      "Surface general campaign compliance, election-administration, approval, disclosure, and escalation considerations without replacing qualified legal counsel.",

 

  },

 

};

 

 

 

function asObject(value) {

 

  return value && typeof value === "object" && !Array.isArray(value)

 

    ? value

 

    : {};

 

}

 

 

 

function cleanText(value, max = 500) {

 

  return String(value ?? "")

 

    .replace(/\s+/g, " ")

 

    .trim()

 

    .slice(0, max);

 

}

 

 

 

function normalizeAgentKey(value) {

 

  const key = cleanText(value || "executive_chief_of_staff", 100)

 

    .toLowerCase()

 

    .replace(/[^a-z0-9]+/g, "_")

 

    .replace(/^_+|_+$/g, "");

 

 

 

  return AGENT_PROFILES[key] ? key : "executive_chief_of_staff";

 

}

 

 

 

function normalizeVoice(value) {

 

  const requested = cleanText(value || DEFAULT_REALTIME_VOICE, 40).toLowerCase();

 

  return ALLOWED_REALTIME_VOICES.has(requested)

 

    ? requested

 

    : ALLOWED_REALTIME_VOICES.has(DEFAULT_REALTIME_VOICE)

 

      ? DEFAULT_REALTIME_VOICE

 

      : "marin";

 

}

 

 

 

function getWorkspaceId(user = {}, payload = {}) {

 

  const context = asObject(payload.executive_context);

 

  const value =

 

    payload.workspace_id ??

 

    payload.workspaceId ??

 

    context.workspace_id ??

 

    user.workspace_id ??

 

    user.workspaceId ??

 

    1;

 

 

 

  const number = Number(value);

 

  return Number.isFinite(number) && number > 0 ? number : 1;

 

}

 

 

 

function buildGeographicContext(payload = {}) {

 

  const context = asObject(payload.executive_context);

 

 

 

  return {

 

    scope: cleanText(

 

      context.geographic_scope || payload.geographic_scope || "National",

 

      160

 

    ),

 

    selectedState: cleanText(

 

      context.selected_state || payload.state || payload.state_code,

 

      80

 

    ),

 

    county: cleanText(

 

      context.county || context.county_name || payload.county || payload.county_name,

 

      120

 

    ),

 

    district: cleanText(

 

      context.district || payload.district,

 

      120

 

    ),

 

    locality: cleanText(

 

      context.locality || payload.locality,

 

      120

 

    ),

 

  };

 

}

 

 

 

function buildOperationalContext(payload = {}) {

 

  const context = asObject(payload.executive_context);

 

 

 

  return {

 

    missionId: context.mission_id ?? payload.mission_id ?? null,

 

    missionTitle: cleanText(

 

      context.mission_title || payload.mission_title,

 

      200

 

    ),

 

    nationalReadiness:

 

      context.national_readiness_percentage ??

 

      payload.national_readiness_percentage ??

 

      null,

 

    executionRisk:

 

      context.execution_risk_percentage ??

 

      payload.execution_risk_percentage ??

 

      null,

 

    mapRiskFilter: cleanText(

 

      context.map_risk_filter || payload.map_risk_filter,

 

      80

 

    ),

 

    consultationMode: cleanText(

 

      context.consultation_mode || payload.consultation_mode || "team",

 

      80

 

    ),

 

  };

 

}

 

 

 

function createSafetyIdentifier(user = {}) {

 

  const stableValue = cleanText(

 

    user.id || user.user_id || user.email || user.sub || "anonymous",

 

    256

 

  );

 

 

 

  return crypto

 

    .createHash("sha256")

 

    .update(`voterspheres:${stableValue}`)

 

    .digest("hex")

 

    .slice(0, 64);

 

}

 

 

 

function formatContextLine(label, value) {

 

  if (value === null || value === undefined || value === "") return null;

 

  return `${label}: ${value}`;

 

}

 

 

 

function buildRealtimeInstructions({ user, payload, agentKey }) {

 

  const profile =

 

    AGENT_PROFILES[agentKey] || AGENT_PROFILES.executive_chief_of_staff;

 

 

 

  const geographic = buildGeographicContext(payload);

 

  const operational = buildOperationalContext(payload);

 

 

 

  const userName = cleanText(

 

    user?.name || [user?.first_name, user?.last_name].filter(Boolean).join(" "),

 

    120

 

  );

 

 

 

  const firmName = cleanText(

 

    user?.firm_name || user?.organization_name || user?.organization,

 

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

 

    formatContextLine("Active mission", operational.missionTitle),

 

    formatContextLine(

 

      "National readiness percentage",

 

      operational.nationalReadiness

 

    ),

 

    formatContextLine("Execution risk percentage", operational.executionRisk),

 

    formatContextLine("Map risk filter", operational.mapRiskFilter),

 

    formatContextLine("Consultation mode", operational.consultationMode),

 

  ].filter(Boolean);

 

 

 

  return `

 

You are the ${profile.name} inside VoterSpheres, an executive political campaign operating platform.

 

 

 

PRIMARY ROLE

 

${profile.purpose}

 

 

 

MANDATORY LIVE-DATA BEHAVIOR

 

- You have VoterSpheres function tools. Use them whenever a user's question depends on current, workspace-specific, candidate-specific, state/local, polling, fundraising, FEC, news, election-administration, legislative, weather/field, operational, or executive intelligence.

 

- Do not answer a current-data question from memory when an appropriate VoterSpheres tool is available.

 

- For broad executive briefings, begin with get_unified_executive_intelligence, then call additional specialist tools when needed.

 

- For latest/current political reporting, use search_live_news.

 

- For a named candidate's current activity, use get_candidate_live_intelligence.

 

- For polls, use get_latest_polling.

 

- For campaign finance or cash/receipts/disbursements/debt, use get_fec_finance.

 

- For state/local operational posture, use get_state_operations.

 

- For election administration, use get_election_administration_updates.

 

- For federal legislative developments, use get_legislative_updates.

 

- For field/weather risk, use get_weather_field_risk.

 

- If one question needs several sources, call the necessary tools sequentially before giving the final spoken synthesis.

 

- Never invent a value because a tool returned no rows. Say the requested data was unavailable or degraded.

 

 

 

CONVERSATION STYLE

 

- Speak naturally, professionally, and confidently.

 

- Start with a concise executive answer, then add supporting detail.

 

- Preserve conversational context across follow-up questions.

 

- Do not describe yourself as a generic chatbot.

 

- When the user asks for a plan, provide priorities, timing, risks, and next actions.

 

- When the user asks for a briefing, lead with the most important executive conclusion.

 

- Avoid reading long tables aloud; summarize the most important numbers and offer deeper detail.

 

 

 

ACCURACY

 

- Clearly distinguish verified live VoterSpheres data, stored workspace data, modeled data, and general analysis.

 

- Do not invent polling, fundraising totals, election results, legal deadlines, officeholders, or local facts.

 

- Treat modeled/fallback scores as estimates.

 

- Never claim an action was completed unless a VoterSpheres tool confirms it.

 

 

 

LEGAL AND COMPLIANCE

 

- Provide general operational/compliance information, not legal advice.

 

- Recommend qualified election-law counsel for jurisdiction-specific legal conclusions.

 

 

 

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

 

 

 

function normalizeSessionMode(value) {

  return String(value || "command").trim().toLowerCase() === "assistant"

    ? "assistant"

    : "command";

}

 

function normalizeSpeechInput(value) {

 

  return String(value ?? "")

 

    .replace(/```[a-z]*\n?/gi, "")

 

    .replace(/```/g, "")

 

    .replace(/[*_#`]+/g, "")

 

    .replace(/\r\n/g, "\n")

 

    .replace(/\n{3,}/g, "\n\n")

 

    .trim()

 

    .slice(0, 7000);

 

}

 

function realtimeSessionConfiguration({ model, voice, instructions, mode }) {

  const commandMode = mode === "command";

 

  return {

    type: "realtime",

    model,

    instructions: commandMode

      ? [

          instructions,

          "You are operating as a transcription-only command interface.",

          "Do not independently answer, synthesize, or invoke tools.",

          "The finalized transcript is submitted to the authoritative VoterSpheres Executive AI pipeline.",

        ].join("\n\n")

      : instructions,

    tools: commandMode ? [] : EXECUTIVE_VOICE_TOOL_DEFINITIONS,

    tool_choice: commandMode ? "none" : "auto",

    audio: {

      input: {

        transcription: {

          model:

            process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ||

            "gpt-4o-mini-transcribe",

          language: "en",

        },

        turn_detection: {

          type: "server_vad",

          threshold: 0.5,

          prefix_padding_ms: 300,

          silence_duration_ms: 750,

          create_response: !commandMode,

          interrupt_response: !commandMode,

        },

      },

      output: {

        voice,

      },

    },

  };

}

 

 

 

export async function createExecutiveVoiceSession({ user = {}, payload = {} } = {}) {

 

  const apiKey = process.env.OPENAI_API_KEY;

 

 

 

  if (!apiKey) {

 

    const error = new Error("OPENAI_API_KEY is not configured.");

 

    error.status = 503;

 

    throw error;

 

  }

 

 

 

  const safePayload = asObject(payload);

 

  const agentKey = normalizeAgentKey(

 

    safePayload.agent || safePayload.agent_key || safePayload.agentKey

 

  );

 

  const voice = normalizeVoice(safePayload.voice);

 

  const mode = normalizeSessionMode(safePayload.mode);

 

  const model = DEFAULT_REALTIME_MODEL;

 

  const instructions = buildRealtimeInstructions({

 

    user,

 

    payload: safePayload,

 

    agentKey,

 

  });

 

 

 

  const sessionConfig = realtimeSessionConfiguration({

 

    model,

 

    voice,

 

    instructions,

 

    mode,

 

  });

 

 

 

  const response = await fetch(OPENAI_REALTIME_CLIENT_SECRETS_URL, {

 

    method: "POST",

 

    headers: {

 

      Authorization: `Bearer ${apiKey}`,

 

      "Content-Type": "application/json",

 

      "OpenAI-Safety-Identifier": createSafetyIdentifier(user),

 

    },

 

    body: JSON.stringify({ session: sessionConfig }),

 

  });

 

 

 

  const clientSecretResponse = await readOpenAiResponse(response);

 

  const clientSecret =

 

    clientSecretResponse.value ||

 

    clientSecretResponse.client_secret?.value ||

 

    null;

 

 

 

  if (!clientSecret) {

 

    const error = new Error("OpenAI did not return a Realtime client secret.");

 

    error.status = 502;

 

    error.openaiResponse = clientSecretResponse;

 

    throw error;

 

  }

 

 

 

  return {

 

    ok: true,

 

    build: "5.10.0-hybrid-live-conversation",

 

    service: "unified-executive-voice-intelligence",

 

    client_secret: clientSecret,

 

    expires_at:

 

      clientSecretResponse.expires_at ||

 

      clientSecretResponse.client_secret?.expires_at ||

 

      null,

 

    model,

 

    voice,

 

    agent: agentKey,

 

    mode,

 

    tool_count: mode === "command" ? 0 : EXECUTIVE_VOICE_TOOL_DEFINITIONS.length,

 

    tools_enabled: mode !== "command" && EXECUTIVE_VOICE_TOOL_DEFINITIONS.length > 0,

 

    realtime_calls_url: "https://api.openai.com/v1/realtime/calls",

 

    session_update: {

 

      type: "session.update",

 

      session: sessionConfig,

 

    },

 

    session: {

 

      type: "realtime",

 

      model,

 

      voice,

 

      agent: agentKey,

 

      agent_name: AGENT_PROFILES[agentKey].name,

 

      mode,

 

      workspace_id: getWorkspaceId(user, safePayload),

 

      tool_count: mode === "command" ? 0 : EXECUTIVE_VOICE_TOOL_DEFINITIONS.length,

 

    },

 

  };

 

}

 

 

 

export async function createExecutiveVoiceSpeech({ user = {}, payload = {} } = {}) {

 

  const apiKey = process.env.OPENAI_API_KEY;

 

  if (!apiKey) {

 

    const error = new Error("OPENAI_API_KEY is not configured.");

 

    error.status = 503;

 

    throw error;

 

  }

 

  const safePayload = asObject(payload);

 

  const input = normalizeSpeechInput(

 

    safePayload.text || safePayload.input || safePayload.answer

 

  );

 

  if (!input) {

 

    const error = new Error("Speech text is required.");

 

    error.status = 400;

 

    throw error;

 

  }

 

  const voice = normalizeVoice(safePayload.voice);

 

  const model = cleanText(safePayload.model || DEFAULT_SPEECH_MODEL, 80);

 

  const instructions = cleanText(

 

    safePayload.instructions ||

 

      "Speak naturally as a calm, confident executive intelligence advisor. Preserve names, numbers, percentages, dates, and source attributions. Use measured pacing and brief pauses between sections.",

 

    500

 

  );

 

  const response = await fetch(OPENAI_SPEECH_URL, {

 

    method: "POST",

 

    headers: {

 

      Authorization: `Bearer ${apiKey}`,

 

      "Content-Type": "application/json",

 

      "OpenAI-Safety-Identifier": createSafetyIdentifier(user),

 

    },

 

    body: JSON.stringify({

 

      model,

 

      voice,

 

      input,

 

      instructions,

 

      response_format: "mp3",

 

    }),

 

  });

 

  if (!response.ok) {

 

    let detail = "OpenAI speech generation failed.";

 

    try {

 

      const errorPayload = await response.json();

 

      detail = errorPayload?.error?.message || errorPayload?.message || detail;

 

    } catch {

 

      // Keep the safe fallback detail.

 

    }

 

    const error = new Error(detail);

 

    error.status =

 

      response.status >= 400 && response.status <= 599 ? response.status : 502;

 

    throw error;

 

  }

 

  return {

 

    audio: Buffer.from(await response.arrayBuffer()),

 

    content_type: response.headers.get("content-type") || "audio/mpeg",

 

    model,

 

    voice,

 

    character_count: input.length,

 

  };

 

}

 

export function getExecutiveVoiceConfiguration() {

 

  return {

 

    enabled: Boolean(process.env.OPENAI_API_KEY),

 

    build: "5.10.0-hybrid-live-conversation",

 

    model: DEFAULT_REALTIME_MODEL,

 

    default_voice: normalizeVoice(DEFAULT_REALTIME_VOICE),

 

    voices: [...ALLOWED_REALTIME_VOICES],

 

    transport: "webrtc",

 

    modes: ["command", "assistant"],

 

    default_mode: "command",

 

    speech_playback_enabled: Boolean(process.env.OPENAI_API_KEY),

 

    speech_model: DEFAULT_SPEECH_MODEL,

 

    speech_endpoint: "/api/executive-voice/speak",

 

    tools_enabled: false,

 

    assistant_mode_tools_enabled: EXECUTIVE_VOICE_TOOL_DEFINITIONS.length > 0,

 

    tool_count: EXECUTIVE_VOICE_TOOL_DEFINITIONS.length,

 

    session_endpoint: "/api/executive-voice/session",

 

    tools_endpoint: "/api/executive-voice-tools",

 

    realtime_calls_url: "https://api.openai.com/v1/realtime/calls",

 

  };

 

}

