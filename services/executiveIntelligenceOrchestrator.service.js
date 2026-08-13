import OpenAI from "openai";

 

 

 

 

 

 

 

import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

 

 

import { getCandidateIntelligenceBundle } from "./candidateIntelligenceBundle.service.js";

 

 

 

 

 

 

 

const BUILD = "4.4.0-unified-candidate-intelligence";

 

 

 

 

 

 

 

const ORCHESTRATOR_TIMEOUT_MS =

 

 

 

  Number(process.env.EXECUTIVE_ORCHESTRATOR_TIMEOUT_MS) || 45000;

 

 

 

 

 

 

 

const TOOL_TIMEOUT_MS =

 

 

 

  Number(process.env.EXECUTIVE_ORCHESTRATOR_TOOL_TIMEOUT_MS) || 30000;

 

 

 

 

 

 

 

const SYNTHESIS_TIMEOUT_MS =

 

 

 

  Number(process.env.EXECUTIVE_ORCHESTRATOR_SYNTHESIS_TIMEOUT_MS) || 18000;

 

 

 

 

 

 

 

const MAX_TOOLS =

 

 

 

  Number(process.env.EXECUTIVE_ORCHESTRATOR_MAX_TOOLS) || 9;

 

 

 

 

 

 

 

const MODEL =

 

 

 

  process.env.EXECUTIVE_ORCHESTRATOR_MODEL || "gpt-5-mini";

 

 

 

 

 

 

 

const openai = process.env.OPENAI_API_KEY

 

 

 

  ? new OpenAI({

 

 

 

      apiKey: process.env.OPENAI_API_KEY,

 

 

 

      timeout: SYNTHESIS_TIMEOUT_MS,

 

 

 

      maxRetries: 1,

 

 

 

    })

 

 

 

  : null;

 

 

 

 

 

 

 

const STATE_NAMES = Object.freeze({

 

 

 

  AL: "Alabama",

 

 

 

  AK: "Alaska",

 

 

 

  AZ: "Arizona",

 

 

 

  AR: "Arkansas",

 

 

 

  CA: "California",

 

 

 

  CO: "Colorado",

 

 

 

  CT: "Connecticut",

 

 

 

  DE: "Delaware",

 

 

 

  FL: "Florida",

 

 

 

  GA: "Georgia",

 

 

 

  HI: "Hawaii",

 

 

 

  ID: "Idaho",

 

 

 

  IL: "Illinois",

 

 

 

  IN: "Indiana",

 

 

 

  IA: "Iowa",

 

 

 

  KS: "Kansas",

 

 

 

  KY: "Kentucky",

 

 

 

  LA: "Louisiana",

 

 

 

  ME: "Maine",

 

 

 


  MD: "Maryland",

 

 

 

  MA: "Massachusetts",

 

 

 

  MI: "Michigan",

 

 

 

  MN: "Minnesota",

 

 

 

  MS: "Mississippi",

 

 

 

  MO: "Missouri",

 

 

 

  MT: "Montana",

 

 

 

  NE: "Nebraska",

 

 

 

  NV: "Nevada",

 

 

 

  NH: "New Hampshire",

 

 

 

  NJ: "New Jersey",

 

 

 

  NM: "New Mexico",

 

 

 

  NY: "New York",

 

 

 

  NC: "North Carolina",

 

 

 

  ND: "North Dakota",

 

 

 

  OH: "Ohio",

 

 

 

  OK: "Oklahoma",

 

 

 

  OR: "Oregon",

 

 

 

  PA: "Pennsylvania",

 

 

 

  RI: "Rhode Island",

 

 

 

  SC: "South Carolina",

 

 

 

  SD: "South Dakota",

 

 

 

  TN: "Tennessee",

 

 

 

  TX: "Texas",

 

 

 

  UT: "Utah",

 

 

 

  VT: "Vermont",

 

 

 

  VA: "Virginia",

 

 

 

  WA: "Washington",

 

 

 

  WV: "West Virginia",

 

 

 

  WI: "Wisconsin",

 

 

 

  WY: "Wyoming",

 

 

 

  DC: "District of Columbia",

 

 

 

});

 

 

 

 

 

 

 

const STATE_CODES = Object.fromEntries(

 

 

 

  Object.entries(STATE_NAMES).map(([code, name]) => [

 

 

 

    name.toLowerCase(),

 

 

 

    code,

 

 

 

  ])

 

 

 

);

 

 

 

 

 

 

 

const now = () => new Date().toISOString();

 

 

 

 

 

 

 

const clean = (value = "") =>

 

 

 

  String(value ?? "").trim();

 

 

 

 

 

 

 

const unique = (values = []) =>

 

 

 

  [...new Set(values.map(clean).filter(Boolean))];

 

 

 

 

 

 

 

const clamp = (value, fallback, min, max) => {

 

 

 


  const number = Number.parseInt(value, 10);

 

 

 

 

 

 

 

  return Number.isFinite(number)

 

 

 

    ? Math.min(max, Math.max(min, number))

 

 

 

    : fallback;

 

 

 

};

 

 

 

 

 

 

 

function withTimeout(promise, timeoutMs, label) {

 

 

 

  let timer;

 

 

 

 

 

 

 

  const timeout = new Promise((_resolve, reject) => {

 

 

 

    timer = setTimeout(

 

 

 

      () =>

 

 

 

        reject(

 

 

 

          Object.assign(

 

 

 

            new Error(

 

 

 

              `${label} timed out after ${timeoutMs}ms.`

 

 

 

            ),

 

 

 

            {

 

 

 

              code: "ORCHESTRATOR_TIMEOUT",

 

 

 

            }

 

 

 

          )

 

 

 

        ),

 

 

 

      timeoutMs

 

 

 

    );

 

 

 

  });

 

 

 

 

 

 

 

  return Promise.race([

 

 

 

    promise,

 

 

 

    timeout,

 

 

 

  ]).finally(() =>

 

 

 

    clearTimeout(timer)

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function safeJson(value) {

 

 

 

  if (

 

 

 

    value &&

 

 

 

    typeof value === "object"

 

 

 

  ) {

 

 

 

    return value;

 

 

 

  }

 

 

 

 

 

 

 

  try {

 

 

 

    return JSON.parse(value);

 

 

 

  } catch {

 

 

 

    return null;

 

 

 

  }

 

 

 

}

 

 

 

 

 

 

 


function extractJsonObject(value) {

 

 

 

  const text = clean(value);

 

 

 

 

 

 

 

  if (!text) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  const direct = safeJson(text);

 

 

 

 

 

 

 

  if (direct) {

 

 

 

    return direct;

 

 

 

  }

 

 

 

 

 

 

 

  const unfenced = text

 

 

 

    .replace(

 

 

 

      /^```(?:json)?/i,

 

 

 

      ""

 

 

 

    )

 

 

 

    .replace(

 

 

 

      /```$/i,

 

 

 

      ""

 

 

 

    )

 

 

 

    .trim();

 

 

 

 

 

 

 

  const parsed = safeJson(unfenced);

 

 

 

 

 

 

 

  if (parsed) {

 

 

 

    return parsed;

 

 

 

  }

 

 

 

 

 

 

 

  const start =

 

 

 

    text.indexOf("{");

 

 

 

 

 

 

 

  const end =

 

 

 

    text.lastIndexOf("}");

 

 

 

 

 

 

 

  return start >= 0 &&

 

 

 

    end > start

 

 

 

    ? safeJson(

 

 

 

        text.slice(

 

 

 

          start,

 

 

 

          end + 1

 

 

 

        )

 

 

 

      )

 

 

 

    : null;

 

 

 

}

 

 

 

 

 

 

 

function detectState(
  question,
  suppliedState = ""
) {
  const explicit =
    clean(
      suppliedState
    ).toUpperCase();

  /*
   * Explicit payload state always has priority.
   */
  if (
    STATE_NAMES[explicit]
  ) {
    return explicit;
  }

  const raw =
    clean(
      question
    );

  const lower =

    raw.toLowerCase();

  /*
   * First resolve full state names.
   *
   * Use word boundaries so names such as "maine" or "texas"
   * are matched as geographic terms rather than substrings.
   */
  for (
    const [name, code]
    of Object.entries(
      STATE_CODES
    )
  ) {
    const escapedName =
      String(name)
        .replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

    const stateNamePattern =
      new RegExp(
        `\\b${escapedName}\\b`,
        "i"
      );

    if (
      stateNamePattern.test(
        raw
      )
    ) {
      return code;
    }
  }

  /*
   * Postal abbreviations are intentionally CASE-SENSITIVE.
   *
   * This prevents ordinary English words from being interpreted
   * as states:
   *
   *   "give me a briefing"  -> must NOT resolve ME / Maine
   *   "or should we..."     -> must NOT resolve OR / Oregon
   *   "in the race..."      -> must NOT resolve IN / Indiana
   *
   * Explicit geographic text such as "TX", "GA", "PA", etc.
   * still resolves normally.
   */
  const postalMatch =
    raw.match(
      /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/
    );

  return postalMatch
    ? postalMatch[1]
    : "";
}
 

 

 

 

 

 

 

function detectCycle(

 

 

 

  question,

 

 

 

  suppliedCycle = ""

 

 

 

) {

 

 

 

  const explicit =

 

 

 

    clean(

 

 

 

      suppliedCycle

 

 

 

    );

 

 

 

 

 

 

 

  if (

 

 

 

    /^20\d{2}$/.test(

 

 

 

      explicit

 

 

 

    )

 

 

 

  ) {

 

 

 

    return explicit;

 

 

 

  }

 

 

 

 

 

 

 

  const match =

 

 

 

    clean(

 

 

 

      question

 

 

 

    ).match(

 

 

 

      /\b(20\d{2})\b/

 

 

 

    );

 

 

 

 

 

 

 

  return (

 

 

 

    match?.[1] ||

 

 

 

    String(

 

 

 

      new Date().getFullYear()

 

 

 

    )

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function detectOffice(

 

 

 

  question,

 

 

 

  suppliedOffice = ""

 

 

 

) {

 

 

 

  const explicit =

 

 

 

    clean(

 

 

 

      suppliedOffice

 

 

 

    );

 

 

 

 

 

 

 


  if (explicit) {

 

 

 

    return explicit;

 

 

 

  }

 

 

 

 

 

 

 

  const lower =

 

 

 

    clean(

 

 

 

      question

 

 

 

    ).toLowerCase();

 

 

 

 

 

 

 

  const pairs = [

 

 

 

    [

 

 

 

      "president",

 

 

 

      "President",

 

 

 

    ],

 

 

 

    [

 

 

 

      "governor",

 

 

 

      "Governor",

 

 

 

    ],

 

 

 

    [

 

 

 

      "u.s. senate",

 

 

 

      "U.S. Senate",

 

 

 

    ],

 

 

 

    [

 

 

 

      "us senate",

 

 

 

      "U.S. Senate",

 

 

 

    ],

 

 

 

    [

 

 

 

      "senate",

 

 

 

      "U.S. Senate",

 

 

 

    ],

 

 

 

    [

 

 

 

      "u.s. house",

 

 

 

      "U.S. House",

 

 

 

    ],

 

 

 

    [

 

 

 

      "congress",

 

 

 

      "U.S. House",

 

 

 

    ],

 

 

 

    [

 

 

 

      "attorney general",

 

 

 

      "Attorney General",

 

 

 

    ],

 

 

 

    [

 

 

 

      "secretary of state",

 

 

 

      "Secretary of State",

 

 

 

    ],

 

 

 

    [

 

 

 

      "mayor",

 

 

 

      "Mayor",

 

 

 

    ],

 

 

 


  ];

 

 

 

 

 

 

 

  return (

 

 

 

    pairs.find(

 

 

 

      ([needle]) =>

 

 

 

        lower.includes(

 

 

 

          needle

 

 

 

        )

 

 

 

    )?.[1] ||

 

 

 

    ""

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function cleanupDetectedCandidate(value = "") {

 

 

 

  return clean(value)

 

 

 

    .replace(

 

 

 

      /^(?:the\s+)?(?:latest|current|newest|most recent)?\s*(?:fec\s+)?(?:report|filing|finance|financials?)\s+for\s+/i,

 

 

 

      ""

 

 

 

    )

 

 

 

    .replace(

 

 

 

      /^(?:for|about|on)\s+/i,

 

 

 

      ""

 

 

 

    )

 

 

 

    .replace(/[?.!,;:]+$/g, "")

 

 

 

    .replace(/\s+/g, " ")

 

 

 

    .trim();

 

 

 

}

 

 

 

 

 

 

 

function detectCandidate(
  question,
  suppliedCandidate = ""
) {
  const explicit =
    cleanupDetectedCandidate(
      suppliedCandidate
    );

  if (explicit) {
    return explicit;
  }

  const text =
    clean(question);

  if (!text) {
    return "";
  }

  /*
   * Quoted candidate:
   *   briefing on "Jasmine Crockett"
   */
  const quoted =
    text.match(
      /["“]([^"”]{3,80})["”]/
    );

  if (quoted) {
    const candidate =
      cleanupDetectedCandidate(
        quoted[1]
      );

    if (candidate) {
      return candidate;
    }
  }

  /*
   * Finance/FEC-specific forms.
   *
   * Examples:
   *   current FEC report for Jasmine Crockett
   *   fundraising for Jasmine Crockett
   *   finance report for Jasmine Crockett
   */
  const financeFor =
    text.match(
      /(?:fec|finance|financial|report|filing|fundraising)[^\n]{0,50}?\bfor\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3})(?=\s*(?:\?|$|,|\.|in\s+20\d{2}\b))/i
    );

  if (financeFor) {
    const candidate =
      cleanupDetectedCandidate(
        financeFor[1]
      );

    if (candidate) {
      return candidate;
    }
  }

  /*
   * Executive candidate briefing forms.
   *
   * Examples:
   *   give me a complete briefing on Jasmine Crockett
   *   full briefing about Jasmine Crockett
   *   candidate briefing for Jasmine Crockett
   *   assessment of Jasmine Crockett
   */
  const briefingFor =
    text.match(
      /(?:complete\s+briefing|full\s+briefing|candidate\s+briefing|briefing|complete\s+assessment|full\s+assessment|assessment|intelligence)\s+(?:on|about|for|of)\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3})(?=\s*(?:\?|$|,|\.|in\s+20\d{2}\b))/i
    );

  if (briefingFor) {
    const candidate =
      cleanupDetectedCandidate(
        briefingFor[1]
      );

    if (
      candidate &&
      !Object.values(
        STATE_NAMES
      ).some(
        (stateName) =>
          clean(
            stateName
          ).toLowerCase() ===
          candidate.toLowerCase()
      )
    ) {
      return candidate;
    }
  }

  /*
   * "Brief me on..." form.
   */
  const briefMe =
    text.match(
      /\bbrief\s+me\s+(?:on|about)\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3})(?=\s*(?:\?|$|,|\.|in\s+20\d{2}\b))/i
    );

  if (briefMe) {
    const candidate =
      cleanupDetectedCandidate(
        briefMe[1]
      );

    if (candidate) {
      return candidate;
    }
  }

  /*
   * "Tell me everything about..." form.
   */
  const everythingAbout =
    text.match(
      /(?:tell\s+me\s+everything\s+(?:about|on)|everything\s+(?:about|on)|what\s+should\s+i\s+know\s+(?:about|on))\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3})(?=\s*(?:\?|$|,|\.|in\s+20\d{2}\b))/i
    );

  if (everythingAbout) {
    const candidate =
      cleanupDetectedCandidate(
        everythingAbout[1]
      );

    if (candidate) {
      return candidate;
    }
  }

  /*
   * General candidate forms.
   */
  const patterns = [
    /(?:about|candidate|profile|statistics|polling|fundraising|finance|fec|news on|news about|tell me about|show me|report for|filing for)\s+(?:for\s+)?([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3})/i,

    /([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3})\s+(?:campaign|polling|fundraising|finance|fec|candidate|race|statistics|news|report|filing)/i,
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      text.match(
        pattern
      );

    if (!match) {
      continue;
    }

    const candidate =
      cleanupDetectedCandidate(
        match[1]
      );

    if (
      candidate &&
      !Object.values(
        STATE_NAMES
      ).some(
        (stateName) =>
          clean(
            stateName
          ).toLowerCase() ===
          candidate.toLowerCase()
      )

    ) {
      return candidate;
    }
  }

  return "";
}
 

 

 

 

 

 

 

function classifyIntent(

 

 

 

  question,

 

 

 

  context = {}

 

 

 

) {

 

 

 

  const lower =

 

 

 

    clean(

 

 

 

      question

 

 

 

    ).toLowerCase();

 

 

 

 

 

 

 

  if (

 

 

 

    /poll|polls|polling|horse race|margin|who(?:'s| is) leading|lead(?:ing)? by|survey/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return "polling";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    /fec|fundrais|donor|cash on hand|receipts|disbursement|finance|financial|raised|spent|committee money|filing|quarterly report/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return "finance";

 

 

 

  }

 

 

 

 

 

 

 

  if (
  /operations|operational|field|county|parish|task|workspace|readiness|execution|command center/.test(
    lower
  )
) {
  return "operations";
}

 

 

 

 

 

 

 

  if (

 

 

 

    /deadline|ballot access|election administration|voting system|court ruling|election law/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return "administration";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    /legislat|bill|committee hearing|congress\.gov|congressional action/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return "legislative";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    /weather|storm|rain|heat|snow|field risk|temperature/.test(

 

 

 

      lower

 

 

 

    )

 

 


 

  ) {

 

 

 

    return "weather";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    context.candidate &&

 

 

 

    /everything|complete briefing|full briefing|candidate briefing|complete assessment|full assessment|all intelligence|all data|what should i know|tell me everything|strategy|strategies|strategic|news|articles/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return "candidate_intelligence";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    /candidate|campaign|profile|biograph|tell me about|who is/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return context.candidate

 

 

 

      ? "candidate_intelligence"

 

 

 

      : "candidate";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    /race|election|political|statewide|district|contest/.test(

 

 

 

      lower

 

 

 

    )

 

 

 

  ) {

 

 

 

    return "race_overview";

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    context.candidate

 

 

 

  ) {

 

 

 

    return "candidate";

 

 

 

  }

 

 

 

 

 

 

 

  return "executive_overview";

 

 

 

}

 

 

 

 

 

 

 

function resolveContext(

 

 

 

  payload = {}

 

 

 

) {

 

 

 

  const question =

 

 

 

    clean(

 

 

 

      payload.question ||

 

 

 

      payload.query ||

 

 

 

      payload.prompt

 

 

 

    );

 

 

 

 

 

 


 

  const context = {

 

 

 

    question,

 

 

 

 

 

 

 

    state:

 

 

 

      detectState(

 

 

 

        question,

 

 

 

        payload.state

 

 

 

      ),

 

 

 

 

 

 

 

    office:

 

 

 

      detectOffice(

 

 

 

        question,

 

 

 

        payload.office

 

 

 

      ),

 

 

 

 

 

 

 

    candidate:

 

 

 

      detectCandidate(

 

 

 

        question,

 

 

 

        payload.candidate

 

 

 

      ),

 

 

 

 

 

 

 

    cycle:

 

 

 

      detectCycle(

 

 

 

        question,

 

 

 

        payload.cycle

 

 

 

      ),

 

 

 

 

 

 

 

    locality:

 

 

 

      clean(

 

 

 

        payload.locality

 

 

 

      ),

 

 

 

 

 

 

 

    candidate_id:

 

 

 

      clean(

 

 

 

        payload.candidate_id ||

 

 

 

        payload.fec_candidate_id

 

 

 

      ),

 

 

 

 

 

 

 

    committee_id:

 

 

 

      clean(

 

 

 

        payload.committee_id

 

 

 

      ),

 

 

 

 

 

 

 

    latitude:

 

 

 

      payload.latitude,

 

 

 

 

 

 

 

    longitude:

 

 

 

      payload.longitude,

 

 

 

  };

 

 

 

 

 

 


 

  context.state_name =

 

 

 

    STATE_NAMES[

 

 

 

      context.state

 

 

 

    ] ||

 

 

 

    null;

 

 

 

 

 

 

 

  context.intent =

 

 

 

    classifyIntent(

 

 

 

      question,

 

 

 

      context

 

 

 

    );

 

 

 

 

 

 

 

  return context;

 

 

 

}

 

 

 

 

 

 

 

function makeCall(

 

 

 

  name,

 

 

 

  args,

 

 

 

  reason,

 

 

 

  priority = 50

 

 

 

) {

 

 

 

  return {

 

 

 

    name,

 

 

 

    arguments:

 

 

 

      args,

 

 

 

    reason,

 

 

 

    priority,

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

function buildToolPlan({

 

 

 

  question,

 

 

 

  context,

 

 

 

  workspaceId,

 

 

 

  limit,

 

 

 

}) {

 

 

 

  const calls = [];

 

 

 

 

 

 

 

  const common = {

 

 

 

    query:

 

 

 

      question,

 

 

 

 

 

 

 

    state:

 

 

 

      context.state,

 

 

 

 

 

 

 

    office:

 

 

 

      context.office,

 

 

 

 

 

 

 

    locality:

 

 

 

      context.locality,

 

 


 

 

 

 

 

    cycle:

 

 

 

      context.cycle,

 

 

 

 

 

 

 

    limit,

 

 

 

 

 

 

 

    workspace_id:

 

 

 

      workspaceId,

 

 

 

  };

 

 

 

 

 

 

 

  if (

 

 

 

    context.intent ===

 

 

 

    "polling"

 

 

 

  ) {

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_latest_polling",

 

 

 

        {

 

 

 

          candidate:

 

 

 

            context.candidate,

 

 

 

 

 

 

 

          state:

 

 

 

            context.state,

 

 

 

 

 

 

 

          office:

 

 

 

            context.office,

 

 

 

 

 

 

 

          locality:

 

 

 

            context.locality,

 

 

 

 

 

 

 

          limit,

 

 

 

        },

 

 

 

        "Retrieve polling directly relevant to the question.",

 

 

 

        100

 

 

 

      )

 

 

 

    );

 

 

 

 

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "search_live_news",

 

 

 

        {

 

 

 

          query:

 

 

 

            question,

 

 

 

 

 

 

 

          state:

 

 

 

            context.state,

 

 

 

 

 

 

 

          locality:

 

 

 

            context.locality,

 

 

 

 

 

 


 

          limit,

 

 

 

        },

 

 

 

        "Check current reporting for corroborating polling coverage.",

 

 

 

        82

 

 

 

      )

 

 

 

    );

 

 

 

  } else if (

 

 

 

    context.intent ===

 

 

 

    "finance"

 

 

 

  ) {

 

 

 

    /*

 

 

 

     * Finance identity resolution is intentionally isolated from

 

 

 

     * get_candidate_live_intelligence because that composite tool can

 

 

 

     * include polling/news providers. A pure FEC question must never

 

 

 

     * acquire VoteHub/polling evidence while resolving candidate identity.

 

 

 

     */

 

 

 

    if (

 

 

 

      context.candidate ||

 

 

 

      context.candidate_id ||

 

 

 

      context.state

 

 

 

    ) {

 

 

 

      calls.push(

 

 

 

        makeCall(

 

 

 

          "get_candidate_statistics",

 

 

 

          {

 

 

 

            candidate:

 

 

 

              context.candidate,

 

 

 

 

 

 

 

            candidate_id:

 

 

 

              context.candidate_id,

 

 

 

 

 

 

 

            state:

 

 

 

              context.state,

 

 

 

 

 

 

 

            office:

 

 

 

              context.office,

 

 

 

 

 

 

 

            cycle:

 

 

 

              context.cycle,

 

 

 

          },

 

 

 

          "Resolve candidate identity from the VoterSpheres candidate database only.",

 

 

 

          100

 

 

 

        )

 

 

 

      );

 

 

 

    }

 

 

 

 

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_fec_finance",

 

 

 

        {

 

 


 

          candidate:

 

 

 

            context.candidate,

 

 

 

 

 

 

 

          candidate_id:

 

 

 

            context.candidate_id,

 

 

 

 

 

 

 

          committee_id:

 

 

 

            context.committee_id,

 

 

 

 

 

 

 

          cycle:

 

 

 

            context.cycle,

 

 

 

        },

 

 

 

        "Retrieve official FEC finance evidence only after strict candidate identity validation.",

 

 

 

        98

 

 

 

      )

 

 

 

    );

 

 

 

  } else if (

 

 

 

    context.intent ===

 

 

 

      "candidate_intelligence" ||

 

 

 

    context.intent ===

 

 

 

      "candidate"

 

 

 

  ) {

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_candidate_intelligence_bundle",

 

 

 

        {

 

 

 

          candidate:

 

 

 

            context.candidate,

 

 

 

 

 

 

 

          candidate_id:

 

 

 

            context.candidate_id,

 

 

 

 

 

 

 

          state:

 

 

 

            context.state,

 

 

 

 

 

 

 

          office:

 

 

 

            context.office,

 

 

 

 

 

 

 

          locality:

 

 

 

            context.locality,

 

 

 

 

 

 

 

          cycle:

 

 

 

            context.cycle,

 

 

 

 

 

 

 

          workspace_id:

 

 

 

            workspaceId,

 

 

 

 

 

 

 

          limit,

 

 

 

        },

 

 

 

        "Build a verified candidate intelligence bundle across profile, official FEC finance, polling, current news, political signals, strategy recommendations, and executive operating context.",

 

 


 

        100

 

 

 

      )

 

 

 

    );

 

 

 

 
    } else if (
  context.intent ===
  "operations"
) {
  if (
    context.state
  ) {
    calls.push(
      makeCall(
        "get_state_operations",
        {
          state:
            context.state,

          locality:
            context.locality,

          workspace_id:
            workspaceId,
        },
        "Load state operational intelligence.",
        100
      )
    );
  }

  calls.push(
    makeCall(
      "get_unified_executive_intelligence",
      common,
      "Load executive operational context.",
      94
    )
  );
 

 

  } else if (

 

 

 

    context.intent ===

 

 

 

    "administration"

 

 

 

  ) {

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_election_administration_updates",

 

 

 

        {

 

 

 

          query:

 

 

 

            question,

 

 

 

 

 

 

 

          state:

 

 

 

            context.state,

 

 

 

 

 

 

 

          locality:

 

 

 

            context.locality,

 

 

 

 

 

 

 

          limit,

 

 

 

        },

 

 

 

        "Retrieve election administration intelligence.",

 

 

 

        100

 

 

 

      )

 

 

 

    );

 

 

 

 

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "search_live_news",

 

 

 

        {

 

 

 

          query:

 

 

 

            question,

 

 

 

 

 

 

 

          state:

 

 

 

            context.state,

 

 

 

 

 

 

 

          locality:

 

 

 

            context.locality,

 

 

 

 

 

 

 

          limit,

 

 

 

        },

 

 

 

        "Find corroborating current reporting.",

 

 

 

        88

 

 

 

      )

 

 


 

    );

 

 

 

  } else if (

 

 

 

    context.intent ===

 

 

 

    "legislative"

 

 

 

  ) {

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_legislative_updates",

 

 

 

        {

 

 

 

          query:

 

 

 

            question,

 

 

 

          limit,

 

 

 

        },

 

 

 

        "Retrieve official legislative evidence.",

 

 

 

        100

 

 

 

      )

 

 

 

    );

 

 

 

  } else if (

 

 

 

    context.intent ===

 

 

 

      "weather" &&

 

 

 

    context.latitude != null &&

 

 

 

    context.longitude != null

 

 

 

  ) {

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_weather_field_risk",

 

 

 

        {

 

 

 

          latitude:

 

 

 

            context.latitude,

 

 

 

 

 

 

 

          longitude:

 

 

 

            context.longitude,

 

 

 

 

 

 

 

          location:

 

 

 

            context.locality ||

 

 

 

            context.state_name,

 

 

 

        },

 

 

 

        "Retrieve field weather risk.",

 

 

 

        100

 

 

 

      )

 

 

 

    );

 

 

 

  } else if (
  context.intent ===
  "candidate_intelligence"
) {
  calls.push(
    makeCall(
      "get_candidate_intelligence_bundle",
      {
        candidate:
          context.candidate,

        candidate_id:
          context.candidate_id,

        committee_id:
          context.committee_id,

        state:
          context.state,

        office:
          context.office,

        locality:
          context.locality,

        cycle:
          context.cycle,

        workspace_id:
          workspaceId,

        limit,
      },
      "Build a verified candidate intelligence bundle across profile, official FEC finance, polling, current news, political signals, strategy recommendations, and executive operating context.",
      100
    )
  );

} else {

  if (
    context.state
  ) {

 

 

 

      calls.push(

 

 

 

        makeCall(

 

 

 

          "get_state_operations",

 


 

 

          {

 

 

 

            state:

 

 

 

              context.state,

 

 

 

 

 

 

 

            locality:

 

 

 

              context.locality,

 

 

 

 

 

 

 

            workspace_id:

 

 

 

              workspaceId,

 

 

 

          },

 

 

 

          "Load state intelligence context.",

 

 

 

          92

 

 

 

        )

 

 

 

      );

 

 

 

    }

 

 

 

 

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "search_live_news",

 

 

 

        {

 

 

 

          query:

 

 

 

            question,

 

 

 

 

 

 

 

          state:

 

 

 

            context.state,

 

 

 

 

 

 

 

          locality:

 

 

 

            context.locality,

 

 

 

 

 

 

 

          limit,

 

 

 

        },

 

 

 

        "Retrieve current political reporting.",

 

 

 

        90

 

 

 

      )

 

 

 

    );

 

 

 

 

 

 

 

    calls.push(

 

 

 

      makeCall(

 

 

 

        "get_unified_executive_intelligence",

 

 

 

        common,

 

 

 

        "Load the broader VoterSpheres executive picture.",

 

 

 

        82

 

 

 

      )

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  return [

 

 

 

    ...new Map(

 

 

 

      calls.map(

 

 

 

        (call) => [

 


 

 

          `${call.name}:${JSON.stringify(

 

 

 

            call.arguments

 

 

 

          )}`,

 

 

 

          call,

 

 

 

        ]

 

 

 

      )

 

 

 

    ).values(),

 

 

 

  ]

 

 

 

    .sort(

 

 

 

      (a, b) =>

 

 

 

        b.priority -

 

 

 

        a.priority

 

 

 

    )

 

 

 

    .slice(

 

 

 

      0,

 

 

 

      clamp(

 

 

 

        MAX_TOOLS,

 

 

 

        9,

 

 

 

        1,

 

 

 

        12

 

 

 

      )

 

 

 

    );

 

 

 

}

 

 

 

 

 

 

 

function countItems(

 

 

 

  value,

 

 

 

  depth = 0

 

 

 

) {

 

 

 

  if (

 

 

 

    value == null ||

 

 

 

    depth > 5

 

 

 

  ) {

 

 

 

    return 0;

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(value)

 

 

 

  ) {

 

 

 

    return value.reduce(

 

 

 

      (

 

 

 

        sum,

 

 

 

        item

 

 

 

      ) =>

 

 

 

        sum +

 

 

 

        (

 

 

 

          typeof item ===

 

 

 

          "object"

 

 

 

            ? countItems(

 

 

 

                item,

 

 

 

                depth + 1

 


 

 

              )

 

 

 

            : 1

 

 

 

        ),

 

 

 

      0

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    typeof value !==

 

 

 

    "object"

 

 

 

  ) {

 

 

 

    return clean(value)

 

 

 

      ? 1

 

 

 

      : 0;

 

 

 

  }

 

 

 

 

 

 

 

  return Object.values(

 

 

 

    value

 

 

 

  ).reduce(

 

 

 

    (

 

 

 

      sum,

 

 

 

      child

 

 

 

    ) =>

 

 

 

      sum +

 

 

 

      countItems(

 

 

 

        child,

 

 

 

        depth + 1

 

 

 

      ),

 

 

 

    0

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function normalizeToolResult(

 

 

 

  call,

 

 

 

  result,

 

 

 

  latencyMs

 

 

 

) {

 

 

 

  const value =

 

 

 

    result &&

 

 

 

    typeof result ===

 

 

 

      "object"

 

 

 

      ? result

 

 

 

      : {};

 

 

 

 

 

 

 

  const sources =

 

 

 

    Array.isArray(

 

 

 

      value.sources

 

 

 

    )

 

 

 

      ? value.sources

 

 

 

      : [];

 


 

 

 

 

 

 

  const normalizedData =

 

 

 

    call.name ===

 

      "get_candidate_intelligence_bundle" &&

 

    !value.data &&

 

    (

 

      value.identities ||

 

      value.profile ||

 

      value.finance ||

 

      value.polling ||

 

      value.news ||

 

      value.strategy

 

    )

 

      ? {

 

          identities: value.identities || [],

 

          profile: value.profile || null,

 

          finance: value.finance || null,

 

          polling: value.polling || null,

 

          news: value.news || null,

 

          signals: value.signals || [],

 

          strategy: value.strategy || null,

 

          operations: value.operations || null,

 

          coverage: value.coverage || null,

 

          sources: value.sources || [],

 

          warnings: value.warnings || [],

 

          diagnostics: value.diagnostics || [],

 

          generated_at: value.generated_at || null,

 

        }

 

      : value.data;

 

 

 

  const meaningful_item_count =

 

 

 

    countItems(

 

 

 

      normalizedData

 

 

 

    );

 

 

 

 

 

 

 

  const usable =

 

 

 

    Boolean(

 

 

 

      value.ok &&

 

 

 

      (

 

 

 

        meaningful_item_count >

 

 

 

          0 ||

 

 

 

        sources.length >

 

 

 

          0

 

 

 

      )

 

 

 

    );

 

 

 

 

 

 

 

  return {

 

 

 

    tool:

 

 

 

      call.name,

 

 

 

 

 

 

 

    reason:

 

 

 

      call.reason,

 

 

 

 

 

 

 

    arguments:

 

 

 

      call.arguments,

 

 

 

 

 

 

 

    ok:

 

 

 

      Boolean(

 

 

 

        value.ok

 

 

 

      ),

 

 

 

 

 

 

 

    usable,

 

 

 

 

 

 

 

    degraded:

 


 

 

      Boolean(

 

 

 

        value.degraded

 

 

 

      ),

 

 

 

 

 

 

 

    summary:

 

 

 

      clean(

 

 

 

        value.summary

 

 

 

      ),

 

 

 

 

 

 

 

    data:

 

 

 

      normalizedData ??

 

 

 

      null,

 

 

 

 

 

 

 

    sources,

 

 

 

 

 

 

 

    warnings:

 

 

 

      Array.isArray(

 

 

 

        value.warnings

 

 

 

      )

 

 

 

        ? value.warnings.filter(

 

 

 

            Boolean

 

 

 

          )

 

 

 

        : [],

 

 

 

 

 

 

 

    diagnostics:

 

 

 

      Array.isArray(

 

 

 

        value.diagnostics

 

 

 

      )

 

 

 

        ? value.diagnostics

 

 

 

        : [],

 

 

 

 

 

 

 

    generated_at:

 

 

 

      value.generated_at ||

 

 

 

      value.fetched_at ||

 

 

 

      null,

 

 

 

 

 

 

 

    latency_ms:

 

 

 

      latencyMs,

 

 

 

 

 

 

 

    meaningful_item_count,

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

async function executePlannedTool(

 

 

 

  call,

 

 

 

  user

 

 

 

) {

 

 

 

  const started =

 

 

 

    Date.now();

 

 

 

 

 


 

 

  try {

 

 

 

    const operation =

 

 

 

      call.name ===

 

 

 

      "get_candidate_intelligence_bundle"

 

 

 

        ? getCandidateIntelligenceBundle({

 

 

 

            candidate:

 

 

 

              call.arguments?.candidate,

 

 

 

 

 

 

 

            candidateId:

 

 

 

              call.arguments?.candidate_id,

 

 

 

 

 

 

 

            state:

 

 

 

              call.arguments?.state,

 

 

 

 

 

 

 

            office:

 

 

 

              call.arguments?.office,

 

 

 

 

 

 

 

            cycle:

 

 

 

              call.arguments?.cycle,

 

 

 

 

 

 

 

            locality:

 

 

 

              call.arguments?.locality,

 

 

 

 

 

 

 

            workspaceId:

 

 

 

              call.arguments?.workspace_id ||

 

 

 

              1,

 

 

 

 

 

 

 

            limit:

 

 

 

              call.arguments?.limit ||

 

 

 

              12,

 

 

 

 

 

 

 

            user,

 

 

 

          })

 

 

 

        : executeExecutiveVoiceTool(

 

 

 

            {

 

 

 

              name:

 

 

 

                call.name,

 

 

 

 

 

 

 

              arguments:

 

 

 

                call.arguments,

 

 

 

 

 

 

 

              user,

 

 

 

            }

 

 

 

          );

 

 

 

 

 

 

 

    const output =

 

 

 

      await withTimeout(

 

 

 

        operation,

 

 

 

        call.name ===

 

 

 

          "get_candidate_intelligence_bundle"

 


 

 

          ? ORCHESTRATOR_TIMEOUT_MS

 

 

 

          : TOOL_TIMEOUT_MS,

 

 

 

        call.name

 

 

 

      );

 

 

 

 

 

 

 

    return normalizeToolResult(

 

 

 

      call,

 

 

 

      output,

 

 

 

      Date.now() -

 

 

 

        started

 

 

 

    );

 

 

 

  } catch (error) {

 

 

 

    return {

 

 

 

      tool:

 

 

 

        call.name,

 

 

 

 

 

 

 

      reason:

 

 

 

        call.reason,

 

 

 

 

 

 

 

      arguments:

 

 

 

        call.arguments,

 

 

 

 

 

 

 

      ok:

 

 

 

        false,

 

 

 

 

 

 

 

      usable:

 

 

 

        false,

 

 

 

 

 

 

 

      degraded:

 

 

 

        true,

 

 

 

 

 

 

 

      summary:

 

 

 

        `${call.name} failed.`,

 

 

 

 

 

 

 

      data:

 

 

 

        null,

 

 

 

 

 

 

 

      sources:

 

 

 

        [],

 

 

 

 

 

 

 

      warnings: [

 

 

 

        error?.message ||

 

 

 

        "Unknown tool failure.",

 

 

 

      ],

 

 

 

 

 

 

 

      diagnostics: [

 

 

 

        {

 

 

 

          provider:

 

 

 

            call.name,

 

 

 

 

 


 

 

          ok:

 

 

 

            false,

 

 

 

 

 

 

 

          error:

 

 

 

            error?.message ||

 

 

 

            "Unknown tool failure.",

 

 

 

 

 

 

 

          latency_ms:

 

 

 

            Date.now() -

 

 

 

            started,

 

 

 

 

 

 

 

          checked_at:

 

 

 

            now(),

 

 

 

        },

 

 

 

      ],

 

 

 

 

 

 

 

      generated_at:

 

 

 

        null,

 

 

 

 

 

 

 

      latency_ms:

 

 

 

        Date.now() -

 

 

 

        started,

 

 

 

 

 

 

 

      meaningful_item_count:

 

 

 

        0,

 

 

 

    };

 

 

 

  }

 

 

 

}

 

 

 

 

 

 

 

function mergeSources(

 

 

 

  results

 

 

 

) {

 

 

 

  const map =

 

 

 

    new Map();

 

 

 

 

 

 

 

  for (

 

 

 

    const result

 

 

 

    of results

 

 

 

  ) {

 

 

 

    for (

 

 

 

      const source

 

 

 

      of result.sources

 

 

 

    ) {

 

 

 

      const key =

 

 

 

        clean(

 

 

 

          source?.url ||

 

 

 

          source?.source_url ||

 

 

 

          source?.source ||

 

 

 

          source?.name ||

 

 

 

          source?.provider

 


 

 

        ).toLowerCase() ||

 

 

 

        `${result.tool}:${map.size}`;

 

 

 

 

 

 

 

      if (

 

 

 

        !map.has(key)

 

 

 

      ) {

 

 

 

        map.set(

 

 

 

          key,

 

 

 

          {

 

 

 

            ...source,

 

 

 

            tool:

 

 

 

              result.tool,

 

 

 

          }

 

 

 

        );

 

 

 

      }

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  return [

 

 

 

    ...map.values(),

 

 

 

  ];

 

 

 

}

 

 

 

 

 

 

 

function buildCoverage(

 

 

 

  results,

 

 

 

  sources

 

 

 

) {

 

 

 

  const attempted =

 

 

 

    results.length;

 

 

 

 

 

 

 

  const successful =

 

 

 

    results.filter(

 

 

 

      (item) =>

 

 

 

        item.ok

 

 

 

    ).length;

 

 

 

 

 

 

 

  const useful =

 

 

 

    results.filter(

 

 

 

      (item) =>

 

 

 

        item.usable

 

 

 

    ).length;

 

 

 

 

 

 

 

  const degraded =

 

 

 

    results.filter(

 

 

 

      (item) =>

 

 

 

        item.degraded

 

 

 

    ).length;

 

 

 

 

 

 

 

  const currentEvidence =

 

 

 

    sources.filter(

 


 

 

      (source) =>

 

 

 

        source.published_at ||

 

 

 

        source.reporting_period ||

 

 

 

        source.freshness

 

 

 

    ).length;

 

 

 

 

 

 

 

  const score =

 

 

 

    attempted

 

 

 

      ? Math.round(

 

 

 

          (

 

 

 

            useful /

 

 

 

            attempted

 

 

 

          ) *

 

 

 

            65 +

 

 

 

          Math.min(

 

 

 

            25,

 

 

 

            sources.length *

 

 

 

              3

 

 

 

          ) +

 

 

 

          Math.min(

 

 

 

            10,

 

 

 

            currentEvidence *

 

 

 

              2

 

 

 

          )

 

 

 

        )

 

 

 

      : 0;

 

 

 

 

 

 

 

  return {

 

 

 

    attempted_tools:

 

 

 

      attempted,

 

 

 

 

 

 

 

    successful_tools:

 

 

 

      successful,

 

 

 

 

 

 

 

    useful_tools:

 

 

 

      useful,

 

 

 

 

 

 

 

    degraded_tools:

 

 

 

      degraded,

 

 

 

 

 

 

 

    source_count:

 

 

 

      sources.length,

 

 

 

 

 

 

 

    dated_source_count:

 

 

 

      currentEvidence,

 

 

 

 

 

 

 

    coverage_score:

 

 

 

      Math.min(

 

 

 

        100,

 

 

 

        score

 


 

 

      ),

 

 

 

 

 

 

 

    evidence_status:

 

 

 

      useful > 0

 

 

 

        ? degraded

 

 

 

          ? "partial"

 

 

 

          : "live"

 

 

 

        : "unavailable",

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

function calculateConfidence(

 

 

 

  coverage

 

 

 

) {

 

 

 

  if (

 

 

 

    !coverage.useful_tools

 

 

 

  ) {

 

 

 

    return 0;

 

 

 

  }

 

 

 

 

 

 

 

  return Math.min(

 

 

 

    100,

 

 

 

    Math.round(

 

 

 

      coverage.coverage_score *

 

 

 

        0.7 +

 

 

 

      Math.min(

 

 

 

        30,

 

 

 

        coverage.source_count *

 

 

 

          4

 

 

 

      )

 

 

 

    )

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function findToolResult(

 

 

 

  results,

 

 

 

  tool

 

 

 

) {

 

 

 

  return (

 

 

 

    results.find(

 

 

 

      (item) =>

 

 

 

        item.tool === tool

 

 

 

    ) ||

 

 

 

    null

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function firstObject(

 

 

 

  values = []

 

 

 

) {

 


 

 

  for (

 

 

 

    const value

 

 

 

    of values

 

 

 

  ) {

 

 

 

    if (

 

 

 

      value &&

 

 

 

      typeof value ===

 

 

 

        "object" &&

 

 

 

      !Array.isArray(

 

 

 

        value

 

 

 

      )

 

 

 

    ) {

 

 

 

      return value;

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  return null;

 

 

 

}

 

 

 

 

 

 

 

function firstArray(

 

 

 

  values = []

 

 

 

) {

 

 

 

  for (

 

 

 

    const value

 

 

 

    of values

 

 

 

  ) {

 

 

 

    if (

 

 

 

      Array.isArray(value) &&

 

 

 

      value.length

 

 

 

    ) {

 

 

 

      return value;

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  return [];

 

 

 

}

 

 

 

 

 

 

 

function extractCandidateRecord(

 

 

 

  result

 

 

 

) {

 

 

 

  const data =

 

 

 

    result?.data;

 

 

 

 

 

 

 

  if (!data) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  const arrays = [

 

 

 

    data.records,

 

 

 

    data.candidates,

 


 

 

    data.results,

 

 

 

    data.candidate_records,

 

 

 

    data.matches,

 

 

 

  ];

 

 

 

 

 

 

 

  const rows =

 

 

 

    firstArray(arrays);

 

 

 

 

 

 

 

  if (

 

 

 

    rows.length

 

 

 

  ) {

 

 

 

    return rows[0];

 

 

 

  }

 

 

 

 

 

 

 

  return firstObject([

 

 

 

    data.candidate,

 

 

 

    data.profile,

 

 

 

    data.record,

 

 

 

  ]);

 

 

 

}

 

 

 

 

 

 

 

function candidateIdFromObject(

 

 

 

  value

 

 

 

) {

 

 

 

  if (

 

 

 

    !value ||

 

 

 

    typeof value !==

 

 

 

      "object"

 

 

 

  ) {

 

 

 

    return "";

 

 

 

  }

 

 

 

 

 

 

 

  return clean(

 

 

 

    value.fec_candidate_id ||

 

 

 

    value.candidate_id ||

 

 

 

    value.fecCandidateId ||

 

 

 

    value.external_id

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function committeeIdFromObject(

 

 

 

  value

 

 

 

) {

 

 

 

  if (

 

 

 

    !value ||

 

 

 

    typeof value !==

 

 

 

      "object"

 

 

 

  ) {

 

 

 

    return "";

 

 

 

  }

 


 

 

 

 

 

 

  return clean(

 

 

 

    value.campaign_committee_id ||

 

 

 

    value.committee_id ||

 

 

 

    value.principal_committee_id ||

 

 

 

    value.committeeId

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function candidateNameFromObject(

 

 

 

  value

 

 

 

) {

 

 

 

  if (

 

 

 

    !value ||

 

 

 

    typeof value !==

 

 

 

      "object"

 

 

 

  ) {

 

 

 

    return "";

 

 

 

  }

 

 

 

 

 

 

 

  return clean(

 

 

 

    value.full_name ||

 

 

 

    value.name ||

 

 

 

    value.candidate_name

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function recursivelyFindIdentity(

 

 

 

  value,

 

 

 

  depth = 0

 

 

 

) {

 

 

 

  if (

 

 

 

    value == null ||

 

 

 

    depth > 6

 

 

 

  ) {

 

 

 

    return {

 

 

 

      candidate_id:

 

 

 

        "",

 

 

 

      committee_id:

 

 

 

        "",

 

 

 

      candidate:

 

 

 

        "",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(value)

 

 

 

  ) {

 

 

 

    for (

 

 

 

      const child

 


 

 

      of value

 

 

 

    ) {

 

 

 

      const found =

 

 

 

        recursivelyFindIdentity(

 

 

 

          child,

 

 

 

          depth + 1

 

 

 

        );

 

 

 

 

 

 

 

      if (

 

 

 

        found.candidate_id ||

 

 

 

        found.committee_id

 

 

 

      ) {

 

 

 

        return found;

 

 

 

      }

 

 

 

    }

 

 

 

 

 

 

 

    return {

 

 

 

      candidate_id:

 

 

 

        "",

 

 

 

      committee_id:

 

 

 

        "",

 

 

 

      candidate:

 

 

 

        "",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    typeof value !==

 

 

 

    "object"

 

 

 

  ) {

 

 

 

    return {

 

 

 

      candidate_id:

 

 

 

        "",

 

 

 

      committee_id:

 

 

 

        "",

 

 

 

      candidate:

 

 

 

        "",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  const direct = {

 

 

 

    candidate_id:

 

 

 

      candidateIdFromObject(

 

 

 

        value

 

 

 

      ),

 

 

 

 

 

 

 

    committee_id:

 

 

 

      committeeIdFromObject(

 

 

 

        value

 

 

 

      ),

 


 

 

 

 

 

 

    candidate:

 

 

 

      candidateNameFromObject(

 

 

 

        value

 

 

 

      ),

 

 

 

  };

 

 

 

 

 

 

 

  if (

 

 

 

    direct.candidate_id ||

 

 

 

    direct.committee_id

 

 

 

  ) {

 

 

 

    return direct;

 

 

 

  }

 

 

 

 

 

 

 

  for (

 

 

 

    const child

 

 

 

    of Object.values(

 

 

 

      value

 

 

 

    )

 

 

 

  ) {

 

 

 

    const found =

 

 

 

      recursivelyFindIdentity(

 

 

 

        child,

 

 

 

        depth + 1

 

 

 

      );

 

 

 

 

 

 

 

    if (

 

 

 

      found.candidate_id ||

 

 

 

      found.committee_id

 

 

 

    ) {

 

 

 

      return {

 

 

 

        candidate_id:

 

 

 

          found.candidate_id,

 

 

 

 

 

 

 

        committee_id:

 

 

 

          found.committee_id,

 

 

 

 

 

 

 

        candidate:

 

 

 

          found.candidate ||

 

 

 

          direct.candidate,

 

 

 

      };

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  return direct;

 

 

 

}

 

 

 

 

 

 

 

function normalizePersonTokens(value = "") {

 

 

 

  return clean(value)

 

 

 

    .toLowerCase()

 


 

 

    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, " ")

 

 

 

    .replace(/[^a-z0-9]+/g, " ")

 

 

 

    .split(/\s+/)

 

 

 

    .map((token) => token.trim())

 

 

 

    .filter(Boolean);

 

 

 

}

 

 

 

 

 

 

 

function candidateNamesMatch(

 

 

 

  requestedName,

 

 

 

  candidateName

 

 

 

) {

 

 

 

  const requested = normalizePersonTokens(

 

 

 

    requestedName

 

 

 

  );

 

 

 

 

 

 

 

  const candidate = normalizePersonTokens(

 

 

 

    candidateName

 

 

 

  );

 

 

 

 

 

 

 

  if (

 

 

 

    !requested.length ||

 

 

 

    !candidate.length

 

 

 

  ) {

 

 

 

    return false;

 

 

 

  }

 

 

 

 

 

 

 

  /*

 

 

 

   * A one-token request such as "Crockett" is treated as a surname

 

 

 

   * request and must match a complete token in the stored candidate name.

 

 

 

   */

 

 

 

  if (requested.length === 1) {

 

 

 

    return candidate.includes(

 

 

 

      requested[0]

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  /*

 

 

 

   * For full names, every requested name token must exist in the

 

 

 

   * candidate record. This handles both "Jasmine Crockett" and

 

 

 

   * database forms such as "CROCKETT, JASMINE" without accepting an

 

 

 

   * unrelated candidate merely because an ID was present in the result.

 

 

 

   */

 

 

 

  return requested.every(

 

 

 

    (token) =>

 

 

 

      candidate.includes(token)

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function normalizeOffice(value = "") {

 

 

 

  const lower = clean(value)

 


 

 

    .toLowerCase()

 

 

 

    .replace(/[^a-z0-9]+/g, " ")

 

 

 

    .trim();

 

 

 

 

 

 

 

  if (/\bhouse\b|congress/.test(lower)) {

 

 

 

    return "house";

 

 

 

  }

 

 

 

 

 

 

 

  if (/\bsenate\b|senator/.test(lower)) {

 

 

 

    return "senate";

 

 

 

  }

 

 

 

 

 

 

 

  if (/president/.test(lower)) {

 

 

 

    return "president";

 

 

 

  }

 

 

 

 

 

 

 

  if (/governor/.test(lower)) {

 

 

 

    return "governor";

 

 

 

  }

 

 

 

 

 

 

 

  return lower;

 

 

 

}

 

 

 

 

 

 

 

function candidateRecordState(record = {}) {

 

 

 

  return clean(

 

 

 

    record.state_code ||

 

 

 

    record.state

 

 

 

  ).toUpperCase();

 

 

 

}

 

 

 

 

 

 

 

function candidateRecordOffice(record = {}) {

 

 

 

  return normalizeOffice(

 

 

 

    record.office ||

 

 

 

    record.office_full ||

 

 

 

    record.office_name

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function collectCandidateRecordsFromResult(result) {

 

 

 

  const data = result?.data;

 

 

 

 

 

 

 

  if (!data) {

 

 

 

    return [];

 

 

 

  }

 

 

 

 

 

 

 

  const buckets = [

 

 

 

    data.records,

 

 

 

    data.candidates,

 

 

 

    data.results,

 

 

 

    data.candidate_records,

 


 

 

    data.matches,

 

 

 

  ];

 

 

 

 

 

 

 

  const rows = buckets.find(

 

 

 

    (bucket) => Array.isArray(bucket)

 

 

 

  );

 

 

 

 

 

 

 

  if (Array.isArray(rows)) {

 

 

 

    return rows.filter(

 

 

 

      (row) =>

 

 

 

        row &&

 

 

 

        typeof row === "object"

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  const direct = firstObject([

 

 

 

    data.candidate,

 

 

 

    data.profile,

 

 

 

    data.record,

 

 

 

  ]);

 

 

 

 

 

 

 

  return direct ? [direct] : [];

 

 

 

}

 

 

 

 

 

 

 

function strictResolveCandidateIdentity(

 

 

 

  results,

 

 

 

  context

 

 

 

) {

 

 

 

  const requestedName = clean(

 

 

 

    context.candidate

 

 

 

  );

 

 

 

 

 

 

 

  const explicitCandidateId = clean(

 

 

 

    context.candidate_id

 

 

 

  );

 

 

 

 

 

 

 

  const explicitCommitteeId = clean(

 

 

 

    context.committee_id

 

 

 

  );

 

 

 

 

 

 

 

  /*

 

 

 

   * An explicitly supplied FEC candidate ID is deterministic.

 

 

 

   */

 

 

 

  if (explicitCandidateId) {

 

 

 

    const identity = {

 

 

 

      candidate:

 

 

 

        requestedName || null,

 

 

 

      candidate_id:

 

 

 

        explicitCandidateId,

 

 

 

      committee_id:

 


 

 

        explicitCommitteeId || null,

 

 

 

      state:

 

 

 

        context.state || null,

 

 

 

      office:

 

 

 

        context.office || null,

 

 

 

      district:

 

 

 

        null,

 

 

 

      record:

 

 

 

        null,

 

 

 

    };

 

 

 

 

 

 

 

    return {

 

 

 

      ok: true,

 

 

 

      ambiguous: false,

 

 

 

      candidate:

 

 

 

        requestedName || null,

 

 

 

      candidate_id:

 

 

 

        explicitCandidateId,

 

 

 

      committee_id:

 

 

 

        explicitCommitteeId || null,

 

 

 

      record: null,

 

 

 

      matches: [identity],

 

 

 

      identities: [identity],

 

 

 

      reason: "explicit-candidate-id",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  if (!requestedName) {

 

 

 

    return {

 

 

 

      ok: false,

 

 

 

      ambiguous: false,

 

 

 

      candidate: null,

 

 

 

      candidate_id: "",

 

 

 

      committee_id:

 

 

 

        explicitCommitteeId,

 

 

 

      record: null,

 

 

 

      matches: [],

 

 

 

      identities: [],

 

 

 

      reason: "candidate-name-required",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  const statisticsResult = results.find(

 

 

 

    (result) =>

 

 

 

      result.tool ===

 

 

 

      "get_candidate_statistics"

 

 

 

  );

 

 

 

 

 

 

 

  const rows = collectCandidateRecordsFromResult(

 

 

 

    statisticsResult

 


 

 

  );

 

 

 

 

 

 

 

  const requestedState = clean(

 

 

 

    context.state

 

 

 

  ).toUpperCase();

 

 

 

 

 

 

 

  const requestedOffice = normalizeOffice(

 

 

 

    context.office

 

 

 

  );

 

 

 

 

 

 

 

  const matches = rows.filter(

 

 

 

    (record) => {

 

 

 

      const recordName = candidateNameFromObject(

 

 

 

        record

 

 

 

      );

 

 

 

 

 

 

 

      if (

 

 

 

        !candidateNamesMatch(

 

 

 

          requestedName,

 

 

 

          recordName

 

 

 

        )

 

 

 

      ) {

 

 

 

        return false;

 

 

 

      }

 

 

 

 

 

 

 

      if (requestedState) {

 

 

 

        const state = candidateRecordState(

 

 

 

          record

 

 

 

        );

 

 

 

 

 

 

 

        if (

 

 

 

          state &&

 

 

 

          state !== requestedState

 

 

 

        ) {

 

 

 

          return false;

 

 

 

        }

 

 

 

      }

 

 

 

 

 

 

 

      if (requestedOffice) {

 

 

 

        const office = candidateRecordOffice(

 

 

 

          record

 

 

 

        );

 

 

 

 

 

 

 

        if (

 

 

 

          office &&

 

 

 

          office !== requestedOffice

 

 

 

        ) {

 

 

 

          return false;

 

 

 

        }

 

 

 

      }

 


 

 

 

 

 

 

      return Boolean(

 

 

 

        candidateIdFromObject(record) ||

 

 

 

        committeeIdFromObject(record)

 

 

 

      );

 

 

 

    }

 

 

 

  );

 

 

 

 

 

 

 

  if (!matches.length) {

 

 

 

    return {

 

 

 

      ok: false,

 

 

 

      ambiguous: false,

 

 

 

      candidate:

 

 

 

        requestedName,

 

 

 

      candidate_id: "",

 

 

 

      committee_id:

 

 

 

        explicitCommitteeId,

 

 

 

      record: null,

 

 

 

      matches: [],

 

 

 

      identities: [],

 

 

 

      reason: "no-strict-candidate-match",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  /*

 

 

 

   * Deduplicate database rows that point to the same FEC identity.

 

 

 

   */

 

 

 

  const uniqueMatches = [

 

 

 

    ...new Map(

 

 

 

      matches.map((record) => {

 

 

 

        const candidateId = candidateIdFromObject(

 

 

 

          record

 

 

 

        );

 

 

 

 

 

 

 

        const committeeId = committeeIdFromObject(

 

 

 

          record

 

 

 

        );

 

 

 

 

 

 

 

        return [

 

 

 

          `${candidateId}:${committeeId}`,

 

 

 

          record,

 

 

 

        ];

 

 

 

      })

 

 

 

    ).values(),

 

 

 

  ];

 

 

 

 

 

 

 

  const identities = uniqueMatches.map(

 

 

 

    (record) => ({

 

 

 

      candidate:

 

 

 

        candidateNameFromObject(record) ||

 


 

 

        requestedName,

 

 

 

      candidate_id:

 

 

 

        candidateIdFromObject(record),

 

 

 

      committee_id:

 

 

 

        explicitCommitteeId ||

 

 

 

        committeeIdFromObject(record) ||

 

 

 

        null,

 

 

 

      state:

 

 

 

        candidateRecordState(record) ||

 

 

 

        null,

 

 

 

      office:

 

 

 

        record.office ||

 

 

 

        record.office_full ||

 

 

 

        record.office_name ||

 

 

 

        null,

 

 

 

      district:

 

 

 

        record.district || null,

 

 

 

      record,

 

 

 

    })

 

 

 

  );

 

 

 

 

 

 

 

  if (identities.length > 1) {

 

 

 

    /*

 

 

 

     * Multiple exact identities are not treated as an error when the

 

 

 

     * question does not specify an office. They are all valid records

 

 

 

     * for the requested person and will each receive an FEC lookup.

 

 

 

     */

 

 

 

    return {

 

 

 

      ok: true,

 

 

 

      ambiguous: true,

 

 

 

      candidate:

 

 

 

        requestedName,

 

 

 

      candidate_id: "",

 

 

 

      committee_id:

 

 

 

        explicitCommitteeId || null,

 

 

 

      record: null,

 

 

 

      matches:

 

 

 

        identities.map((identity) => ({

 

 

 

          candidate:

 

 

 

            identity.candidate,

 

 

 

          candidate_id:

 

 

 

            identity.candidate_id,

 

 

 

          committee_id:

 

 

 

            identity.committee_id,

 

 

 

          state:

 

 

 

            identity.state,

 

 

 

          office:

 

 

 

            identity.office,

 

 

 

          district:

 

 

 

            identity.district,

 


 

 

        })),

 

 

 

      identities,

 

 

 

      reason: "multiple-verified-candidate-identities",

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  const identity = identities[0];

 

 

 

 

 

 

 

  return {

 

 

 

    ok: true,

 

 

 

    ambiguous: false,

 

 

 

    candidate:

 

 

 

      identity.candidate,

 

 

 

    candidate_id:

 

 

 

      identity.candidate_id,

 

 

 

    committee_id:

 

 

 

      identity.committee_id,

 

 

 

    record:

 

 

 

      identity.record,

 

 

 

    matches:

 

 

 

      identities,

 

 

 

    identities,

 

 

 

    reason: "strict-candidate-match",

 

 

 

  };

 

 

 

}

 

 

 

function createIdentityFailureResult(

 

 

 

  fecTemplate,

 

 

 

  identity,

 

 

 

  context

 

 

 

) {

 

 

 

  const issue = identity.ambiguous

 

 

 

    ? `Multiple FEC candidate identities matched ${context.candidate}. Specify the office or candidate ID before finance data is retrieved.`

 

 

 

    : `No verified FEC candidate identity matched ${context.candidate || "the requested candidate"}. Finance retrieval was stopped to prevent returning another candidate's data.`;

 

 

 

 

 

 

 

  return {

 

 

 

    tool: "get_fec_finance",

 

 

 

    reason:

 

 

 

      fecTemplate?.reason ||

 

 

 

      "Retrieve official FEC finance evidence.",

 

 

 

    arguments:

 

 

 

      fecTemplate?.arguments ||

 

 

 

      {},

 

 

 

    ok: false,

 

 

 

    usable: false,

 

 

 

    degraded: true,

 

 

 

    summary: issue,

 

 

 

    data: {

 

 

 

      identity_resolution: {

 

 

 

        requested_candidate:

 

 

 

          context.candidate || null,

 


 

 

        requested_state:

 

 

 

          context.state || null,

 

 

 

        requested_office:

 

 

 

          context.office || null,

 

 

 

        reason:

 

 

 

          identity.reason,

 

 

 

        matches:

 

 

 

          identity.matches || [],

 

 

 

      },

 

 

 

      records: [],

 

 

 

    },

 

 

 

    sources: [],

 

 

 

    warnings: [issue],

 

 

 

    diagnostics: [

 

 

 

      {

 

 

 

        provider:

 

 

 

          "strict_candidate_identity",

 

 

 

        ok: false,

 

 

 

        error: issue,

 

 

 

        checked_at: now(),

 

 

 

      },

 

 

 

    ],

 

 

 

    generated_at: now(),

 

 

 

    latency_ms: 0,

 

 

 

    meaningful_item_count: 0,

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

async function executeFinancePlan({

 

 

 

  plan,

 

 

 

  user,

 

 

 

}) {

 

 

 

  const results = [];

 

 

 

 

 

 

 

  const statisticsCall = plan.tool_plan.find(

 

 

 

    (call) =>

 

 

 

      call.name ===

 

 

 

      "get_candidate_statistics"

 

 

 

  );

 

 

 

 

 

 

 

  const fecTemplate = plan.tool_plan.find(

 

 

 

    (call) =>

 

 

 

      call.name ===

 

 

 

      "get_fec_finance"

 

 

 

  );

 

 

 

 

 

 

 

  /*

 

 

 

   * Finance requests intentionally DO NOT execute

 

 

 

   * get_candidate_live_intelligence. Candidate identity comes only from

 

 

 

   * the VoterSpheres candidate/statistics database path, so polling/news

 


 

 

   * cannot contaminate an FEC-only request.

 

 

 

   */

 

 

 

  if (statisticsCall) {

 

 

 

    results.push(

 

 

 

      await executePlannedTool(

 

 

 

        statisticsCall,

 

 

 

        user

 

 

 

      )

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  const identity = strictResolveCandidateIdentity(

 

 

 

    results,

 

 

 

    plan.context

 

 

 

  );

 

 

 

 

 

 

 

  if (!fecTemplate) {

 

 

 

    return results;

 

 

 

  }

 

 

 

 

 

 

 

  if (!identity.ok) {

 

 

 

    results.push(

 

 

 

      createIdentityFailureResult(

 

 

 

        fecTemplate,

 

 

 

        identity,

 

 

 

        plan.context

 

 

 

      )

 

 

 

    );

 

 

 

 

 

 

 

    return results;

 

 

 

  }

 

 

 

 

 

 

 

  const identities = Array.isArray(

 

 

 

    identity.identities

 

 

 

  ) && identity.identities.length

 

 

 

    ? identity.identities

 

 

 

    : [

 

 

 

        {

 

 

 

          candidate:

 

 

 

            identity.candidate,

 

 

 

          candidate_id:

 

 

 

            identity.candidate_id,

 

 

 

          committee_id:

 

 

 

            identity.committee_id,

 

 

 

          state:

 

 

 

            plan.context.state || null,

 

 

 

          office:

 

 

 

            plan.context.office || null,

 

 

 

          district:

 

 

 

            null,

 


 

 

          record:

 

 

 

            identity.record || null,

 

 

 

        },

 

 

 

      ];

 

 

 

 

 

 

 

  /*

 

 

 

   * Retrieve every verified identity. We execute sequentially to avoid

 

 

 

   * unnecessary OpenFEC bursts/rate-limit pressure and to keep diagnostics

 

 

 

   * deterministic.

 

 

 

   */

 

 

 

  for (const resolved of identities) {

 

 

 

    if (

 

 

 

      !clean(resolved.candidate_id) &&

 

 

 

      !clean(resolved.committee_id)

 

 

 

    ) {

 

 

 

      continue;

 

 

 

    }

 

 

 

 

 

 

 

    const fecCall = {

 

 

 

      ...fecTemplate,

 

 

 

      arguments: {

 

 

 

        ...fecTemplate.arguments,

 

 

 

        candidate:

 

 

 

          resolved.candidate ||

 

 

 

          plan.context.candidate,

 

 

 

        candidate_id:

 

 

 

          resolved.candidate_id || "",

 

 

 

        committee_id:

 

 

 

          resolved.committee_id ||

 

 

 

          plan.context.committee_id ||

 

 

 

          "",

 

 

 

        cycle:

 

 

 

          plan.context.cycle,

 

 

 

        resolved_state:

 

 

 

          resolved.state ||

 

 

 

          plan.context.state ||

 

 

 

          null,

 

 

 

        resolved_office:

 

 

 

          resolved.office ||

 

 

 

          plan.context.office ||

 

 

 

          null,

 

 

 

        resolved_district:

 

 

 

          resolved.district || null,

 

 

 

      },

 

 

 

    };

 

 

 

 

 

 

 

    results.push(

 

 

 

      await executePlannedTool(

 

 

 

        fecCall,

 

 

 

        user

 


 

 

      )

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  return results;

 

 

 

}

 

 

 

async function executePlan({

 

 

 

  plan,

 

 

 

  user,

 

 

 

}) {

 

 

 

  if (

 

 

 

    plan.context.intent ===

 

 

 

    "finance"

 

 

 

  ) {

 

 

 

    return executeFinancePlan({

 

 

 

      plan,

 

 

 

      user,

 

 

 

    });

 

 

 

  }

 

 

 

 

 

 

 

  return Promise.all(

 

 

 

    plan.tool_plan.map(

 

 

 

      (call) =>

 

 

 

        executePlannedTool(

 

 

 

          call,

 

 

 

          user

 

 

 

        )

 

 

 

    )

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function getFecToolResults(

 

 

 

  results

 

 

 

) {

 

 

 

  return results.filter(

 

 

 

    (result) =>

 

 

 

      result.tool ===

 

 

 

      "get_fec_finance"

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function recordsFromFecResult(

 

 

 

  result

 

 

 

) {

 

 

 

  const data =

 

 

 

    result?.data;

 

 

 

 

 

 

 

  if (!data) {

 

 

 

    return [];

 

 

 

  }

 


 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(

 

 

 

      data.records

 

 

 

    )

 

 

 

  ) {

 

 

 

    return data.records;

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(

 

 

 

      data.finance

 

 

 

    )

 

 

 

  ) {

 

 

 

    return data.finance;

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(

 

 

 

      data.results

 

 

 

    )

 

 

 

  ) {

 

 

 

    return data.results;

 

 

 

  }

 

 

 

 

 

 

 

  return [];

 

 

 

}

 

 

 

 

 

 

 

function getFecRecords(

 

 

 

  results

 

 

 

) {

 

 

 

  return getFecToolResults(

 

 

 

    results

 

 

 

  ).flatMap(

 

 

 

    (result) =>

 

 

 

      recordsFromFecResult(

 

 

 

        result

 

 

 

      )

 

 

 

  );

 

 

 

}

 

 

 

function finiteNumber(

 

 

 

  value

 

 

 

) {

 

 

 

  const number =

 

 

 

    Number(value);

 

 

 

 

 

 

 

  return Number.isFinite(

 

 

 

    number

 

 

 

  )

 

 

 

    ? number

 


 

 

    : null;

 

 

 

}

 

 

 

 

 

 

 

function formatCurrency(

 

 

 

  value

 

 

 

) {

 

 

 

  const number =

 

 

 

    finiteNumber(value);

 

 

 

 

 

 

 

  if (

 

 

 

    number == null

 

 

 

  ) {

 

 

 

    return "N/A";

 

 

 

  }

 

 

 

 

 

 

 

  return new Intl.NumberFormat(

 

 

 

    "en-US",

 

 

 

    {

 

 

 

      style:

 

 

 

        "currency",

 

 

 

 

 

 

 

      currency:

 

 

 

        "USD",

 

 

 

 

 

 

 

      minimumFractionDigits:

 

 

 

        2,

 

 

 

 

 

 

 

      maximumFractionDigits:

 

 

 

        2,

 

 

 

    }

 

 

 

  ).format(number);

 

 

 

}

 

 

 

 

 

 

 

function formatDate(

 

 

 

  value

 

 

 

) {

 

 

 

  if (!value) {

 

 

 

    return "";

 

 

 

  }

 

 

 

 

 

 

 

  const date =

 

 

 

    new Date(value);

 

 

 

 

 

 

 

  if (

 

 

 

    Number.isNaN(

 

 

 

      date.getTime()

 

 

 

    )

 

 

 

  ) {

 

 

 

    return clean(value);

 

 

 

  }

 


 

 

 

 

 

 

  return new Intl.DateTimeFormat(

 

 

 

    "en-US",

 

 

 

    {

 

 

 

      year:

 

 

 

        "numeric",

 

 

 

 

 

 

 

      month:

 

 

 

        "long",

 

 

 

 

 

 

 

      day:

 

 

 

        "numeric",

 

 

 

 

 

 

 

      timeZone:

 

 

 

        "UTC",

 

 

 

    }

 

 

 

  ).format(date);

 

 

 

}

 

 

 

 

 

 

 

function metric(

 

 

 

  key,

 

 

 

  label,

 

 

 

  value,

 

 

 

  format = "currency"

 

 

 

) {

 

 

 

  const number =

 

 

 

    finiteNumber(value);

 

 

 

 

 

 

 

  if (

 

 

 

    number == null

 

 

 

  ) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  return {

 

 

 

    key,

 

 

 

    label,

 

 

 

    value:

 

 

 

      number,

 

 

 

    format,

 

 

 

 

 

 

 

    display_value:

 

 

 

      format ===

 

 

 

      "currency"

 

 

 

        ? formatCurrency(

 

 

 

            number

 

 

 

          )

 

 

 

        : String(

 

 

 

            number

 

 

 

          ),

 


 

 

  };

 

 

 

}

 

 

 

 

 

 

 

function selectLatestFecRecord(

 

 

 

  records = []

 

 

 

) {

 

 

 

  if (

 

 

 

    !records.length

 

 

 

  ) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  const dateValue =

 

 

 

    (record) =>

 

 

 

      new Date(

 

 

 

        record?.coverage_end_date ||

 

 

 

        record?.transaction_coverage_date ||

 

 

 

        record?.coverage_through_date ||

 

 

 

        record?.report_date ||

 

 

 

        0

 

 

 

      ).getTime() ||

 

 

 

      0;

 

 

 

 

 

 

 

  return [

 

 

 

    ...records,

 

 

 

  ].sort(

 

 

 

    (a, b) =>

 

 

 

      dateValue(b) -

 

 

 

      dateValue(a)

 

 

 

  )[0];

 

 

 

}

 

 

 

 

 

 

 

function buildFinanceInterpretation(

 

 

 

  record

 

 

 

) {

 

 

 

  if (!record) {

 

 

 

    return [];

 

 

 

  }

 

 

 

 

 

 

 

  const receipts =

 

 

 

    finiteNumber(

 

 

 

      record.receipts

 

 

 

    );

 

 

 

 

 

 

 

  const disbursements =

 

 

 

    finiteNumber(

 

 

 

      record.disbursements

 

 

 

    );

 

 

 

 

 

 

 

  const cash =

 


 

 

    finiteNumber(

 

 

 

      record.last_cash_on_hand_end_period ??

 

 

 

      record.cash_on_hand_end_period ??

 

 

 

      record.cash_on_hand

 

 

 

    );

 

 

 

 

 

 

 

  const transfersOut =

 

 

 

    finiteNumber(

 

 

 

      record.transfers_to_other_authorized_committee

 

 

 

    );

 

 

 

 

 

 

 

  const debts =

 

 

 

    finiteNumber(

 

 

 

      record.last_debts_owed_by_committee ??

 

 

 

      record.debts_owed_by_committee

 

 

 

    );

 

 

 

 

 

 

 

  const notes = [];

 

 

 

 

 

 

 

  if (

 

 

 

    receipts != null &&

 

 

 

    disbursements != null

 

 

 

  ) {

 

 

 

    if (

 

 

 

      disbursements >

 

 

 

      receipts

 

 

 

    ) {

 

 

 

      notes.push(

 

 

 

        `Reported disbursements (${formatCurrency(

 

 

 

          disbursements

 

 

 

        )}) exceed reported receipts (${formatCurrency(

 

 

 

          receipts

 

 

 

        )}) for the cycle-to-date totals returned by the FEC.`

 

 

 

      );

 

 

 

    } else {

 

 

 

      notes.push(

 

 

 

        `Reported receipts (${formatCurrency(

 

 

 

          receipts

 

 

 

        )}) exceed reported disbursements (${formatCurrency(

 

 

 

          disbursements

 

 

 

        )}) in the returned FEC totals.`

 

 

 

      );

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    cash != null &&

 

 

 

    receipts != null &&

 

 

 

    receipts > 0

 

 

 

  ) {

 


 

 

    const ratio =

 

 

 

      cash /

 

 

 

      receipts;

 

 

 

 

 

 

 

    if (

 

 

 

      ratio < 0.05

 

 

 

    ) {

 

 

 

      notes.push(

 

 

 

        `Period-end cash on hand is ${formatCurrency(

 

 

 

          cash

 

 

 

        )}, a relatively small share of the ${formatCurrency(

 

 

 

          receipts

 

 

 

        )} in reported receipts.`

 

 

 

      );

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    transfersOut != null &&

 

 

 

    transfersOut > 0

 

 

 

  ) {

 

 

 

    notes.push(

 

 

 

      `${formatCurrency(

 

 

 

        transfersOut

 

 

 

      )} is reported as transfers to other authorized committees.`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    debts === 0

 

 

 

  ) {

 

 

 

    notes.push(

 

 

 

      "The returned filing reports no debts owed by the committee."

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  return notes;

 

 

 

}

 

 

 

 

 

 

 

function buildFinanceReport({

 

 

 

  context,

 

 

 

  result,

 

 

 

}) {

 

 

 

  const records = recordsFromFecResult(

 

 

 

    result

 

 

 

  );

 

 

 

 

 

 

 

  const record = selectLatestFecRecord(

 

 

 

    records

 

 

 

  );

 


 

 

 

 

 

 

  if (!record) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  const candidateId = clean(

 

 

 

    record.candidate_id ||

 

 

 

    result?.arguments?.candidate_id ||

 

 

 

    context.candidate_id

 

 

 

  );

 

 

 

 

 

 

 

  const reportType = clean(

 

 

 

    record.last_report_type_full ||

 

 

 

    record.report_type_full ||

 

 

 

    record.report_type

 

 

 

  );

 

 

 

 

 

 

 

  const coverageEnd =

 

 

 

    record.coverage_end_date ||

 

 

 

    record.transaction_coverage_date ||

 

 

 

    record.coverage_through_date ||

 

 

 

    null;

 

 

 

 

 

 

 

  const coverageStart =

 

 

 

    record.coverage_start_date ||

 

 

 

    null;

 

 

 

 

 

 

 

  const metrics = [

 

 

 

    metric(

 

 

 

      "receipts",

 

 

 

      "Total receipts",

 

 

 

      record.receipts

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "disbursements",

 

 

 

      "Total disbursements",

 

 

 

      record.disbursements

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "cash_on_hand",

 

 

 

      "Cash on hand",

 

 

 

      record.last_cash_on_hand_end_period ??

 

 

 

        record.cash_on_hand_end_period ??

 

 

 

        record.cash_on_hand

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "contributions",

 

 

 

      "Total contributions",

 

 

 

      record.contributions

 

 

 

    ),

 


 

 

    metric(

 

 

 

      "individual_contributions",

 

 

 

      "Individual contributions",

 

 

 

      record.individual_contributions

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "itemized_individual_contributions",

 

 

 

      "Itemized individual contributions",

 

 

 

      record.individual_itemized_contributions

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "unitemized_individual_contributions",

 

 

 

      "Unitemized individual contributions",

 

 

 

      record.individual_unitemized_contributions

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "operating_expenditures",

 

 

 

      "Operating expenditures",

 

 

 

      record.operating_expenditures

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "transfers_out",

 

 

 

      "Transfers to other authorized committees",

 

 

 

      record.transfers_to_other_authorized_committee

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "transfers_in",

 

 

 

      "Transfers from other authorized committees",

 

 

 

      record.transfers_from_other_authorized_committee

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "refunds",

 

 

 

      "Contribution refunds",

 

 

 

      record.contribution_refunds

 

 

 

    ),

 

 

 

    metric(

 

 

 

      "debts_owed_by_committee",

 

 

 

      "Debts owed by committee",

 

 

 

      record.last_debts_owed_by_committee ??

 

 

 

        record.debts_owed_by_committee

 

 

 

    ),

 

 

 

  ].filter(Boolean);

 

 

 

 

 

 

 

  const source =

 

 

 

    result?.sources?.find(

 

 

 

      (item) =>

 

 

 

        clean(

 

 

 

          item.provider

 

 

 

        ).toLowerCase() ===

 

 

 

          "openfec" ||

 


 

 

        /fec/i.test(

 

 

 

          clean(

 

 

 

            item.name ||

 

 

 

            item.source

 

 

 

          )

 

 

 

        )

 

 

 

    ) ||

 

 

 

    result?.sources?.[0] ||

 

 

 

    null;

 

 

 

 

 

 

 

  const office = clean(

 

 

 

    result?.arguments?.resolved_office ||

 

 

 

    context.office

 

 

 

  );

 

 

 

 

 

 

 

  const district = clean(

 

 

 

    result?.arguments?.resolved_district

 

 

 

  );

 

 

 

 

 

 

 

  const state = clean(

 

 

 

    result?.arguments?.resolved_state ||

 

 

 

    context.state

 

 

 

  );

 

 

 

 

 

 

 

  const interpretation = buildFinanceInterpretation(

 

 

 

    record

 

 

 

  );

 

 

 

 

 

 

 

  return {

 

 

 

    candidate:

 

 

 

      context.candidate ||

 

 

 

      result?.arguments?.candidate ||

 

 

 

      null,

 

 

 

    candidate_id:

 

 

 

      candidateId || null,

 

 

 

    committee_id:

 

 

 

      clean(

 

 

 

        record.committee_id ||

 

 

 

        result?.arguments?.committee_id ||

 

 

 

        context.committee_id

 

 

 

      ) || null,

 

 

 

    state:

 

 

 

      state || null,

 

 

 

    office:

 

 

 

      office || null,

 

 

 

    district:

 

 

 

      district || null,

 

 

 

    cycle:

 

 

 

      record.cycle ||

 

 

 

      context.cycle ||

 


 

 

      null,

 

 

 

    report_type:

 

 

 

      reportType || null,

 

 

 

    coverage_start:

 

 

 

      coverageStart,

 

 

 

    coverage_end:

 

 

 

      coverageEnd,

 

 

 

    reporting_period:

 

 

 

      source?.reporting_period ||

 

 

 

      coverageEnd ||

 

 

 

      null,

 

 

 

    metrics,

 

 

 

    interpretation,

 

 

 

    record,

 

 

 

    source,

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

function financeReportLabel(

 

 

 

  report

 

 

 

) {

 

 

 

  const office = clean(

 

 

 

    report?.office

 

 

 

  );

 

 

 

 

 

 

 

  const district = clean(

 

 

 

    report?.district

 

 

 

  );

 

 

 

 

 

 

 

  if (office && district) {

 

 

 

    return `${office} - ${district}`;

 

 

 

  }

 

 

 

 

 

 

 

  return (

 

 

 

    office ||

 

 

 

    report?.candidate_id ||

 

 

 

    "FEC filing"

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

function appendFinanceReportLines(

 

 

 

  lines,

 

 

 

  report,

 

 

 

  includeHeading = true

 

 

 

) {

 

 

 

  if (includeHeading) {

 

 

 

    lines.push(

 

 

 

      financeReportLabel(

 

 

 

        report

 

 

 

      ),

 


 

 

      ""

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (report.candidate_id) {

 

 

 

    lines.push(

 

 

 

      `Candidate ID: ${report.candidate_id}`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (report.cycle) {

 

 

 

    lines.push(

 

 

 

      `Cycle: ${report.cycle}`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (report.report_type) {

 

 

 

    lines.push(

 

 

 

      `Report: ${report.report_type}`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (report.coverage_start) {

 

 

 

    lines.push(

 

 

 

      `Coverage start: ${formatDate(

 

 

 

        report.coverage_start

 

 

 

      )}`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (report.coverage_end) {

 

 

 

    lines.push(

 

 

 

      `Coverage through: ${formatDate(

 

 

 

        report.coverage_end

 

 

 

      )}`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  lines.push("");

 

 

 

 

 

 

 

  for (const item of report.metrics) {

 

 

 

    lines.push(

 

 

 

      `${item.label}: ${item.display_value}`

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    report.interpretation.length

 

 

 

  ) {

 

 

 

    lines.push(

 


 

 

      "",

 

 

 

      "Executive interpretation:"

 

 

 

    );

 

 

 

 

 

 

 

    for (

 

 

 

      const note

 

 

 

      of report.interpretation

 

 

 

    ) {

 

 

 

      lines.push(

 

 

 

        `- ${note}`

 

 

 

      );

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  if (report.source) {

 

 

 

    lines.push(

 

 

 

      "",

 

 

 

      `Source: ${

 

 

 

        clean(

 

 

 

          report.source.name ||

 

 

 

          report.source.source

 

 

 

        ) ||

 

 

 

        "Federal Election Commission OpenFEC API"

 

 

 

      }`

 

 

 

    );

 

 

 

 

 

 

 

    if (

 

 

 

      report.source.reporting_period

 

 

 

    ) {

 

 

 

      lines.push(

 

 

 

        `Reporting period: ${formatDate(

 

 

 

          report.source.reporting_period

 

 

 

        )}`

 

 

 

      );

 

 

 

    }

 

 

 

 

 

 

 

    if (

 

 

 

      report.source.confidence != null

 

 

 

    ) {

 

 

 

      lines.push(

 

 

 

        `Source confidence: ${report.source.confidence}%`

 

 

 

      );

 

 

 

    }

 

 

 

  }

 

 

 

}

 

 

 

 

 

 

 

function buildFinanceDataAnswer({

 

 

 

  context,

 

 

 

  results,

 

 

 

  sources,

 


 

 

}) {

 

 

 

  const reports = getFecToolResults(

 

 

 

    results

 

 

 

  )

 

 

 

    .filter(

 

 

 

      (result) =>

 

 

 

        result.usable

 

 

 

    )

 

 

 

    .map(

 

 

 

      (result) =>

 

 

 

        buildFinanceReport({

 

 

 

          context,

 

 

 

          result,

 

 

 

        })

 

 

 

    )

 

 

 

    .filter(Boolean);

 

 

 

 

 

 

 

  if (!reports.length) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  const candidateLabel =

 

 

 

    context.candidate ||

 

 

 

    "Candidate";

 

 

 

 

 

 

 

  const multiple =

 

 

 

    reports.length > 1;

 

 

 

 

 

 

 

  const title = multiple

 

 

 

    ? `Current FEC Reports - ${candidateLabel}`

 

 

 

    : `Current FEC Report - ${candidateLabel}`;

 

 

 

 

 

 

 

  const lines = [

 

 

 

    title,

 

 

 

    "",

 

 

 

  ];

 

 

 

 

 

 

 

  if (multiple) {

 

 

 

    lines.push(

 

 

 

      `VoterSpheres found ${reports.length} verified FEC candidate identities matching ${candidateLabel}. Because the request did not uniquely select one office, both verified reports are shown below.`,

 

 

 

      ""

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  reports.forEach(

 

 

 

    (report, index) => {

 

 

 

      appendFinanceReportLines(

 

 

 

        lines,

 

 

 

        report,

 

 

 

        multiple

 


 

 

      );

 

 

 

 

 

 

 

      if (

 

 

 

        index <

 

 

 

        reports.length - 1

 

 

 

      ) {

 

 

 

        lines.push(

 

 

 

          "",

 

 

 

          "---",

 

 

 

          ""

 

 

 

        );

 

 

 

      }

 

 

 

    }

 

 

 

  );

 

 

 

 

 

 

 

  const metrics = reports.flatMap(

 

 

 

    (report) =>

 

 

 

      report.metrics.map(

 

 

 

        (item) => ({

 

 

 

          ...item,

 

 

 

          candidate_id:

 

 

 

            report.candidate_id,

 

 

 

          office:

 

 

 

            report.office,

 

 

 

          district:

 

 

 

            report.district,

 

 

 

        })

 

 

 

      )

 

 

 

  );

 

 

 

 

 

 

 

  return {

 

 

 

    type:

 

 

 

      multiple

 

 

 

        ? "fec_finance_multi"

 

 

 

        : "fec_finance",

 

 

 

    title,

 

 

 

    candidate:

 

 

 

      context.candidate || null,

 

 

 

    candidate_id:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].candidate_id,

 

 

 

    committee_id:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].committee_id,

 

 

 

    cycle:

 

 

 

      context.cycle ||

 

 

 

      reports[0].cycle ||

 

 

 

      null,

 


 

 

    report_type:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].report_type,

 

 

 

    coverage_start:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].coverage_start,

 

 

 

    coverage_end:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].coverage_end,

 

 

 

    reporting_period:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].reporting_period,

 

 

 

    metrics,

 

 

 

    reports,

 

 

 

    interpretation:

 

 

 

      reports.flatMap(

 

 

 

        (report) =>

 

 

 

          report.interpretation

 

 

 

      ),

 

 

 

    record:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].record,

 

 

 

    source:

 

 

 

      multiple

 

 

 

        ? null

 

 

 

        : reports[0].source,

 

 

 

    sources,

 

 

 

    answer:

 

 

 

      lines.join("\n"),

 

 

 

  };

 

 

 

}

 

 

 

function candidateBundleRecords(

 

 

 

  bundle,

 

 

 

  key

 

 

 

) {

 

 

 

  const value =

 

 

 

    bundle?.[key];

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(value)

 

 

 

  ) {

 

 

 

    return value;

 

 

 

  }

 

 

 

 

 

 

 

  if (

 


 

 

    Array.isArray(

 

 

 

      value?.records

 

 

 

    )

 

 

 

  ) {

 

 

 

    return value.records;

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(

 

 

 

      value?.articles

 

 

 

    )

 

 

 

  ) {

 

 

 

    return value.articles;

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    Array.isArray(

 

 

 

      value?.polls

 

 

 

    )

 

 

 

  ) {

 

 

 

    return value.polls;

 

 

 

  }

 

 

 

 

 

 

 

  return [];

 

 

 

}

 

 

 

 

 

 

 

function buildCandidateIntelligenceDataAnswer({

 

 

 

  context,

 

 

 

  results,

 

 

 

  sources,

 

 

 

}) {

 

 

 

  const bundleResult =

 

 

 

    results.find(

 

 

 

      (item) =>

 

 

 

        item.tool ===

 

 

 

          "get_candidate_intelligence_bundle" &&

 

 

 

        item.usable

 

 

 

    );

 

 

 

 

 

 

 

  const bundle =

 

 

 

    bundleResult?.data;

 

 

 

 

 

 

 

  if (

 

 

 

    !bundle ||

 

 

 

    typeof bundle !==

 

 

 

      "object"

 

 

 

  ) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 


 

 

  const identities =

 

 

 

    Array.isArray(

 

 

 

      bundle.identities

 

 

 

    )

 

 

 

      ? bundle.identities

 

 

 

      : [];

 

 

 

 

 

 

 

  const financeReports =

 

 

 

    Array.isArray(

 

 

 

      bundle.finance?.reports

 

 

 

    )

 

 

 

      ? bundle.finance.reports

 

 

 

      : [];

 

 

 

 

 

 

 

  const polls =
  Array.isArray(
    bundle.polling?.records
  )
    ? bundle.polling.records
    : [];

const directPollingRecords =
  Array.isArray(
    bundle.polling?.direct_records
  )
    ? bundle.polling.direct_records
    : [];

const candidateContextPollingRecords =
  Array.isArray(
    bundle.polling?.candidate_context_records
  )
    ? bundle.polling.candidate_context_records
    : [];

const stateContextPollingRecords =
  Array.isArray(
    bundle.polling?.state_context_records
  )
    ? bundle.polling.state_context_records
    : [];

const directPollingCount =
  Number(
    bundle.polling?.direct_count ??
    directPollingRecords.length ??
    0
  ) || 0;

const candidateContextPollingCount =
  Number(
    bundle.polling?.candidate_context_count ??
    candidateContextPollingRecords.length ??
    0
  ) || 0;

const stateContextPollingCount =
  Number(
    bundle.polling?.state_context_count ??
    stateContextPollingRecords.length ??
    0
  ) || 0;

const pollingStatus =
  String(
    bundle.polling?.status ||
    ""
  ).trim();

const pollingQueryType =
  String(
    bundle.polling?.query_type ||
    ""
  ).trim();

const requestedPollingRace =
  bundle.polling?.requested_race &&
  typeof bundle.polling.requested_race === "object"
    ? bundle.polling.requested_race
    : {};

const requestedPollingOffice =
  String(
    requestedPollingRace.office ||
    context.office ||
    ""
  ).trim();

const requestedPollingState =
  String(
    requestedPollingRace.state ||
    context.state ||
    ""
  ).trim();

const articles =
  candidateBundleRecords(
    bundle,
    "news"
  );

const signals =
  Array.isArray(
    bundle.signals
  )
    ? bundle.signals
    : [];

const strategies =
  Array.isArray(
    bundle.strategy?.recommendations
  )
    ? bundle.strategy.recommendations
    : [];
 

 
  const candidateLabel =

    identities[0]?.name ||

    identities[0]?.candidate ||

    identities[0]?.record?.name ||

    identities[0]?.record?.full_name ||

    context.candidate ||

    "Candidate";

 

 

 

 

 

 

 

  const title =

 

 

 

    `Unified Candidate Intelligence - ${candidateLabel}`;

 

 

 

 

 

 

 

  const lines = [

 

 

 

    title,

 

 

 

    "",

 

 

 

  ];

 

 

 

 

 

 

 

  if (

 

 

 

    identities.length

 

 

 

  ) {

 

 

 

    lines.push(

 

 

 

      `Verified candidate identities: ${identities.length}`

 

 

 

    );

 

 

 

 

 

 

 

    for (

 

 

 

      const identity of

 

 

 

        identities.slice(

 

 

 

          0,

 

 

 


          6

 

 

 

        )

 

 

 

    ) {

 

 

 

      lines.push(

 

 

 

        `- ${

 

 

 

          identity.office ||

 

 

 

          "Office"

 

 

 

        }${

 

 

 

          identity.district

 

 

 

            ? ` - ${identity.district}`

 

 

 

            : ""

 

 

 

        }: ${

 

 

 

          identity.fec_candidate_id ||

          identity.candidate_id ||

          identity.record?.fec_candidate_id ||

          identity.committee_id ||

          identity.record?.campaign_committee_id ||

          "No FEC identifier"

 

 

 

        }`

 

 

 

      );

 

 

 

    }

 

 

 

  } else {

 

 

 

    lines.push(

 

 

 

      "No verified candidate identity was returned."

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  lines.push(
  "",
  `Official FEC reports: ${
  financeReports.filter(
    (report) =>
      report?.ok === true ||
      report?.result?.ok === true
  ).length
}`
);

/*
 * Polling is intentionally separated by intelligence context.
 *
 * Candidate-context or state-context polling must never be described
 * as direct polling for the requested race.
 */
if (
  pollingStatus ===
    "direct_race_available" ||
  directPollingCount > 0
) {
  lines.push(
    `Direct${
      requestedPollingOffice
        ? ` ${requestedPollingOffice}`
        : ""
    } polling: ${directPollingCount}`
  );

  if (
    candidateContextPollingCount > 0
  ) {
    lines.push(
      `Candidate-context polling: ${candidateContextPollingCount}`
    );
  }

  if (
    stateContextPollingCount > 0
  ) {
    lines.push(
      `State polling context: ${stateContextPollingCount}`
    );
  }
} else if (
  pollingStatus ===
    "candidate_context_available" ||
  pollingQueryType ===
    "candidate_context" ||
  candidateContextPollingCount > 0
) {
  lines.push(
    `Direct${
      requestedPollingOffice
        ? ` ${requestedPollingOffice}`
        : ""
    } polling: 0`
  );

  lines.push(
    `Candidate-context polling: ${candidateContextPollingCount}`
  );

  if (
    stateContextPollingCount > 0
  ) {
    lines.push(
      `State polling context: ${stateContextPollingCount}`
    );
  }
} else if (
  pollingStatus ===
    "state_context_available" ||
  pollingQueryType ===
    "state_context" ||
  stateContextPollingCount > 0
) {
  lines.push(
    `Direct${
      requestedPollingOffice
        ? ` ${requestedPollingOffice}`
        : ""
    } polling: 0`
  );

  lines.push(
    "Candidate-context polling: 0"
  );

  lines.push(
    `State polling context: ${stateContextPollingCount}`
  );
} else if (
  bundle.polling?.source_result?.ok
) {
  /*
   * Polling subsystem succeeded, but there were no applicable records.
   * This is not a provider failure.
   */
  lines.push(
    `Direct${
      requestedPollingOffice
        ? ` ${requestedPollingOffice}`
        : ""
    } polling: 0`
  );

  lines.push(
    "Candidate-context polling: 0"
  );

  if (
    requestedPollingState
  ) {
    lines.push(
      `No applicable polling records were found for the requested ${requestedPollingState} context.`
    );
  } else {
    lines.push(
      "No applicable polling records were found."
    );
  }
} else {
  /*
   * Preserve the distinction between unavailable polling and a valid
   * zero-match result.
   */
  lines.push(
    "Polling intelligence: unavailable or degraded"
  );
}

lines.push(
  `News articles: ${articles.length}`,
  `Political signals: ${signals.length}`,
  `Strategy recommendations: ${strategies.length}`
);

 

 

 

 

 

 

 

  if (
  polls.length
) {
  let pollingSectionTitle =
    "Latest polling:";

  if (
    pollingStatus ===
      "candidate_context_available" ||
    pollingQueryType ===
      "candidate_context"
  ) {
    pollingSectionTitle =
      "Latest candidate-context polling:";
  } else if (
    pollingStatfus ===
      "state_context_available" ||
    pollingQueryType ===
      "state_context"
  ) {
    pollingSectionTitle =
      "Latest state polling context:";
  } else if (
    pollingStatus ===
      "direct_race_available" ||
    pollingQueryType ===
      "direct_race"
  ) {
    pollingSectionTitle =
      `Latest${
        requestedPollingOffice
          ? ` ${requestedPollingOffice}`
          : ""
      } polling:`;
  }

  lines.push(
    "",
    pollingSectionTitle
  );

 

 

 

 

 

 

 

    for (

 

 


 

      const poll of

 

 

 

        polls.slice(

 

 

 

          0,

 

 

 

          5

 

 

 

        )

 

 

 

    ) {

 

 

 

      const pollLine =

 

 

 

        [

 

 

 

          poll.pollster ||

 

 

 

          poll.source,

 

 

 

          poll.candidate_name ||

 

 

 

          poll.answer ||

 

 

 

          poll.choice,

 

 

 

          poll.pct != null

 

 

 

            ? `${poll.pct}%`

 

 

 

            : null,

 

 

 

          poll.field_end ||

 

 

 

          poll.published_at ||

 

 

 

          poll.date,

 

 

 

        ]

 

 

 

          .filter(

 

 

 

            Boolean

 

 

 

          )

 

 

 

          .join(

 

 

 

            " - "

 

 

 

          );

 

 

 

 

 

 

 

      if (

 

 

 

        pollLine

 

 

 

      ) {

 

 

 

        lines.push(

 

 

 

          `- ${pollLine}`

 

 

 

        );

 

 

 

      }

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    articles.length

 

 

 

  ) {

 

 

 

    lines.push(

 

 

 

      "",

 

 

 

      "Recent reporting:"

 

 

 

    );

 

 

 

 

 

 

 

    for (

 

 

 

      const article of

 

 

 

        articles.slice(

 

 

 

          0,

 

 

 

          5

 

 


 

        )

 

 

 

    ) {

 

 

 

      const articleLine =

 

 

 

        [

 

 

 

          article.title ||

 

 

 

          article.headline,

 

 

 

          article.publisher ||

 

 

 

          article.source,

 

 

 

          article.published_at ||

 

 

 

          article.date,

 

 

 

        ]

 

 

 

          .filter(

 

 

 

            Boolean

 

 

 

          )

 

 

 

          .join(

 

 

 

            " - "

 

 

 

          );

 

 

 

 

 

 

 

      if (

 

 

 

        articleLine

 

 

 

      ) {

 

 

 

        lines.push(

 

 

 

          `- ${articleLine}`

 

 

 

        );

 

 

 

      }

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  if (

 

 

 

    strategies.length

 

 

 

  ) {

 

 

 

    lines.push(

 

 

 

      "",

 

 

 

      "VoterSpheres strategy recommendations:"

 

 

 

    );

 

 

 

 

 

 

 

    for (

 

 

 

      const strategy of

 

 

 

        strategies.slice(

 

 

 

          0,

 

 

 

          5

 

 

 

        )

 

 

 

    ) {

 

 

 

      const text =

 

 

 

        typeof strategy ===

 

 

 

          "string"

 

 

 

          ? strategy

 

 

 

          : clean(

 

 

 

              strategy.title ||

 

 

 

              strategy.recommended_action ||

 

 


 

              strategy.summary ||

 

 

 

              strategy.rationale

 

 

 

            );

 

 

 

 

 

 

 

      if (

 

 

 

        text

 

 

 

      ) {

 

 

 

        lines.push(

 

 

 

          `- ${text}`

 

 

 

        );

 

 

 

      }

 

 

 

    }

 

 

 

  }

 

 

 

 

 

 

 

  return {

 

 

 

    type:

 

 

 

      "candidate_intelligence",

 

 

 

    title,

 

 

 

    candidate:

 

 

 

      candidateLabel,

 

 

 

    identities,

 

 

 

    profile:

 

 

 

      bundle.profile ||

 

 

 

      null,

 

 

 

    finance:

 

 

 

      bundle.finance ||

 

 

 

      null,

 

 

 

    polling:

 

 

 

      bundle.polling ||

 

 

 

      null,

 

 

 

    news:

 

 

 

      bundle.news ||

 

 

 

      null,

 

 

 

    signals,

 

 

 

    strategy:

 

 

 

      bundle.strategy ||

 

 

 

      null,

 

 

 

    operations:

 

 

 

      bundle.operations ||

 

 

 

      null,

 

 

 

    coverage:

 

 

 

      bundle.coverage ||

 

 

 

      null,

 

 

 

    sources:

 

 

 

      bundle.sources ||

 

 

 

      sources,

 

 

 

    bundle,

 

 

 

    answer:

 

 

 

      lines.join(

 

 

 

        "\n"

 

 


 

      ),

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

function buildDataAnswer({

 

 

 

  context,

 

 

 

  results,

 

 

 

  sources,

 

 

 

}) {

 

 

 

  if (

 

 

 

    context.intent ===

 

 

 

    "finance"

 

 

 

  ) {

 

 

 

    return buildFinanceDataAnswer({

 

 

 

      context,

 

 

 

      results,

 

 

 

      sources,

 

 

 

    });

 

 

 

  }

 

 

 

  if (

 

    context.intent ===

 

    "candidate_intelligence"

 

  ) {

 

    return buildCandidateIntelligenceDataAnswer({

 

      context,

 

      results,

 

      sources,

 

    });

 

  }

 

 

 

  return null;

 

 

 

}

 

 

 

 

 

 

 

function deterministicBrief({

 

 

 

  question,

 

 

 

  context,

 

 

 

  results,

 

 

 

  coverage,

 

 

 

  confidence,

 

 

 

  sources,

 

 

 

  dataAnswer = null,

 

 

 

}) {

 

 

 

  if (

 

 

 

    dataAnswer?.answer

 

 

 

  ) {

 

 

 

    const gaps =

 

 

 

      results

 

 

 

        .filter(

 

 

 

          (item) =>

 

 

 

            !item.usable

 

 

 

        )

 

 

 

        .map(

 

 

 

          (item) => ({

 

 

 

            tool:

 

 

 

              item.tool,

 

 

 

 


 

 

 

            issue:

 

 

 

              item.warnings[0] ||

 

 

 

              item.summary ||

 

 

 

              "No usable evidence returned.",

 

 

 

          })

 

 

 

        );

 

 

 

 

 

 

 

    return {

 

 

 

      headline:

 

 

 

        dataAnswer.title,

 

 

 

 

 

 

 

      executive_summary:

 

 

 

        dataAnswer.answer,

 

 

 

 

 

 

 

      key_findings:

 

 

 

        Array.isArray(

 

 

 

          dataAnswer.metrics

 

 

 

        )

 

 

 

          ? dataAnswer.metrics.map(

 

 

 

              (

 

 

 

                item,

 

 

 

                index

 

 

 

              ) => ({

 

 

 

                rank:

 

 

 

                  index + 1,

 

 

 

 

 

 

 

                finding:

 

 

 

                  `${item.label}: ${item.display_value}`,

 

 

 

 

 

 

 

                support:

 

 

 

                  "get_fec_finance",

 

 

 

              })

 

 

 

            )

 

 

 

          : [

 

 

 

              {

 

 

 

                rank:

 

 

 

                  1,

 

 

 

 

 

 

 

                finding:

 

 

 

                  dataAnswer.title,

 

 

 

 

 

 

 

                support:

 

 

 

                  "get_candidate_intelligence_bundle",

 

 

 

              },

 

 

 

            ],

 

 

 

 

 

 

 

      risks_and_gaps:

 

 

 

        gaps,

 

 

 

 

 

 

 

      recommended_actions:


 

 

 

        dataAnswer.type ===

 

          "candidate_intelligence"

 

          ? (gaps.length

 

              ? [

 

                  "Use the verified candidate sections that are available and review degraded or unavailable candidate providers separately.",

 

                  "Refresh polling, news, political signals, and strategy sources before treating a missing section as a strategic conclusion.",

 

                ]

 

              : [

 

                  "Continue monitoring new FEC filings, candidate polling, current reporting, political signals, and VoterSpheres strategy recommendations.",

 

                ])

 

          : (gaps.length

 

              ? [

 

                  "Use the verified FEC filing data above and review any degraded supporting providers separately.",

 

                ]

 

              : [

 

                  "Continue monitoring subsequent FEC filings for changes in receipts, spending, cash position, transfers, and debt.",

 

                ]),

 

 

 

 

 

 

 

      answer:

 

 

 

        dataAnswer.answer,

 

 

 

 

 

 

 

      confidence,

 

 

 

 

 

 

 

      source_count:

 

 

 

        sources.length,

 

 

 

 

 

 

 

      data_answer:

 

 

 

        dataAnswer,

 

 

 

    };

 

 

 

  }

 

 

 

 

 

 

 

  const usable =

 

 

 

    results.filter(

 

 

 

      (item) =>

 

 

 

        item.usable

 

 

 

    );

 

 

 

 

 

 

 

  const findings =

 

 

 

    usable

 

 

 

      .slice(

 

 

 

        0,

 

 

 

        8

 

 

 

      )

 

 

 

      .map(

 

 

 

        (

 

 

 

          item,

 

 

 

          index

 

 

 

        ) => ({

 

 

 

          rank:

 

 

 

            index + 1,

 

 

 

 

 

 

 

          finding:

 

 

 

            item.summary ||

 

 

 

            `${item.tool} returned verified evidence.`,

 

 

 

 

 

 

 

          support:

 

 

 

            item.tool,

 

 

 

        })


 

 

 

      );

 

 

 

 

 

 

 

  const gaps =

 

 

 

    results

 

 

 

      .filter(

 

 

 

        (item) =>

 

 

 

          !item.usable

 

 

 

      )

 

 

 

      .map(

 

 

 

        (item) => ({

 

 

 

          tool:

 

 

 

            item.tool,

 

 

 

 

 

 

 

          issue:

 

 

 

            item.warnings[0] ||

 

 

 

            item.summary ||

 

 

 

            "No usable evidence returned.",

 

 

 

        })

 

 

 

      );

 

 

 

 

 

 

 

  const scope =

 

 

 

    [

 

 

 

      context.candidate,

 

 

 

      context.office,

 

 

 

      context.state_name,

 

 

 

      context.locality,

 

 

 

      context.cycle,

 

 

 

    ]

 

 

 

      .filter(

 

 

 

        Boolean

 

 

 

      )

 

 

 

      .join(

 

 

 

        " - "

 

 

 

      );

 

 

 

 

 

 

 

  const headline =

 

 

 

    findings[0]?.finding ||

 

 

 

    `No verified live intelligence is currently available${

 

 

 

      scope

 

 

 

        ? ` for ${scope}`

 

 

 

        : ""

 

 

 

    }.`;

 

 

 

 

 

 

 

  const answer =

 

 

 

    findings.length

 

 

 

      ? [

 

 

 

          headline,

 

 

 

          "",

 

 

 

          ...findings.map(

 

 

 

            (item) =>


 

 

 

              `${item.rank}. ${item.finding}`

 

 

 

          ),

 

 

 

          "",

 

 

 

          `Evidence status: ${coverage.evidence_status}. Confidence: ${confidence}%. Tools with usable evidence: ${coverage.useful_tools}/${coverage.attempted_tools}. Sources: ${sources.length}.`,

 

 

 

          gaps.length

 

 

 

            ? `Data gaps: ${gaps

 

 

 

                .slice(

 

 

 

                  0,

 

 

 

                  5

 

 

 

                )

 

 

 

                .map(

 

 

 

                  (item) =>

 

 

 

                    `${item.tool}: ${item.issue}`

 

 

 

                )

 

 

 

                .join(

 

 

 

                  "; "

 

 

 

                )}`

 

 

 

            : "No major provider gaps were reported.",

 

 

 

        ].join(

 

 

 

          "\n"

 

 

 

        )

 

 

 

      : `VoterSpheres could not retrieve enough verified evidence to answer: "${question}". The system will not substitute generic model knowledge for unavailable live political data. Review provider diagnostics, authentication, and API-key configuration.`;

 

 

 

 

 

 

 

  return {

 

 

 

    headline,

 

 

 

 

 

 

 

    executive_summary:

 

 

 

      findings

 

 

 

        .map(

 

 

 

          (item) =>

 

 

 

            item.finding

 

 

 

        )

 

 

 

        .join(

 

 

 

          " "

 

 

 

        ) ||

 

 

 

      answer,

 

 

 

 

 

 

 

    key_findings:

 

 

 

      findings,

 

 

 

 

 

 

 

    risks_and_gaps:

 

 

 

      gaps,

 

 

 

 

 

 

 

    recommended_actions:

 

 

 

      gaps.length

 

 

 

        ? [

 

 

 

            "Review provider diagnostics and environment variables, then rerun the briefing.",

 

 

 

          ]

 

 

 

        : [

 

 

 

            "Continue monitoring for new verified filings, polls, and reporting.",


 

 

 

          ],

 

 

 

 

 

 

 

    answer,

 

 

 

 

 

 

 

    confidence,

 

 

 

 

 

 

 

    source_count:

 

 

 

      sources.length,

 

 

 

 

 

 

 

    data_answer:

 

 

 

      dataAnswer,

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

async function synthesizeWithOpenAI({

 

 

 

  question,

 

 

 

  context,

 

 

 

  results,

 

 

 

  coverage,

 

 

 

  confidence,

 

 

 

  sources,

 

 

 

  deterministic,

 

 

 

  dataAnswer,

 

 

 

}) {

 

 

 

  if (

 

 

 

    !openai ||

 

 

 

    coverage.useful_tools ===

 

 

 

      0

 

 

 

  ) {

 

 

 

    return null;

 

 

 

  }

 

 

 

 

 

 

 

  const evidence =

 

 

 

    results

 

 

 

      .filter(

 

 

 

        (item) =>

 

 

 

          item.usable

 

 

 

      )

 

 

 

      .map(

 

 

 

        (item) => ({

 

 

 

          tool:

 

 

 

            item.tool,

 

 

 

 

 

 

 

          summary:

 

 

 

            item.summary,

 

 

 

 

 

 

 

          data:

 

 

 

            item.data,

 

 

 

 

 

 

 

          sources:


 

 

 

            item.sources,

 

 

 

 

 

 

 

          warnings:

 

 

 

            item.warnings,

 

 

 

        })

 

 

 

      );

 

 

 

 

 

 

 

  const response =

 

 

 

    await withTimeout(

 

 

 

      openai.responses.create(

 

 

 

        {

 

 

 

          model:

 

 

 

            MODEL,

 

 

 

 

 

 

 

          input: [

 

 

 

            "You are the VoterSpheres Executive Intelligence Orchestrator.",

 

 

 

            "Use only the supplied retrieved evidence. Do not use unsupported model memory as current political fact.",

 

 

 

            "The structured data_answer is authoritative when present. Preserve its exact numeric values, candidate IDs, dates, report types, and source information.",

 

 

 

            "For finance questions, answer with the actual FEC numbers first. Do not replace actual values with a generic statement such as 'Found 1 record.'",

 

 

 

            "For candidate intelligence questions, synthesize the verified profile, official FEC finance, polling, current news, political signals, and VoterSpheres strategy recommendations from the supplied candidate bundle.",

 

 

 

            "For candidate intelligence, organize the answer as Executive Assessment, Verified Candidate Identity, FEC / Fundraising, Polling, Recent News, Political Signals, Strategy Recommendations, Risks / Data Gaps, and Immediate Actions. Omit sections that truly have no evidence rather than inventing content.",

 

 

 

            "Finance values, poll percentages, article dates/headlines, candidate IDs, and source names must be copied exactly from retrieved evidence. Strategy recommendations must be labeled as VoterSpheres analysis rather than external fact.",

 

 

 

            "Clearly distinguish provider facts from VoterSpheres strategy recommendations and executive interpretation. Never invent a missing candidate section.",

 

 

 

            "Do not confuse polling records with FEC finance records.",

 

 

 

            "State exact publication dates, field dates, filing periods, and reporting periods when present.",

 

 

 

            "If evidence is partial, say so. Never invent candidates, polling values, finance totals, offices, race status, or state developments.",

 

 

 

            "Any interpretation must be clearly supported by the retrieved numbers.",

 

 

 

            "Return only valid JSON with: headline, executive_summary, key_findings, risks_and_gaps, recommended_actions, answer.",

 

 

 

            `Question: ${question}`,

 

 

 

            `Context: ${JSON.stringify(

 

 

 

              context

 

 

 

            )}`,

 

 

 

            `Coverage: ${JSON.stringify(

 

 

 

              coverage

 

 

 

            )}`,

 

 

 

            `Confidence: ${confidence}`,

 

 

 

            `Sources: ${JSON.stringify(

 

 

 

              sources.slice(

 

 

 

                0,

 

 

 

                40

 

 

 

              )

 

 

 

            )}`,

 

 

 

            `Structured data answer: ${JSON.stringify(

 

 

 

              dataAnswer

 

 

 

            ).slice(

 

 

 

              0,

 

 

 

              50000

 

 

 

            )}`,

 

 

 

            `Retrieved evidence: ${JSON.stringify(

 

 

 

              evidence


 

 

 

            ).slice(

 

 

 

              0,

 

 

 

              110000

 

 

 

            )}`,

 

 

 

            `Deterministic fallback: ${JSON.stringify(

 

 

 

              deterministic

 

 

 

            )}`,

 

 

 

          ].join(

 

 

 

            "\n"

 

 

 

          ),

 

 

 

        }

 

 

 

      ),

 

 

 

      SYNTHESIS_TIMEOUT_MS,

 

 

 

      "Executive briefing synthesis"

 

 

 

    );

 

 

 

 

 

 

 

  return extractJsonObject(

 

 

 

    response?.output_text ||

 

 

 

    ""

 

 

 

  );

 

 

 

}

 

 

 

 

 

 

 

export function getExecutiveOrchestratorConfiguration() {

 

 

 

  return {

 

 

 

    ok:

 

 

 

      true,

 

 

 

 

 

 

 

    build:

 

 

 

      BUILD,

 

 

 

 

 

 

 

    model:

 

 

 

      MODEL,

 

 

 

 

 

 

 

    openai_synthesis_configured:

 

 

 

      Boolean(

 

 

 

        openai

 

 

 

      ),

 

 

 

 

 

 

 

    live_intelligence_policy:

 

 

 

      "retrieved-evidence-required",

 

 

 

 

 

 

 

    data_answer_mode:

 

 

 

      true,

 

 

 

 

 

 

 

    finance_resolution_mode:

 

 

 

      "strict-candidate-statistics-multi-identity",

 

 

 

 

 

 

 

    orchestrator_timeout_ms:

 

 

 

      ORCHESTRATOR_TIMEOUT_MS,

 

 

 

 


 

 

 

    tool_timeout_ms:

 

 

 

      TOOL_TIMEOUT_MS,

 

 

 

 

 

 

 

    synthesis_timeout_ms:

 

 

 

      SYNTHESIS_TIMEOUT_MS,

 

 

 

 

 

 

 

    max_tools:

 

 

 

      MAX_TOOLS,

 

 

 

 

 

 

 

    generated_at:

 

 

 

      now(),

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

export function createExecutiveIntelligencePlan({

 

 

 

  payload = {},

 

 

 

} = {}) {

 

 

 

  const question =

 

 

 

    clean(

 

 

 

      payload.question ||

 

 

 

      payload.query ||

 

 

 

      payload.prompt

 

 

 

    );

 

 

 

 

 

 

 

  if (!question) {

 

 

 

    throw Object.assign(

 

 

 

      new Error(

 

 

 

        "A question, query, or prompt is required."

 

 

 

      ),

 

 

 

      {

 

 

 

        status:

 

 

 

          400,

 

 

 

      }

 

 

 

    );

 

 

 

  }

 

 

 

 

 

 

 

  const context =

 

 

 

    resolveContext(

 

 

 

      payload

 

 

 

    );

 

 

 

 

 

 

 

  const workspaceId =

 

 

 

    Number(

 

 

 

      payload.workspace_id ||

 

 

 

      payload.workspaceId ||

 

 

 

      1

 

 

 

    );

 

 

 

 

 

 

 

  const limit =

 

 

 

    clamp(


 

 

 

      payload.limit,

 

 

 

      12,

 

 

 

      1,

 

 

 

      20

 

 

 

    );

 

 

 

 

 

 

 

  return {

 

 

 

    ok:

 

 

 

      true,

 

 

 

 

 

 

 

    build:

 

 

 

      BUILD,

 

 

 

 

 

 

 

    question,

 

 

 

 

 

 

 

    context,

 

 

 

 

 

 

 

    workspace_id:

 

 

 

      workspaceId,

 

 

 

 

 

 

 

    limit,

 

 

 

 

 

 

 

    tool_plan:

 

 

 

      buildToolPlan({

 

 

 

        question,

 

 

 

        context,

 

 

 

        workspaceId,

 

 

 

        limit,

 

 

 

      }),

 

 

 

 

 

 

 

    generated_at:

 

 

 

      now(),

 

 

 

  };

 

 

 

}

 

 

 

 

 

 

 

export async function runExecutiveIntelligenceOrchestrator({

 

 

 

  user = {},

 

 

 

  payload = {},

 

 

 

} = {}) {

 

 

 

  const startedAt =

 

 

 

    Date.now();

 

 

 

 

 

 

 

  const plan =

 

 

 

    createExecutiveIntelligencePlan({

 

 

 

      payload,

 

 

 

    });

 

 

 

 

 

 

 

  const results =

 

 

 

    await withTimeout(

 

 

 

      executePlan({


 

 

 

        plan,

 

 

 

        user,

 

 

 

      }),

 

 

 

      ORCHESTRATOR_TIMEOUT_MS,

 

 

 

      "Executive Intelligence Orchestrator"

 

 

 

    );

 

 

 

 

 

 

 

  const sources =

 

 

 

    mergeSources(

 

 

 

      results

 

 

 

    );

 

 

 

 

 

 

 

  const coverage =

 

 

 

    buildCoverage(

 

 

 

      results,

 

 

 

      sources

 

 

 

    );

 

 

 

 

 

 

 

  const confidence =

 

 

 

    calculateConfidence(

 

 

 

      coverage

 

 

 

    );

 

 

 

 

 

 

 

  const warnings =

 

 

 

    unique(

 

 

 

      results.flatMap(

 

 

 

        (item) =>

 

 

 

          item.warnings.map(

 

 

 

            (warning) =>

 

 

 

              `${item.tool}: ${warning}`

 

 

 

          )

 

 

 

      )

 

 

 

    );

 

 

 

 

 

 

 

  const diagnostics =

 

 

 

    results.flatMap(

 

 

 

      (item) =>

 

 

 

        item.diagnostics.map(

 

 

 

          (diagnostic) => ({

 

 

 

            ...diagnostic,

 

 

 

            tool:

 

 

 

              item.tool,

 

 

 

          })

 

 

 

        )

 

 

 

    );

 

 

 

 

 

 

 

  const dataAnswer =

 

 

 

    buildDataAnswer({

 

 

 

      context:

 

 

 

        plan.context,


 

 

 

 

 

 

 

      results,

 

 

 

 

 

 

 

      sources,

 

 

 

    });

 

 

 

 

 

 

 

  let briefing =

 

 

 

    deterministicBrief({

 

 

 

      question:

 

 

 

        plan.question,

 

 

 

 

 

 

 

      context:

 

 

 

        plan.context,

 

 

 

 

 

 

 

      results,

 

 

 

 

 

 

 

      coverage,

 

 

 

 

 

 

 

      confidence,

 

 

 

 

 

 

 

      sources,

 

 

 

 

 

 

 

      dataAnswer,

 

 

 

    });

 

 

 

 

 

 

 

  let synthesisProvider =

 

 

 

    "deterministic";

 

 

 

 

 

 

 

  try {

 

 

 

    const ai =

 

 

 

      await synthesizeWithOpenAI({

 

 

 

        question:

 

 

 

          plan.question,

 

 

 

 

 

 

 

        context:

 

 

 

          plan.context,

 

 

 

 

 

 

 

        results,

 

 

 

 

 

 

 

        coverage,

 

 

 

 

 

 

 

        confidence,

 

 

 

 

 

 

 

        sources,

 

 

 

 

 

 

 

        deterministic:

 

 

 

          briefing,

 

 

 

 

 

 

 

        dataAnswer,

 

 

 

      });


 

 

 

 

 

 

 

    if (

 

 

 

      ai &&

 

 

 

      clean(

 

 

 

        ai.answer ||

 

 

 

        ai.executive_summary

 

 

 

      )

 

 

 

    ) {

 

 

 

      /*

 

 

 

       * Keep structured data_answer deterministic even when OpenAI

 

 

 

       * provides the prose synthesis.

 

 

 

       */

 

 

 

      briefing = {

 

 

 

        ...briefing,

 

 

 

        ...ai,

 

 

 

 

 

 

 

        confidence,

 

 

 

 

 

 

 

        source_count:

 

 

 

          sources.length,

 

 

 

 

 

 

 

        data_answer:

 

 

 

          dataAnswer,

 

 

 

      };

 

 

 

 

 

 

 

      synthesisProvider =

 

 

 

        "openai-grounded";

 

 

 

    }

 

 

 

  } catch (error) {

 

 

 

    warnings.push(

 

 

 

      `briefing_synthesis: ${

 

 

 

        error?.message ||

 

 

 

        "OpenAI synthesis failed."

 

 

 

      }`

 

 

 

    );

 

 

 

 

 

 

 

    diagnostics.push({

 

 

 

      provider:

 

 

 

        "openai",

 

 

 

 

 

 

 

      tool:

 

 

 

        "briefing_synthesis",

 

 

 

 

 

 

 

      ok:

 

 

 

        false,

 

 

 

 

 

 

 

      error:

 

 

 

        error?.message ||

 

 

 

        "OpenAI synthesis failed.",

 

 

 

 


 

 

 

      checked_at:

 

 

 

        now(),

 

 

 

    });

 

 

 

  }

 

 

 

 

 

 

 

  /*

 

 

 

   * Finance Data Answer Mode has priority over generic AI prose.

 

 

 

   * The AI can add interpretation, but it cannot hide the actual filing data.

 

 

 

   */

 

 

 

  const finalAnswer =

 

 

 

    plan.context.intent ===

 

      "finance" &&

 

    dataAnswer?.answer

 

      ? dataAnswer.answer

 

      : plan.context.intent ===

 

          "candidate_intelligence"

 

        ? (

 

            briefing.answer ||

 

            briefing.executive_summary ||

 

            dataAnswer?.answer ||

 

            briefing.headline

 

          )

 

        : (

 

            briefing.answer ||

 

            dataAnswer?.answer ||

 

            briefing.executive_summary ||

 

            briefing.headline

 

          );

 

 

 

 

 

 

 

  return {

 

 

 

    ok:

 

 

 

      coverage.useful_tools >

 

 

 

      0,

 

 

 

 

 

 

 

    build:

 

 

 

      BUILD,

 

 

 

 

 

 

 

    provider:

 

 

 

      "executive_intelligence_orchestrator",

 

 

 

 

 

 

 

    degraded:

 

 

 

      coverage.evidence_status !==

 

 

 

      "live",

 

 

 

 

 

 

 

    live_data_available:

 

 

 

      coverage.useful_tools >

 

 

 

      0,

 

 

 

 

 

 

 

    grounded:

 

 

 

      coverage.useful_tools >

 

 

 

      0,

 

 

 

 

 

 

 

    evidence_status:

 

 

 

      coverage.evidence_status,

 

 

 

 

 

 

 

    question:

 

 

 

      plan.question,

 

 

 

 

 

 


 

    context:

 

 

 

      plan.context,

 

 

 

 

 

 

 

    workspace_id:

 

 

 

      plan.workspace_id,

 

 

 

 

 

 

 

    plan: {

 

 

 

      tool_count:

 

 

 

        plan.tool_plan.length,

 

 

 

 

 

 

 

      tools:

 

 

 

        plan.tool_plan,

 

 

 

    },

 

 

 

 

 

 

 

    execution: {

 

 

 

      started_at:

 

 

 

        new Date(

 

 

 

          startedAt

 

 

 

        ).toISOString(),

 

 

 

 

 

 

 

      completed_at:

 

 

 

        now(),

 

 

 

 

 

 

 

      latency_ms:

 

 

 

        Date.now() -

 

 

 

        startedAt,

 

 

 

 

 

 

 

      coverage,

 

 

 

 

 

 

 

      confidence,

 

 

 

 

 

 

 

      synthesis_provider:

 

 

 

        synthesisProvider,

 

 

 

 

 

 

 

      data_answer_mode:

 

 

 

        Boolean(

 

 

 

          dataAnswer

 

 

 

        ),

 

 

 

    },

 

 

 

 

 

 

 

    data_answer:

 

 

 

      dataAnswer,

 

 

 

 

 

 

 

    briefing,

 

 

 

 

 

 

 

    answer:

 

 

 

      finalAnswer,

 

 

 

 

 

 

 

    tool_results:

 

 

 

      results,

 

 


 

 

 

 

 

    evidence:

 

 

 

      results.filter(

 

 

 

        (item) =>

 

 

 

          item.usable

 

 

 

      ),

 

 

 

 

 

 

 

    sources,

 

 

 

 

 

 

 

    warnings:

 

 

 

      unique(

 

 

 

        warnings

 

 

 

      ),

 

 

 

 

 

 

 

    diagnostics,

 

 

 

 

 

 

 

    generated_at:

 

 
      now()
 

      

 

 

 

  };

 

 

 

}

