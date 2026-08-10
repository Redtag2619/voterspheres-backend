import OpenAI from "openai";

 

import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

const BUILD = "4.2.0-data-answer";

 

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

 

  if (

    STATE_NAMES[explicit]

  ) {

    return explicit;

  }

 

  const lower =

    clean(

      question

    ).toLowerCase();

 

  for (

    const [name, code]

    of Object.entries(

      STATE_CODES

    )

  ) {

    if (

      lower.includes(name)

    ) {

      return code;

    }

  }

 

  const match =

    clean(

      question

    ).match(

      /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i

    );

 

  return match

    ? match[1].toUpperCase()

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

 

function detectCandidate(

  question,

  suppliedCandidate = ""

) {

  const explicit =

    clean(

      suppliedCandidate

    );

 

  if (explicit) {

    return explicit;

  }

 

  const text =

    clean(

      question

    );

 

  const quoted =

    text.match(

      /["“]([^"”]{3,80})["”]/

    );

 

  if (quoted) {

    return clean(

      quoted[1]

    );

  }

 

  const patterns = [

    /(?:about|candidate|profile|statistics|polling|fundraising|finance|fec|news on|news about|tell me about|show me|report for|filing for)\s+(?:for\s+)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i,

    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s+(?:campaign|polling|fundraising|finance|fec|candidate|race|statistics|news|report|filing)/i,

  ];

 

  for (

    const pattern

    of patterns

  ) {

    const match =

      text.match(pattern);

 

    if (

      match &&

      !Object.values(

        STATE_NAMES

      ).includes(

        clean(

          match[1]

        )

      )

    ) {

      return clean(

        match[1]

      );

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

    /candidate|campaign|profile|biograph|tell me about|who is/.test(

      lower

    )

  ) {

    return "candidate";

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

     * Finance is executed sequentially later so candidate resolution

     * can enrich the FEC request before get_fec_finance runs.

     *

     * The plan still describes every intended tool for diagnostics/UI.

     */

    if (

      context.candidate ||

      context.candidate_id

    ) {

      calls.push(

        makeCall(

          "get_candidate_live_intelligence",

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

 

            cycle:

              context.cycle,

 

            limit,

          },

          "Resolve candidate identity and FEC identifiers.",

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

        "Retrieve official FEC finance evidence.",

        98

      )

    );

 

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

          "Load internal candidate identity evidence.",

          88

        )

      );

    }

  } else if (

    context.intent ===

    "candidate"

  ) {

    calls.push(

      makeCall(

        "get_candidate_live_intelligence",

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

 

          limit,

        },

        "Build candidate-specific intelligence.",

        100

      )

    );

 

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

        "Resolve stored candidate records.",

        96

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

        "Retrieve current candidate reporting.",

        88

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

 

  const meaningful_item_count =

    countItems(

      value.data

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

      value.data ??

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

    const output =

      await withTimeout(

        executeExecutiveVoiceTool(

          {

            name:

              call.name,

 

            arguments:

              call.arguments,

 

            user,

          }

        ),

        TOOL_TIMEOUT_MS,

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

 

function resolveIdentityFromResults(

  results,

  context

) {

  let candidate_id =

    clean(

      context.candidate_id

    );

 

  let committee_id =

    clean(

      context.committee_id

    );

 

  let candidate =

    clean(

      context.candidate

    );

 

  for (

    const result

    of results

  ) {

    const direct =

      extractCandidateRecord(

        result

      );

 

    const identity =

      direct

        ? {

            candidate_id:

              candidateIdFromObject(

                direct

              ),

 

            committee_id:

              committeeIdFromObject(

                direct

              ),

 

            candidate:

              candidateNameFromObject(

                direct

              ),

          }

        : recursivelyFindIdentity(

            result?.data

          );

 

    candidate_id =

      candidate_id ||

      identity.candidate_id;

 

    committee_id =

      committee_id ||

      identity.committee_id;

 

    candidate =

      candidate ||

      identity.candidate;

 

    if (

      candidate_id &&

      candidate

    ) {

      break;

    }

  }

 

  return {

    candidate_id,

    committee_id,

    candidate,

  };

}

 

async function executeFinancePlan({

  plan,

  user,

}) {

  const results = [];

 

  const resolverCalls =

    plan.tool_plan.filter(

      (call) =>

        call.name ===

          "get_candidate_live_intelligence" ||

        call.name ===

          "get_candidate_statistics"

    );

 

  const fecTemplate =

    plan.tool_plan.find(

      (call) =>

        call.name ===

        "get_fec_finance"

    );

 

  /*

   * Run candidate identity tools first.

   * This fixes the prior race where FEC executed before candidate resolution

   * could provide a candidate_id.

   */

  for (

    const call

    of resolverCalls

  ) {

    const result =

      await executePlannedTool(

        call,

        user

      );

 

    results.push(

      result

    );

 

    const identity =

      resolveIdentityFromResults(

        results,

        plan.context

      );

 

    if (

      identity.candidate_id

    ) {

      break;

    }

  }

 

  const identity =

    resolveIdentityFromResults(

      results,

      plan.context

    );

 

  if (

    fecTemplate

  ) {

    const fecCall = {

      ...fecTemplate,

 

      arguments: {

        ...fecTemplate.arguments,

 

        candidate:

          identity.candidate ||

          plan.context.candidate,

 

        candidate_id:

          identity.candidate_id ||

          plan.context.candidate_id,

 

        committee_id:

          identity.committee_id ||

          plan.context.committee_id,

 

        cycle:

          plan.context.cycle,

      },

    };

 

    const fecResult =

      await executePlannedTool(

        fecCall,

        user

      );

 

    results.push(

      fecResult

    );

  }

 

  /*

   * Run any remaining planned tools not already executed.

   */

  const alreadyExecuted =

    new Set(

      results.map(

        (item) =>

          item.tool

      )

    );

 

  const remaining =

    plan.tool_plan.filter(

      (call) =>

        !alreadyExecuted.has(

          call.name

        )

    );

 

  if (

    remaining.length

  ) {

    const extra =

      await Promise.all(

        remaining.map(

          (call) =>

            executePlannedTool(

              call,

              user

            )

        )

      );

 

    results.push(

      ...extra

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

 

function getFecRecords(

  results

) {

  const result =

    findToolResult(

      results,

      "get_fec_finance"

    );

 

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

 

function buildFinanceDataAnswer({

  context,

  results,

  sources,

}) {

  const records =

    getFecRecords(

      results

    );

 

  const record =

    selectLatestFecRecord(

      records

    );

 

  if (!record) {

    return null;

  }

 

  const candidateId =

    clean(

      record.candidate_id ||

      context.candidate_id

    );

 

  const reportType =

    clean(

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

    sources.find(

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

    null;

 

  const candidateLabel =

    context.candidate ||

    "Candidate";

 

  const title =

    `Latest FEC Report — ${candidateLabel}`;

 

  const lines = [

    title,

    "",

  ];

 

  if (

    candidateId

  ) {

    lines.push(

      `Candidate ID: ${candidateId}`

    );

  }

 

  if (

    context.cycle

  ) {

    lines.push(

      `Cycle: ${context.cycle}`

    );

  }

 

  if (

    reportType

  ) {

    lines.push(

      `Report: ${reportType}`

    );

  }

 

  if (

    coverageStart

  ) {

    lines.push(

      `Coverage start: ${formatDate(

        coverageStart

      )}`

    );

  }

 

  if (

    coverageEnd

  ) {

    lines.push(

      `Coverage through: ${formatDate(

        coverageEnd

      )}`

    );

  }

 

  lines.push("");

 

  for (

    const item

    of metrics

  ) {

    lines.push(

      `${item.label}: ${item.display_value}`

    );

  }

 

  const interpretation =

    buildFinanceInterpretation(

      record

    );

 

  if (

    interpretation.length

  ) {

    lines.push(

      "",

      "Executive interpretation:"

    );

 

    for (

      const note

      of interpretation

    ) {

      lines.push(

        `- ${note}`

      );

    }

  }

 

  if (source) {

    lines.push(

      "",

      `Source: ${

        clean(

          source.name ||

          source.source

        ) ||

        "Federal Election Commission OpenFEC API"

      }`

    );

 

    if (

      source.reporting_period

    ) {

      lines.push(

        `Reporting period: ${formatDate(

          source.reporting_period

        )}`

      );

    }

 

    if (

      source.confidence != null

    ) {

      lines.push(

        `Source confidence: ${source.confidence}%`

      );

    }

  }

 

  return {

    type:

      "fec_finance",

 

    title,

 

    candidate:

      context.candidate ||

      null,

 

    candidate_id:

      candidateId ||

      null,

 

    committee_id:

      clean(

        record.committee_id ||

        context.committee_id

      ) ||

      null,

 

    cycle:

      record.cycle ||

      context.cycle ||

      null,

 

    report_type:

      reportType ||

      null,

 

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

        dataAnswer.metrics.map(

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

        ),

 

      risks_and_gaps:

        gaps,

 

      recommended_actions:

        gaps.length

          ? [

              "Use the verified FEC filing data above and review any degraded supporting providers separately.",

            ]

          : [

              "Continue monitoring subsequent FEC filings for changes in receipts, spending, cash position, transfers, and debt.",

            ],

 

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

      "candidate-first-sequential",

 

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

    dataAnswer?.answer

      ? dataAnswer.answer

      : (

          briefing.answer ||

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

      now(),

  };

}

