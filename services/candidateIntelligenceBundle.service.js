import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

 

const BUILD = "4.5.0-grounded-candidate-briefings";

 

const now = () => new Date().toISOString();

 

const clean = (value = "") =>

 

  String(value ?? "").trim();

 

const arr = (value) =>

 

  Array.isArray(value)

 

    ? value

 

    : [];

 

const obj = (value) =>

 

  value &&

 

  typeof value === "object" &&

 

  !Array.isArray(value)

 

    ? value

 

    : {};

 

function normalizePersonName(

 

  value = ""

 

) {

 

  const parts = clean(value)

 

    .toLowerCase()

 

    .replace(

 

      /\b(jr|sr|ii|iii|iv)\.?\b/g,

 

      " "

 

    )

 

    .replace(

 

      /[^a-z0-9]+/g,

 

      " "

 

    )

 

    .split(

 

      /\s+/

 

    )

 

    .map(

 

      (token) =>

 

        token.trim()

 

    )

 

    .filter(Boolean);

 

  return parts;

 

}

 

function candidateNamesMatch(

 

  requested,

 

  stored

 

) {

 

  const left =

 

    normalizePersonName(

 

      requested

 

    );

 

  const right =

 

    normalizePersonName(

 

      stored

 

    );

 

  if (

 

    !left.length ||

 

    !right.length

 

  ) {

 

    return false;

 

  }

 

  if (

 

    left.length ===

 

    1

 

  ) {

 

    return right.includes(

 

      left[0]

 

    );

 

  }

 

  return left.every(

 

    (token) =>

 

      right.includes(

 

        token

 

      )

 

  );

 

}

 

function pollingRecordMentionsCandidate(record = {}, requestedCandidate = "") {

  const requested = clean(requestedCandidate);

 

  if (!requested || !record || typeof record !== "object") {

    return false;

  }

 

  const candidateKeys = new Set([

    "candidate",

    "candidate_name",

    "candidate_full_name",

    "answer",

    "choice",

    "option",

    "name",

    "politician",

    "subject",

    "subject_name",

  ]);

 

  const containerKeys = new Set([

    "answers",

    "candidates",

    "choices",

    "options",

    "poll_answers",

    "results",

    "responses",

  ]);

 

  const values = [];

 

  for (const [key, value] of Object.entries(record)) {

    const normalizedKey = clean(key).toLowerCase();

 

    if (candidateKeys.has(normalizedKey) && typeof value === "string") {

      values.push(value);

    }

 

    if (containerKeys.has(normalizedKey) && Array.isArray(value)) {

      for (const item of value) {

        if (typeof item === "string") {

          values.push(item);

          continue;

        }

 

        if (item && typeof item === "object") {

          for (const nestedKey of candidateKeys) {

            if (typeof item[nestedKey] === "string") {

              values.push(item[nestedKey]);

            }

          }

        }

      }

    }

  }

 

  return values.some((value) =>

    candidateNamesMatch(requested, value)

  );

}

 

function candidateName(

 

  row = {}

 

) {

 

  return clean(

 

    row.full_name ||

 

    row.name ||

 

    row.candidate_name ||

 

    [

 

      row.first_name,

 

      row.middle_name,

 

      row.last_name,

 

    ]

 

      .filter(Boolean)

 

      .join(" ")

 

  );

 

}

 

function normalizeOffice(

 

  value = ""

 

) {

 

  const lower =

 

    clean(value)

 

      .toLowerCase()

 

      .replace(

 

        /[^a-z0-9]+/g,

 

        " "

 

      )

 

      .trim();

 

  if (

 

    /\bhouse\b|congress/.test(

 

      lower

 

    )

 

  ) {

 

    return "house";

 

  }

 

  if (

 

    /\bsenate\b|senator/.test(

 

      lower

 

    )

 

  ) {

 

    return "senate";

 

  }

 

  if (

 

    /president/.test(

 

      lower

 

    )

 

  ) {

 

    return "president";

 

  }

 

  if (

 

    /governor/.test(

 

      lower

 

    )

 

  ) {

 

    return "governor";

 

  }

 

  return lower;

 

}

 

function selectVerifiedIdentities(

 

  rows,

 

  context = {}

 

) {

 

  const requestedName =

 

    clean(

 

      context.candidate

 

    );

 

  const requestedState =

 

    clean(

 

      context.state

 

    ).toUpperCase();

 

  const requestedOffice =

 

    normalizeOffice(

 

      context.office

 

    );

 

  const requestedCycle =

 

    clean(

 

      context.cycle

 

    );

 

  return arr(rows)

 

    .filter(

 

      (row) => {

 

        const storedName =

 

          candidateName(

 

            row

 

          );

 

        if (

 

          requestedName &&

 

          !candidateNamesMatch(

 

            requestedName,

 

            storedName

 

          )

 

        ) {

 

          return false;

 

        }

 

        if (

 

          requestedState

 

        ) {

 

          const state =

 

            clean(

 

              row.state_code ||

 

              row.state

 

            ).toUpperCase();

 

          if (

 

            state &&

 

            state !==

 

              requestedState

 

          ) {

 

            return false;

 

          }

 

        }

 

        if (

 

          requestedOffice

 

        ) {

 

          const office =

 

            normalizeOffice(

 

              row.office ||

 

              row.office_full

 

            );

 

          if (

 

            office &&

 

            office !==

 

              requestedOffice

 

          ) {

 

            return false;

 

          }

 

        }

 

        if (

 

          requestedCycle &&

 

          row.election_year &&

 

          String(

 

            row.election_year

 

          ) !==

 

            requestedCycle

 

        ) {

 

          return false;

 

        }

 

        return Boolean(

 

          clean(

 

            row.fec_candidate_id

 

          ) ||

 

          clean(

 

            row.campaign_committee_id

 

          )

 

        );

 

      }

 

    )

 

    .map(

 

      (row) => ({

 

        candidate:

 

          candidateName(

 

            row

 

          ) ||

 

          requestedName,

 

        candidate_id:

 

          clean(

 

            row.fec_candidate_id

 

          ) ||

 

          null,

 

        committee_id:

 

          clean(

 

            row.campaign_committee_id

 

          ) ||

 

          null,

 

        state:

 

          clean(

 

            row.state_code ||

 

            row.state

 

          ) ||

 

          null,

 

        office:

 

          clean(

 

            row.office ||

 

            row.office_full

 

          ) ||

 

          null,

 

        district:

 

          clean(

 

            row.district

 

          ) ||

 

          null,

 

        party:

 

          clean(

 

            row.party

 

          ) ||

 

          null,

 

        election_year:

 

          row.election_year ||

 

          null,

 

        incumbent:

 

          row.incumbent ??

 

          null,

 

        status:

 

          row.status ||

 

          row.campaign_status ||

 

          null,

 

        website:

 

          row.website ||

 

          null,

 

        record:

 

          row,

 

      })

 

    );

 

}

 

async function safeTool(

 

  name,

 

  argumentsValue,

 

  user

 

) {

 

  try {

 

    return await executeExecutiveVoiceTool({

 

      name,

 

      arguments:

 

        argumentsValue,

 

      user,

 

    });

 

  } catch (

 

    error

 

  ) {

 

    return {

 

      ok:

 

        false,

 

      tool:

 

        name,

 

      summary:

 

        `${name} failed.`,

 

      data:

 

        null,

 

      records:

 

        [],

 

      sources:

 

        [],

 

      warnings: [

 

        error?.message ||

 

        "Unknown tool failure.",

 

      ],

 

      diagnostics: [

 

        {

 

          provider:

 

            name,

 

          ok:

 

            false,

 

          error:

 

            error?.message ||

 

            "Unknown tool failure.",

 

          checked_at:

 

            now(),

 

        },

 

      ],

 

      degraded:

 

        true,

 

      generated_at:

 

        now(),

 

    };

 

  }

 

}

 

function sourceKey(

 

  source = {}

 

) {

 

  return clean(

 

    source.url ||

 

    source.source_url ||

 

    source.name ||

 

    source.source ||

 

    source.provider

 

  ).toLowerCase();

 

}

 

function mergeSources(

 

  resultSets = []

 

) {

 

  const map =

 

    new Map();

 

  for (

 

    const set

 

    of resultSets

 

  ) {

 

    for (

 

      const source

 

      of arr(

 

        set?.sources

 

      )

 

    ) {

 

      const key =

 

        sourceKey(

 

          source

 

        );

 

      if (

 

        key &&

 

        !map.has(

 

          key

 

        )

 

      ) {

 

        map.set(

 

          key,

 

          source

 

        );

 

      }

 

    }

 

  }

 

  return [

 

    ...map.values(),

 

  ];

 

}

 

function strategyRowsFromUnified(

 

  unified

 

) {

 

  const data =

 

    obj(

 

      unified?.data

 

    );

 

  const briefing =

 

    obj(

 

      data.briefing

 

    );

 

  const candidates = [

 

    data.strategy_recommendations,

 

    data.recommendations,

 

    data.actions,

 

    briefing.strategy_recommendations,

 

    briefing.recommendations,

 

    briefing.recommended_actions,

 

  ];

 

  for (

 

    const value

 

    of candidates

 

  ) {

 

    if (

 

      Array.isArray(value)

 

    ) {

 

      return value;

 

    }

 

  }

 

  return [];

 

}

 

function signalRowsFromUnified(

 

  unified

 

) {

 

  const data =

 

    obj(

 

      unified?.data

 

    );

 

  const intelligence =

 

    obj(

 

      data.intelligence

 

    );

 

  const briefing =

 

    obj(

 

      data.briefing

 

    );

 

  const candidates = [

 

    data.political_signals,

 

    data.signals,

 

    intelligence.signals,

 

    briefing.signals,

 

  ];

 

  for (

 

    const value

 

    of candidates

 

  ) {

 

    if (

 

      Array.isArray(value)

 

    ) {

 

      return value;

 

    }

 

  }

 

  return [];

 

}

 

function recordsFromResult(

 

  result,

 

  preferredKeys = []

 

) {

 

  const data =

 

    result?.data;

 

  if (

 

    !data

 

  ) {

 

    return [];

 

  }

 

  for (

 

    const key

 

    of preferredKeys

 

  ) {

 

    if (

 

      Array.isArray(

 

        data?.[key]

 

      )

 

    ) {

 

      return data[key];

 

    }

 

  }

 

  if (

 

    Array.isArray(

 

      result.records

 

    )

 

  ) {

 

    return result.records;

 

  }

 

  return [];

 

}

 

function normalizeResultLimit(value, fallback = 12) {

  const numeric = Number(value);

 

  if (!Number.isFinite(numeric) || numeric <= 0) {

    return fallback;

  }

 

  return Math.min(Math.max(Math.trunc(numeric), 1), 100);

}

 

function compactToolResultArrays(result, limit) {

  if (!result || typeof result !== "object") {

    return result;

  }

 

  const compactData =

    result.data &&

    typeof result.data === "object" &&

    !Array.isArray(result.data)

      ? Object.fromEntries(

          Object.entries(result.data).map(([key, value]) => [

            key,

            Array.isArray(value) ? value.slice(0, limit) : value,

          ])

        )

      : result.data;

 

  return {

    ...result,

    data: compactData,

    records: Array.isArray(result.records)

      ? result.records.slice(0, limit)

      : result.records,

  };

}

 

export async function getCandidateIntelligenceBundle({

 

  candidate = "",

 

  candidateId = "",

 

  state = "",

 

  office = "",

 

  cycle = "",

 

  locality = "",

 

  workspaceId = 1,

 

  limit = 12,

 

  user = {},

 

} = {}) {

 

  const normalizedLimit =

    normalizeResultLimit(

      limit,

      12

    );

 

  const requestedCandidate =

 

    clean(

 

      candidate

 

    );

 

  const requestedCandidateId =

 

    clean(

 

      candidateId

 

    );

 

  if (

 

    !requestedCandidate &&

 

    !requestedCandidateId

 

  ) {

 

    const error =

 

      new Error(

 

        "Candidate name or candidate ID is required."

 

      );

 

    error.status =

 

      400;

 

    throw error;

 

  }

 

  /*

 

   * 1. Candidate profile + strict identity resolution.

 

   */

 

  const statistics =

 

    await safeTool(

 

      "get_candidate_statistics",

 

      {

 

        candidate:

 

          requestedCandidate,

 

        candidate_id:

 

          requestedCandidateId,

 

        state:

 

          clean(

 

            state

 

          ),

 

        office:

 

          clean(

 

            office

 

          ),

 

        cycle:

 

          clean(

 

            cycle

 

          ),

 

      },

 

      user

 

    );

 

  const identities =

 

    selectVerifiedIdentities(

 

      statistics?.data

 

        ?.candidates,

 

      {

 

        candidate:

 

          requestedCandidate,

 

        state,

 

        office,

 

        cycle,

 

      }

 

    );

 

  /*

 

   * Explicit candidate ID support.

 

   */

 

  if (

 

    requestedCandidateId &&

 

    !identities.some(

 

      (identity) =>

 

        identity.candidate_id ===

 

        requestedCandidateId

 

    )

 

  ) {

 

    identities.push({

 

      candidate:

 

        requestedCandidate ||

 

        null,

 

      candidate_id:

 

        requestedCandidateId,

 

      committee_id:

 

        null,

 

      state:

 

        clean(

 

          state

 

        ) ||

 

        null,

 

      office:

 

        clean(

 

          office

 

        ) ||

 

        null,

 

      district:

 

        null,

 

      party:

 

        null,

 

      election_year:

 

        clean(

 

          cycle

 

        ) ||

 

        null,

 

      incumbent:

 

        null,

 

      status:

 

        null,

 

      website:

 

        null,

 

      record:

 

        null,

 

    });

 

  }

 

  /*

 

   * 2. Official FEC finance for every verified candidate identity.

 

   * The Executive Voice tool accepts snake_case arguments.

 

   */

 

  const financeReports =

 

    [];

 

  for (

 

    const identity

 

    of identities

 

  ) {

 

    if (

 

      !clean(

 

        identity.candidate_id

 

      ) &&

 

      !clean(

 

        identity.committee_id

 

      )

 

    ) {

 

      continue;

 

    }

 

    const result =

 

      await safeTool(

 

        "get_fec_finance",

 

        {

 

          candidate:

 

            identity.candidate ||

 

            requestedCandidate,

 

          candidate_id:

 

            identity.candidate_id ||

 

            "",

 

          committee_id:

 

            identity.committee_id ||

 

            "",

 

          cycle:

 

            clean(

 

              cycle ||

 

              identity.election_year

 

            ),

 

        },

 

        user

 

      );

 

    financeReports.push({

 

      identity,

 

      result,

 

    });

 

  }

 

  /*

 

   * 3. Candidate polling.

 

   */

 

  const rawPolling =

 

    await safeTool(

 

      "get_latest_polling",

 

      {

 

        candidate:

 

          requestedCandidate,

 

        state:

 

          clean(

 

            state ||

 

            identities[0]

 

              ?.state

 

          ),

 

        office:

 

          clean(

 

            office

 

          ),

 

        locality:

 

          clean(

 

            locality

 

          ),

 

        limit:

          normalizedLimit,

 

      },

 

      user

 

    );

 

  /*

   * Providers may return every stored poll even when a limit is requested.

   * Bound every polling array before it is reused in raw diagnostics,

   * orchestrator responses, or Co-Pilot persistence snapshots.

   */

  const polling =

    compactToolResultArrays(

      rawPolling,

      normalizedLimit

    );

 

  /*

 

   * 4. Current candidate news/articles.

 

   */

 

  const news =

 

    await safeTool(

 

      "search_live_news",

 

      {

 

        query:

 

          requestedCandidate,

 

        state:

 

          clean(

 

            state ||

 

            identities[0]

 

              ?.state

 

          ),

 

        locality:

 

          clean(

 

            locality

 

          ),

 

        limit:

          normalizedLimit,

 

      },

 

      user

 

    );

 

  /*

 

   * 5. Existing VoterSpheres executive data fabric.

 

   * We reuse the platform's current signals and strategy recommendations

 

   * instead of creating a second strategy system.

 

   */

 

  const unified =

 

    await safeTool(

 

      "get_unified_executive_intelligence",

 

      {

 

        workspace_id:

 

          workspaceId,

 

        state:

 

          clean(

 

            state ||

 

            identities[0]

 

              ?.state

 

          ),

 

        office:

 

          clean(

 

            office

 

          ),

 

      },

 

      user

 

    );

 

  const returnedPollingRecords = recordsFromResult(

    polling,

    ["polls", "records", "results"]

  ).slice(0, normalizedLimit);

 

  const pollingData =

    polling?.data &&

    typeof polling.data === "object"

      ? polling.data

      : {};

 

  const providerDirectRecords = Array.isArray(

    pollingData.direct_records

  )

    ? pollingData.direct_records

    : [];

 

  /*

   * A provider label is not sufficient proof that a polling row belongs to

   * the requested candidate. Direct-race records must mention the candidate

   * in a candidate/answer/choice field. This prevents unrelated state polls

   * from being reported as direct candidate polling.

   */

  const directPollingRecords = [

    ...providerDirectRecords,

    ...(clean(pollingData.query_type) === "direct_race"

      ? returnedPollingRecords

      : []),

  ]

    .filter((record, index, records) =>

      pollingRecordMentionsCandidate(record, requestedCandidate) &&

      records.indexOf(record) === index

    )

    .slice(0, normalizedLimit);

 

  const candidateContextPollingRecords = (Array.isArray(

    pollingData.candidate_context_records

  )

    ? pollingData.candidate_context_records

    : clean(pollingData.query_type) === "candidate_context"

      ? returnedPollingRecords

      : [])

    .filter((record) =>

      pollingRecordMentionsCandidate(record, requestedCandidate)

    )

    .slice(0, normalizedLimit);

 

  const stateContextPollingRecords = (Array.isArray(

    pollingData.state_context_records

  )

    ? pollingData.state_context_records

    : clean(pollingData.query_type) === "state_context"

      ? returnedPollingRecords

      : [])

    .slice(0, normalizedLimit);

 

  const directPollingCount = directPollingRecords.length;

  const candidateContextPollingCount =

    candidateContextPollingRecords.length;

  const stateContextPollingCount = stateContextPollingRecords.length;

 

  const pollingStatus =

    directPollingCount > 0

      ? "direct_race_available"

      : candidateContextPollingCount > 0

        ? "candidate_context_available"

        : stateContextPollingCount > 0

          ? "state_context_available"

          : polling?.ok

            ? "no_polling_available"

            : "provider_error";

 

  const pollingQueryType =

    pollingStatus === "direct_race_available"

      ? "direct_race"

      : pollingStatus === "candidate_context_available"

        ? "candidate_context"

        : pollingStatus === "state_context_available"

          ? "state_context"

          : null;

 

  const pollingRecords =

    pollingQueryType === "direct_race"

      ? directPollingRecords

      : pollingQueryType === "candidate_context"

        ? candidateContextPollingRecords

        : pollingQueryType === "state_context"

          ? stateContextPollingRecords

          : [];

 

  const newsRecords =

 

    recordsFromResult(

 

      news,

 

      [

 

        "articles",

 

        "records",

 

        "results",

 

        "news",

 

      ]

 

    );

 

  const strategy =

 

    strategyRowsFromUnified(

 

      unified

 

    );

 

  const signals =

 

    signalRowsFromUnified(

 

      unified

 

    );

 

  const financeUsable =

 

    financeReports.filter(

 

      (entry) =>

 

        entry.result?.ok

 

    );

 

  const allResultSets = [

 

    statistics,

 

    ...financeReports.map(

 

      (entry) =>

 

        entry.result

 

    ),

 

    polling,

 

    news,

 

    unified,

 

  ];

 

  const warnings =

 

    allResultSets.flatMap(

 

      (result) =>

 

        arr(

 

          result?.warnings

 

        )

 

    );

 

  if (

    Number(pollingData.direct_count || 0) > 0 &&

    directPollingCount === 0

  ) {

    warnings.push(

      `Polling provider returned ${Number(

        pollingData.direct_count

      )} record(s) labeled direct, but none explicitly matched ${

        requestedCandidate || requestedCandidateId

      }. They were excluded from direct-race intelligence.`

    );

  }

 

  const diagnostics =

 

    allResultSets.flatMap(

 

      (result) =>

 

        arr(

 

          result?.diagnostics

 

        )

 

    );

 

  const sources =

 

    mergeSources(

 

      allResultSets

 

    );

 

  const usable =

 

    Boolean(

 

      identities.length ||

 

      financeUsable.length ||

 

      pollingRecords.length ||

 

      newsRecords.length ||

 

      signals.length ||

 

      strategy.length

 

    );

 

  const bundleData = {

 

    build:

 

      BUILD,

 

    provider:

 

      "voterspheres_candidate_intelligence_bundle",

 

    candidate_query:

 

      requestedCandidate,

 

    context: {

 

      state:

 

        clean(

 

          state ||

 

          identities[0]

 

            ?.state

 

        ) ||

 

        null,

 

      office:

 

        clean(

 

          office

 

        ) ||

 

        null,

 

      cycle:

 

        clean(

 

          cycle

 

        ) ||

 

        null,

 

      locality:

 

        clean(

 

          locality

 

        ) ||

 

        null,

 

      workspace_id:

 

        workspaceId,

 

    },

 

    identities,

 

    profile: {

 

      candidates:

 

        arr(

 

          statistics?.data

 

            ?.candidates

 

        ),

 

      verified_identities:

 

        identities,

 

    },

 

    finance: {

 

      reports:

 

        financeReports,

 

      verified_report_count:

 

        financeUsable.length,

 

    },

 

    polling: {

  /*

   * Backward-compatible record collection.

   *

   * These are the records returned by get_latest_polling,

   * which may represent direct-race, candidate-context,

   * or state-context polling.

   */

  records:

    pollingRecords,

 

  /*

   * Explicit polling-resolution metadata.

   *

   * This prevents candidate-context polling from being

   * interpreted as direct polling for the requested office.

   */

  status:

    pollingStatus,

 

  query_type:

    pollingQueryType,

 

  direct_count:

    directPollingCount,

 

  candidate_context_count:

    candidateContextPollingCount,

 

  state_context_count:

    stateContextPollingCount,

 

  direct_race_available:

    Boolean(

      pollingData.direct_race_available ??

      directPollingCount > 0

    ),

 

  candidate_context_available:

    Boolean(

      pollingData.candidate_context_available ??

      candidateContextPollingCount > 0

    ),

 

  state_context_available:

    Boolean(

      pollingData.state_context_available ??

      stateContextPollingCount > 0

    ),

 

  direct_records:

    directPollingRecords,

 

  candidate_context_records:

    candidateContextPollingRecords,

 

  state_context_records:

    stateContextPollingRecords,

 

  requested_race:

    pollingData.requested_race ||

    null,

 

  resolution:

    pollingData.resolution || {

      status:

        pollingStatus,

 

      query_type:

        pollingQueryType,

 

      direct_count:

        directPollingCount,

 

      candidate_context_count:

        candidateContextPollingCount,

 

      state_context_count:

        stateContextPollingCount,

    },

 

  source_result:

    polling,

},

 

    news: {

 

      articles:

 

        newsRecords,

 

      source_result:

 

        news,

 

    },

 

    signals,

 

    strategy: {

 

      recommendations:

 

        strategy,

 

      source:

 

        strategy.length

 

          ? "VoterSpheres Unified Executive Intelligence"

 

          : null,

 

    },

 

    operations:

 

      unified?.data ||

 

      null,

 

    coverage: {

 

      profile:

 

        identities.length >

 

        0,

 

      finance:

 

        financeUsable.length >

 

        0,

 

      polling:

  Boolean(

    polling?.ok ||

    pollingRecords.length > 0

  ),

 

polling_direct_race:

  directPollingCount > 0,

 

polling_candidate_context:

  candidateContextPollingCount > 0,

 

polling_state_context:

  stateContextPollingCount > 0,

 

      news:

 

        newsRecords.length >

 

        0,

 

      signals:

 

        signals.length >

 

        0,

 

      strategy:

 

        strategy.length >

 

        0,

 

    },

 

    sources,

 

    warnings,

 

    diagnostics,

 

    raw: {

 

      candidate_statistics:

 

        statistics,

 

      finance:

 

        financeReports,

 

      polling,

 

      news,

 

      unified,

 

    },

 

    generated_at:

 

      now(),

 

  };

 

  return {

 

    ok:

 

      usable,

 

    build:

 

      BUILD,

 

    provider:

 

      "voterspheres_candidate_intelligence_bundle",

 

    summary:

 

      usable

 

        ? `Unified candidate intelligence loaded for ${

    requestedCandidate ||

    requestedCandidateId

  }: ${

    identities.length

  } verified identities, ${

    financeUsable.length

  } FEC reports, ${

    directPollingCount

  } direct-race polling records, ${

    candidateContextPollingCount

  } candidate-context polling records, ${

    stateContextPollingCount

  } state-context polling records, ${

    newsRecords.length

  } news articles, ${

    signals.length

  } political signals, and ${

    strategy.length

  } strategy recommendations.`

 

        : `No verified candidate intelligence was returned for ${requestedCandidate || requestedCandidateId}.`,

 

    data:

 

      bundleData,

 

    records:

 

      identities,

 

    count:

 

      identities.length +

 

      financeUsable.length +

 

      pollingRecords.length +

 

      newsRecords.length +

 

      signals.length +

 

      strategy.length,

 

    sources,

 

    warnings,

 

    diagnostics,

 

    degraded:

 

      !usable ||

 

      Boolean(

 

        warnings.length ||

 

        financeReports.some((entry) => entry?.result?.degraded) ||

 

        polling?.degraded ||

 

        news?.degraded ||

 

        unified?.degraded

 

      ),

 

    generated_at:

 

      bundleData.generated_at,

 

    ...bundleData,

 

  };

 

}

 

export default {

 

  getCandidateIntelligenceBundle,

 

};


