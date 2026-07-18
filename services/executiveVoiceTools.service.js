import { pool } from "../db/pool.js";
import { getUnifiedExecutiveIntelligence } from "./unifiedExecutiveIntelligence.service.js";

import {
  getCongressUpdates,
  getElectionAdministrationUpdates,
  getOpenFecFinance,
  getPollingProviderData,
  getWeatherFieldRisk,
  searchCandidatePoliticalNews,
  searchCurrentPoliticalNews,
} from "./executiveVoiceLiveSources.service.js";

const now = () =>
  new Date().toISOString();

const clean = (
  value = ""
) =>
  String(
    value ?? ""
  ).trim();

function clamp(
  value,
  fallback = 5,
  min = 1,
  max = 20
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  return Number.isFinite(
    parsed
  )
    ? Math.min(
        max,
        Math.max(
          min,
          parsed
        )
      )
    : fallback;
}

function timestamp(
  value
) {
  const parsed =
    new Date(
      value || ""
    ).getTime();

  return Number.isFinite(
    parsed
  )
    ? parsed
    : 0;
}

function sortNewest(
  rows = []
) {
  return [
    ...rows,
  ].sort(
    (
      a,
      b
    ) =>
      timestamp(
        b.published_at ||
          b.field_end ||
          b.updated_at ||
          b.created_at
      ) -
      timestamp(
        a.published_at ||
          a.field_end ||
          a.updated_at ||
          a.created_at
      )
  );
}

function dedupe(
  rows = []
) {
  const seen =
    new Set();

  return rows.filter(
    (row) => {
      const key =
        clean(
          row.url ||
            row.source_url ||
            row.title ||
            row.id
        ).toLowerCase();

      if (
        !key ||
        seen.has(
          key
        )
      ) {
        return false;
      }

      seen.add(
        key
      );

      return true;
    }
  );
}

function getFirmId(
  user = {}
) {
  return (
    user.firmId ||
    user.firm_id ||
    user.firm?.id ||
    null
  );
}

function toolResult({
  tool,
  ok = true,
  summary = "",
  data = null,
  sources = [],
  warnings = [],
  diagnostics = [],
  degraded = false,
} = {}) {
  return {
    ok,
    tool,
    summary,
    data,
    sources,
    warnings,
    diagnostics,
    degraded,

    generated_at:
      now(),
  };
}

async function safeQuery(
  key,
  sql,
  params = []
) {
  try {
    const response =
      await pool.query(
        sql,
        params
      );

    return {
      key,
      ok:
        true,

      rows:
        response.rows ||
        [],

      error:
        null,
    };
  } catch (
    error
  ) {
    console.warn(
      `[executive-voice-tools] ${key} unavailable:`,
      error.message
    );

    return {
      key,
      ok:
        false,

      rows:
        [],

      error:
        error.message,
    };
  }
}

async function firstAvailable(
  candidates = []
) {
  for (
    const candidate
    of candidates
  ) {
    const response =
      await safeQuery(
        candidate.key,
        candidate.sql,
        candidate.params ||
          []
      );

    if (
      response.ok
    ) {
      return response;
    }
  }

  return {
    key:
      candidates[0]
        ?.key ||
      "unknown",

    ok:
      false,

    rows:
      [],

    error:
      "No compatible data source is available.",
  };
}

function candidateDisplayName(
  candidate
) {
  if (
    !candidate ||
    typeof candidate !==
      "object"
  ) {
    return null;
  }

  return (
    clean(
      candidate.name
    ) ||
    clean(
      [
        candidate.first_name,
        candidate.middle_name,
        candidate.last_name,
      ]
        .filter(
          Boolean
        )
        .join(
          " "
        )
    ) ||
    null
  );
}

function firstValue(
  ...values
) {
  return values.find(
    (
      value
    ) =>
      value !== undefined &&
      value !== null &&
      value !== ""
  ) ?? null;
}

function uniqueWarnings(
  warnings = []
) {
  return [
    ...new Set(
      warnings
        .flat()
        .filter(
          Boolean
        )
        .map(
          (
            warning
          ) =>
            clean(
              warning
            )
        )
        .filter(
          Boolean
        )
    ),
  ];
}

export const EXECUTIVE_VOICE_TOOL_DEFINITIONS =
  [
    {
      type:
        "function",

      name:
        "get_unified_executive_intelligence",

      description:
        "Get the current VoterSpheres executive operating picture, including health, workspaces, tasks, alerts, recommendations, and source freshness.",

      parameters: {
        type:
          "object",

        properties: {
          workspace_id: {
            type: [
              "number",
              "string",
              "null",
            ],
          },

          state: {
            type:
              "string",
          },

          office: {
            type:
              "string",
          },

          risk: {
            type:
              "string",
          },
        },

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "search_live_news",

      description:
        "Search the public web for the newest political reporting. Always use this for current, latest, today, breaking, recent articles, or public political developments not focused on one specific candidate.",

      parameters: {
        type:
          "object",

        properties: {
          query: {
            type:
              "string",
          },

          state: {
            type:
              "string",
          },

          locality: {
            type:
              "string",
          },

          limit: {
            type:
              "integer",

            minimum:
              1,

            maximum:
              10,
          },
        },

        required: [
          "query",
        ],

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_candidate_live_intelligence",

      description:
        "Get the newest available intelligence about a named political candidate. Use this instead of get_candidate_statistics for any request involving current, latest, today, recent news, campaign activity, polling, fundraising, endorsements, controversies, debates, advertising, ballot activity, or election developments.",

      parameters: {
        type:
          "object",

        properties: {
          candidate: {
            type:
              "string",
          },

          candidate_id: {
            type: [
              "number",
              "string",
              "null",
            ],
          },

          fec_candidate_id: {
            type: [
              "string",
              "null",
            ],
          },

          committee_id: {
            type: [
              "string",
              "null",
            ],
          },

          state: {
            type:
              "string",
          },

          office: {
            type:
              "string",
          },

          locality: {
            type:
              "string",
          },

          cycle: {
            type: [
              "integer",
              "string",
              "null",
            ],
          },

          limit: {
            type:
              "integer",

            minimum:
              1,

            maximum:
              20,
          },
        },

        required: [
          "candidate",
        ],

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_latest_polling",

      description:
        "Get the newest available polling. Use the configured external polling provider first and local polling tables only as fallback.",

      parameters: {
        type:
          "object",

        properties: {
          state: {
            type:
              "string",
          },

          office: {
            type:
              "string",
          },

          candidate: {
            type:
              "string",
          },

          locality: {
            type:
              "string",
          },

          limit: {
            type:
              "integer",

            minimum:
              1,

            maximum:
              20,
          },
        },

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_fec_finance",

      description:
        "Get the latest official federal campaign-finance totals and reporting period from OpenFEC, with local database fallback.",

      parameters: {
        type:
          "object",

        properties: {
          candidate: {
            type:
              "string",
          },

          candidate_id: {
            type:
              "string",
          },

          committee_id: {
            type:
              "string",
          },

          cycle: {
            type: [
              "integer",
              "string",
            ],
          },
        },

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_legislative_updates",

      description:
        "Get the newest official legislative updates from Congress.gov.",

      parameters: {
        type:
          "object",

        properties: {
          query: {
            type:
              "string",
          },

          limit: {
            type:
              "integer",

            minimum:
              1,

            maximum:
              25,
          },
        },

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_weather_field_risk",

      description:
        "Get live official National Weather Service alerts and field-operation risk for coordinates.",

      parameters: {
        type:
          "object",

        properties: {
          latitude: {
            type:
              "number",
          },

          longitude: {
            type:
              "number",
          },

          location: {
            type:
              "string",
          },
        },

        required: [
          "latitude",
          "longitude",
        ],

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_election_administration_updates",

      description:
        "Search for the newest public election-administration developments, deadlines, voting-system updates, and election-official announcements.",

      parameters: {
        type:
          "object",

        properties: {
          query: {
            type:
              "string",
          },

          state: {
            type:
              "string",
          },

          locality: {
            type:
              "string",
          },

          limit: {
            type:
              "integer",

            minimum:
              1,

            maximum:
              10,
          },
        },

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_state_operations",

      description:
        "Get state, county, parish, workspace, task, and operational intelligence for a U.S. state or locality.",

      parameters: {
        type:
          "object",

        properties: {
          state: {
            type:
              "string",
          },

          locality: {
            type:
              "string",
          },

          workspace_id: {
            type: [
              "number",
              "string",
              "null",
            ],
          },
        },

        required: [
          "state",
        ],

        additionalProperties:
          false,
      },
    },

    {
      type:
        "function",

      name:
        "get_candidate_statistics",

      description:
        "Get the stored VoterSpheres candidate profile and campaign statistics. Use only for profile or database-record questions that do not request current or live information.",

      parameters: {
        type:
          "object",

        properties: {
          candidate: {
            type:
              "string",
          },

          candidate_id: {
            type: [
              "number",
              "string",
            ],
          },

          state: {
            type:
              "string",
          },

          office: {
            type:
              "string",
          },

          cycle: {
            type: [
              "integer",
              "string",
            ],
          },
        },

        additionalProperties:
          false,
      },
    },
  ];

async function unifiedTool(
  args,
  user
) {
  const data =
    await getUnifiedExecutiveIntelligence({
      user,

      workspaceId:
        args.workspace_id ||
        null,

      state:
        clean(
          args.state
        ),

      office:
        clean(
          args.office
        ),

      risk:
        clean(
          args.risk
        ),
    });

  return toolResult({
    tool:
      "get_unified_executive_intelligence",

    summary:
      data?.briefing
        ?.strategic_summary ||
      "Unified executive intelligence loaded.",

    data,

    sources: [
      {
        source:
          "VoterSpheres Unified Executive Intelligence",

        published_at:
          data.generated_at,

        fetched_at:
          now(),

        confidence:
          data?.health
            ?.intelligence_confidence ||
          80,
      },
    ],

    warnings:
      data?.briefing
        ?.degraded_sources
        ?.length
        ? [
            "Degraded sources: " +
              data.briefing.degraded_sources.join(
                ", "
              ),
          ]
        : [],

    degraded:
      Boolean(
        data?.summary
          ?.degraded_source_count
      ),
  });
}

async function databaseNews({
  query,
  state,
  locality,
  limit,
  user,
}) {
  const params = [
    `%${query}%`,
  ];

  let where = `
    WHERE (
      COALESCE(title, '') ILIKE $1
      OR COALESCE(summary, '') ILIKE $1
      OR COALESCE(description, '') ILIKE $1
    )
  `;

  const firmId =
    getFirmId(
      user
    );

  if (
    firmId
  ) {
    params.push(
      firmId
    );

    where += `
      AND (
        firm_id = $${params.length}
        OR firm_id IS NULL
      )
    `;
  }

  if (
    state
  ) {
    params.push(
      state.toUpperCase()
    );

    where += `
      AND UPPER(
        COALESCE(state, '')
      ) = $${params.length}
    `;
  }

  if (
    locality
  ) {
    params.push(
      `%${locality}%`
    );

    where += `
      AND (
        COALESCE(county, '') ILIKE $${params.length}
        OR COALESCE(locality, '') ILIKE $${params.length}
        OR COALESCE(title, '') ILIKE $${params.length}
      )
    `;
  }

  params.push(
    limit
  );

  const response =
    await safeQuery(
      "political_signals_news",

      `
        SELECT *
        FROM political_signals
        ${where}
        ORDER BY
          COALESCE(
            published_at,
            updated_at,
            created_at
          ) DESC
        LIMIT $${params.length}
      `,

      params
    );

  return response.rows.map(
    (
      row
    ) => ({
      id:
        row.id,

      title:
        row.title ||
        "Political intelligence article",

      summary:
        row.executive_summary ||
        row.summary ||
        row.description ||
        row.detail ||
        "",

      url:
        row.source_url ||
        row.url ||
        null,

      publisher:
        row.publisher ||
        row.source_name ||
        row.source ||
        null,

      published_at:
        row.published_at ||
        row.updated_at ||
        row.created_at ||
        null,

      state:
        row.state ||
        null,

      locality:
        row.county ||
        row.locality ||
        null,

      score:
        row.signal_score ||
        row.confidence_score ||
        null,

      source_type:
        "voterspheres_political_signals",
    })
  );
}

async function newsTool(
  args,
  user
) {
  const query =
    clean(
      args.query
    );

  const state =
    clean(
      args.state
    );

  const locality =
    clean(
      args.locality
    );

  const limit =
    clamp(
      args.limit,
      5,
      1,
      10
    );

  const [
    live,
    localRows,
  ] =
    await Promise.all([
      searchCurrentPoliticalNews({
        query,
        state,
        locality,
        limit,
      }),

      databaseNews({
        query,
        state,
        locality,
        limit,
        user,
      }),
    ]);

  const liveRows =
    Array.isArray(
      live?.data?.articles
    )
      ? live.data.articles
      : [];

  const articles =
    dedupe(
      sortNewest([
        ...liveRows,
        ...localRows,
      ])
    ).slice(
      0,
      limit
    );

  return toolResult({
    tool:
      "search_live_news",

    ok:
      articles.length >
      0,

    summary:
      articles.length
        ? `Found ${articles.length} current political reports for ${query}.`
        : `No current reports were found for ${query}.`,

    data: {
      query,

      state:
        state ||
        null,

      locality:
        locality ||
        null,

      articles,
    },

    sources: [
      ...(
        live?.sources ||
        []
      ),

      ...localRows.map(
        (
          row
        ) => ({
          source:
            row.publisher ||
            "VoterSpheres Political Signals",

          source_url:
            row.url,

          published_at:
            row.published_at,

          fetched_at:
            now(),

          confidence:
            row.score ||
            78,
        })
      ),
    ],

    warnings:
      live?.warnings ||
      [],

    diagnostics:
      live?.diagnostics ||
      [],

    degraded:
      !live?.ok &&
      localRows.length ===
        0,
  });
}

async function resolveCandidateProfile(
  args = {}
) {
  const candidate =
    clean(
      args.candidate
    );

  const candidateId =
    clean(
      args.candidate_id
    );

  const state =
    clean(
      args.state
    );

  const office =
    clean(
      args.office
    );

  const cycle =
    clean(
      args.cycle
    );

  const params =
    [];

  const conditions =
    [];

  if (
    candidateId
  ) {
    params.push(
      candidateId
    );

    conditions.push(
      `CAST(id AS text) = $${params.length}`
    );
  }

  if (
    candidate
  ) {
    params.push(
      `%${candidate}%`
    );

    conditions.push(
      `(
        COALESCE(name, '') ILIKE $${params.length}
        OR (
          COALESCE(first_name, '')
          || ' '
          || COALESCE(last_name, '')
        ) ILIKE $${params.length}
      )`
    );
  }

  if (
    state
  ) {
    params.push(
      state.toUpperCase()
    );

    conditions.push(
      `UPPER(COALESCE(state, '')) = $${params.length}`
    );
  }

  if (
    office
  ) {
    params.push(
      `%${office}%`
    );

    conditions.push(
      `COALESCE(office, '') ILIKE $${params.length}`
    );
  }

  if (
    cycle
  ) {
    params.push(
      cycle
    );

    conditions.push(
      `CAST(COALESCE(cycle, election_year) AS text) = $${params.length}`
    );
  }

  const where =
    conditions.length
      ? `WHERE ${conditions.join(
          " AND "
        )}`
      : "";

  return safeQuery(
    "candidate_profile",

    `
      SELECT *
      FROM candidates
      ${where}
      ORDER BY
        updated_at DESC,
        created_at DESC
      LIMIT 5
    `,

    params
  );
}

async function candidateLiveTool(
  args,
  user
) {
  const requestedCandidate =
    clean(
      args.candidate
    );

  const requestedState =
    clean(
      args.state
    );

  const requestedOffice =
    clean(
      args.office
    );

  const requestedLocality =
    clean(
      args.locality
    );

  const requestedCycle =
    clean(
      args.cycle
    );

  const requestedLimit =
    clamp(
      args.limit,
      10,
      1,
      20
    );

  const profileResponse =
    await resolveCandidateProfile(
      args
    );

  const profile =
    profileResponse.rows?.[0] ||
    null;

  const resolvedCandidate =
    candidateDisplayName(
      profile
    ) ||
    requestedCandidate;

  const resolvedState =
    firstValue(
      profile?.state,
      requestedState
    ) ||
    "";

  const resolvedOffice =
    firstValue(
      profile?.office,
      requestedOffice
    ) ||
    "";

  const resolvedCycle =
    firstValue(
      profile?.cycle,
      profile?.election_year,
      requestedCycle
    ) ||
    "";

  const resolvedFecCandidateId =
    firstValue(
      args.fec_candidate_id,
      profile?.fec_candidate_id,
      profile?.candidate_id,
      profile?.fec_id
    );

  const resolvedCommitteeId =
    firstValue(
      args.committee_id,
      profile?.committee_id,
      profile?.principal_committee_id,
      profile?.fec_committee_id
    );

  const [
    liveNews,
    polling,
    finance,
    localNews,
  ] =
    await Promise.all([
      searchCandidatePoliticalNews({
        candidate:
          resolvedCandidate,

        state:
          resolvedState,

        office:
          resolvedOffice,

        locality:
          requestedLocality,

        limit:
          requestedLimit,
      }),

      pollingTool({
        candidate:
          resolvedCandidate,

        state:
          resolvedState,

        office:
          resolvedOffice,

        locality:
          requestedLocality,

        limit:
          requestedLimit,
      }),

      fecTool({
        candidate:
          resolvedCandidate,

        candidate_id:
          resolvedFecCandidateId,

        committee_id:
          resolvedCommitteeId,

        cycle:
          resolvedCycle,
      }),

      databaseNews({
        query:
          resolvedCandidate,

        state:
          resolvedState,

        locality:
          requestedLocality,

        limit:
          requestedLimit,

        user,
      }),
    ]);

  const liveArticles =
    Array.isArray(
      liveNews?.data?.articles
    )
      ? liveNews.data.articles
      : [];

  const mergedArticles =
    dedupe(
      sortNewest([
        ...liveArticles,
        ...localNews,
      ])
    ).slice(
      0,
      requestedLimit
    );

  const polls =
    Array.isArray(
      polling?.data?.polls
    )
      ? polling.data.polls
      : [];

  const financeRecords =
    Array.isArray(
      finance?.data?.records
    )
      ? finance.data.records
      : [];

  const newestArticle =
    mergedArticles[0] ||
    null;

  const newestPoll =
    polls[0] ||
    null;

  const newestFinanceRecord =
    financeRecords[0] ||
    null;

  const summaryParts =
    [];

  if (
    mergedArticles.length
  ) {
    summaryParts.push(
      `${mergedArticles.length} current article${
        mergedArticles.length ===
        1
          ? ""
          : "s"
      }`
    );
  }

  if (
    polls.length
  ) {
    summaryParts.push(
      `${polls.length} polling record${
        polls.length ===
        1
          ? ""
          : "s"
      }`
    );
  }

  if (
    financeRecords.length
  ) {
    summaryParts.push(
      `${financeRecords.length} finance record${
        financeRecords.length ===
        1
          ? ""
          : "s"
      }`
    );
  }

  const ok =
    Boolean(
      profile ||
      mergedArticles.length ||
      polls.length ||
      financeRecords.length
    );

  return toolResult({
    tool:
      "get_candidate_live_intelligence",

    ok,

    summary:
      summaryParts.length
        ? `Live intelligence for ${resolvedCandidate}: ${summaryParts.join(
            ", "
          )}.`
        : `No current live intelligence was found for ${resolvedCandidate}.`,

    data: {
      candidate: {
        requested_name:
          requestedCandidate,

        resolved_name:
          resolvedCandidate,

        candidate_id:
          firstValue(
            profile?.id,
            args.candidate_id
          ),

        fec_candidate_id:
          resolvedFecCandidateId,

        committee_id:
          resolvedCommitteeId,

        state:
          resolvedState ||
          null,

        office:
          resolvedOffice ||
          null,

        locality:
          requestedLocality ||
          null,

        cycle:
          resolvedCycle ||
          null,

        profile:
          profile ||
          null,

        profile_matches:
          profileResponse.rows ||
          [],
      },

      news: {
        articles:
          mergedArticles,

        live_article_count:
          liveArticles.length,

        local_article_count:
          localNews.length,

        latest_published_at:
          newestArticle
            ?.published_at ||
          null,

        successful_providers:
          liveNews?.data
            ?.successful_providers ||
          [],

        attempted_providers:
          liveNews?.data
            ?.attempted_providers ||
          [],
      },

      polling: {
        polls,

        latest_field_end:
          newestPoll
            ?.field_end ||
          newestPoll
            ?.published_at ||
          null,

        provider_priority:
          polling?.data
            ?.provider_priority ||
          null,
      },

      finance: {
        records:
          financeRecords,

        latest_reporting_period:
          newestFinanceRecord
            ?.coverage_through_date ||
          newestFinanceRecord
            ?.coverage_end_date ||
          null,

        provider_priority:
          finance?.data
            ?.provider_priority ||
          null,
      },
    },

    sources: [
      ...(
        liveNews?.sources ||
        []
      ),

      ...localNews.map(
        (
          row
        ) => ({
          source:
            row.publisher ||
            "VoterSpheres Political Signals",

          source_url:
            row.url,

          published_at:
            row.published_at,

          fetched_at:
            now(),

          confidence:
            row.score ||
            78,
        })
      ),

      ...(
        polling?.sources ||
        []
      ),

      ...(
        finance?.sources ||
        []
      ),

      ...(
        profile
          ? [
              {
                source:
                  "VoterSpheres Candidate Database",

                published_at:
                  profile.updated_at ||
                  profile.created_at ||
                  null,

                fetched_at:
                  now(),

                confidence:
                  90,
              },
            ]
          : []
      ),
    ],

    warnings:
      uniqueWarnings([
        liveNews?.warnings ||
          [],

        polling?.warnings ||
          [],

        finance?.warnings ||
          [],

        profileResponse.ok
          ? []
          : [
              profileResponse.error,
            ],

        !profile &&
        requestedCandidate
          ? [
              "No matching local candidate profile was found; live providers used the requested candidate name.",
            ]
          : [],
      ]),

    diagnostics: [
      ...(
        liveNews?.diagnostics ||
        []
      ),

      ...(
        polling?.diagnostics ||
        []
      ),

      ...(
        finance?.diagnostics ||
        []
      ),
    ],

    degraded:
      !liveNews?.ok ||
      !polling?.ok ||
      !finance?.ok ||
      !profileResponse.ok,
  });
}

async function pollingTool(
  args
) {
  const state =
    clean(
      args.state
    );

  const office =
    clean(
      args.office
    );

  const candidate =
    clean(
      args.candidate
    );

  const locality =
    clean(
      args.locality
    );

  const limit =
    clamp(
      args.limit,
      10,
      1,
      20
    );

  const live =
    await getPollingProviderData({
      state,
      office,
      candidate,
      locality,
      limit,
    });

  const livePolls =
    Array.isArray(
      live?.data?.polls
    )
      ? live.data.polls
      : [];

  if (
    live?.ok &&
    livePolls.length
  ) {
    return toolResult({
      tool:
        "get_latest_polling",

      ok:
        true,

      summary:
        live.summary,

      data: {
        state:
          state ||
          null,

        office:
          office ||
          null,

        candidate:
          candidate ||
          null,

        locality:
          locality ||
          null,

        polls:
          sortNewest(
            livePolls
          ).slice(
            0,
            limit
          ),

        provider_priority:
          "external",
      },

      sources:
        live.sources ||
        [],

      warnings:
        live.warnings ||
        [],

      diagnostics:
        live.diagnostics ||
        [],

      degraded:
        Boolean(
          live.degraded
        ),
    });
  }

  const params =
    [];

  const conditions =
    [];

  const like = (
    column,
    value
  ) => {
    if (
      !value
    ) {
      return;
    }

    params.push(
      `%${value}%`
    );

    conditions.push(
      `COALESCE(${column}, '') ILIKE $${params.length}`
    );
  };

  like(
    "state",
    state
  );

  like(
    "office",
    office
  );

  like(
    "candidate_name",
    candidate
  );

  like(
    "locality",
    locality
  );

  const where =
    conditions.length
      ? `WHERE ${conditions.join(
          " AND "
        )}`
      : "";

  params.push(
    limit
  );

  const response =
    await firstAvailable([
      {
        key:
          "polling_results",

        sql: `
          SELECT *
          FROM polling_results
          ${where}
          ORDER BY
            COALESCE(
              field_end,
              published_at,
              updated_at,
              created_at
            ) DESC
          LIMIT $${params.length}
        `,

        params,
      },

      {
        key:
          "polls",

        sql: `
          SELECT *
          FROM polls
          ${where}
          ORDER BY
            COALESCE(
              field_end,
              published_at,
              updated_at,
              created_at
            ) DESC
          LIMIT $${params.length}
        `,

        params,
      },

      {
        key:
          "election_polls",

        sql: `
          SELECT *
          FROM election_polls
          ${where}
          ORDER BY
            COALESCE(
              field_end,
              published_at,
              updated_at,
              created_at
            ) DESC
          LIMIT $${params.length}
        `,

        params,
      },
    ]);

  const polls =
    sortNewest(
      response.rows.map(
        (
          row
        ) => ({
          id:
            row.id,

          pollster:
            row.pollster ||
            row.organization ||
            row.source_name ||
            null,

          state:
            row.state ||
            state ||
            null,

          office:
            row.office ||
            office ||
            null,

          locality:
            row.locality ||
            row.district ||
            locality ||
            null,

          candidate_name:
            row.candidate_name ||
            candidate ||
            null,

          candidate_results:
            row.candidate_results ||
            row.results ||
            row.result_json ||
            null,

          percentage:
            row.percentage ??
            row.support ??
            row.poll_percentage ??
            null,

          field_start:
            row.field_start ||
            row.start_date ||
            null,

          field_end:
            row.field_end ||
            row.end_date ||
            null,

          published_at:
            row.published_at ||
            row.updated_at ||
            row.created_at ||
            null,

          sample_size:
            row.sample_size ||
            row.sample ||
            null,

          population:
            row.population ||
            row.sample_type ||
            null,

          margin_of_error:
            row.margin_of_error ||
            row.moe ||
            null,

          source_url:
            row.source_url ||
            row.url ||
            null,

          is_aggregate:
            Boolean(
              row.is_aggregate ||
              row.aggregate
            ),
        })
      )
    );

  return toolResult({
    tool:
      "get_latest_polling",

    ok:
      response.ok &&
      polls.length >
        0,

    summary:
      polls.length
        ? `Found ${polls.length} local fallback polling records.`
        : "No current polling records are available.",

    data: {
      state:
        state ||
        null,

      office:
        office ||
        null,

      candidate:
        candidate ||
        null,

      locality:
        locality ||
        null,

      polls,

      provider_priority:
        "local-fallback",
    },

    sources:
      polls.map(
        (
          poll
        ) => ({
          source:
            poll.pollster ||
            "Polling source",

          source_url:
            poll.source_url,

          published_at:
            poll.published_at ||
            poll.field_end ||
            null,

          reporting_period:
            poll.field_start &&
            poll.field_end
              ? `${poll.field_start} to ${poll.field_end}`
              : poll.field_end,

          fetched_at:
            now(),

          confidence:
            78,
        })
      ),

    warnings:
      uniqueWarnings([
        live?.warnings ||
          [],

        response.ok
          ? []
          : [
              "No polling_results, polls, or election_polls table is available.",
            ],
      ]),

    diagnostics:
      live?.diagnostics ||
      [],

    degraded:
      true,
  });
}

async function fecTool(
  args
) {
  const candidate =
    clean(
      args.candidate
    );

  const candidateId =
    clean(
      args.candidate_id
    );

  const committeeId =
    clean(
      args.committee_id
    );

  const cycle =
    clean(
      args.cycle
    );

  const live =
    await getOpenFecFinance({
      candidateId,
      committeeId,
      cycle,
    });

  if (
    live?.ok &&
    Array.isArray(
      live?.data?.records
    ) &&
    live.data.records.length
  ) {
    return toolResult({
      tool:
        "get_fec_finance",

      ok:
        true,

      summary:
        live.summary,

      data: {
        ...live.data,

        provider_priority:
          "openfec",
      },

      sources:
        live.sources ||
        [],

      warnings:
        live.warnings ||
        [],

      diagnostics:
        live.diagnostics ||
        [],

      degraded:
        Boolean(
          live.degraded
        ),
    });
  }

  const params =
    [];

  const conditions =
    [];

  if (
    candidate
  ) {
    params.push(
      `%${candidate}%`
    );

    conditions.push(
      `(
        COALESCE(candidate_name, '') ILIKE $${params.length}
        OR COALESCE(name, '') ILIKE $${params.length}
      )`
    );
  }

  if (
    candidateId
  ) {
    params.push(
      candidateId
    );

    conditions.push(
      `COALESCE(candidate_id, '') = $${params.length}`
    );
  }

  if (
    committeeId
  ) {
    params.push(
      committeeId
    );

    conditions.push(
      `COALESCE(committee_id, '') = $${params.length}`
    );
  }

  if (
    cycle
  ) {
    params.push(
      cycle
    );

    conditions.push(
      `CAST(COALESCE(cycle, election_cycle) AS text) = $${params.length}`
    );
  }

  const where =
    conditions.length
      ? `WHERE ${conditions.join(
          " AND "
        )}`
      : "";

  const response =
    await safeQuery(
      "fundraising_live",

      `
        SELECT *
        FROM fundraising_live
        ${where}
        ORDER BY
          COALESCE(
            coverage_end_date,
            source_updated_at,
            updated_at,
            created_at
          ) DESC
        LIMIT 20
      `,

      params
    );

  const records =
    response.rows.map(
      (
        row
      ) => ({
        candidate_name:
          row.candidate_name ||
          row.name ||
          candidate ||
          null,

        candidate_id:
          row.candidate_id ||
          candidateId ||
          null,

        committee_id:
          row.committee_id ||
          committeeId ||
          null,

        cycle:
          row.cycle ||
          row.election_cycle ||
          cycle ||
          null,

        total_receipts:
          row.total_receipts ??
          row.receipts ??
          row.contributions ??
          null,

        total_disbursements:
          row.total_disbursements ??
          row.disbursements ??
          row.spending ??
          null,

        cash_on_hand:
          row.cash_on_hand ??
          row.cash_on_hand_end_period ??
          null,

        debts:
          row.debts ??
          row.debts_owed_by_committee ??
          null,

        coverage_through_date:
          row.coverage_end_date ||
          row.coverage_through_date ||
          row.source_updated_at ||
          row.updated_at ||
          null,

        source_url:
          row.source_url ||
          null,
      })
    );

  return toolResult({
    tool:
      "get_fec_finance",

    ok:
      response.ok &&
      records.length >
        0,

    summary:
      records.length
        ? `Found ${records.length} local fallback finance records.`
        : "No campaign-finance record matched the request.",

    data: {
      records,

      provider_priority:
        "local-fallback",
    },

    sources:
      records.map(
        (
          record
        ) => ({
          source:
            "Federal Election Commission / VoterSpheres FEC Sync",

          source_url:
            record.source_url,

          reporting_period:
            record.coverage_through_date,

          fetched_at:
            now(),

          confidence:
            92,
        })
      ),

    warnings:
      uniqueWarnings([
        live?.warnings ||
          [],

        response.ok
          ? []
          : [
              response.error,
            ],
      ]),

    diagnostics:
      live?.diagnostics ||
      [],

    degraded:
      true,
  });
}

async function operationsTool(
  args,
  user
) {
  const firmId =
    getFirmId(
      user
    );

  const state =
    clean(
      args.state
    ).toUpperCase();

  const locality =
    clean(
      args.locality
    );

  const workspaceId =
    args.workspace_id ||
    null;

  const localityParams = [
    state,
  ];

  let localityWhere = `
    WHERE UPPER(
      COALESCE(
        state_code,
        state,
        ''
      )
    ) = $1
  `;

  if (
    locality
  ) {
    localityParams.push(
      `%${locality}%`
    );

    localityWhere += `
      AND (
        COALESCE(name, '') ILIKE $2
        OR COALESCE(locality_name, '') ILIKE $2
        OR COALESCE(county_name, '') ILIKE $2
      )
    `;
  }

  const taskParams = [
    firmId,
    state,
  ];

  let taskWhere = `
    WHERE firm_id = $1
      AND (
        UPPER(
          COALESCE(
            state,
            ''
          )
        ) = $2
        OR UPPER(
          COALESCE(
            metadata->>'state',
            ''
          )
        ) = $2
      )
  `;

  if (
    workspaceId
  ) {
    taskParams.push(
      workspaceId
    );

    taskWhere += `
      AND workspace_id = $3
    `;
  }

  const [
    localities,
    tasks,
    workspaces,
  ] =
    await Promise.all([
      safeQuery(
        "state_localities",

        `
          SELECT *
          FROM state_localities
          ${localityWhere}
          ORDER BY
            COALESCE(
              name,
              locality_name,
              county_name
            )
          LIMIT 500
        `,

        localityParams
      ),

      safeQuery(
        "state_tasks",

        `
          SELECT *
          FROM tasks
          ${taskWhere}
          ORDER BY
            updated_at DESC,
            created_at DESC
          LIMIT 200
        `,

        taskParams
      ),

      safeQuery(
        "state_workspaces",

        `
          SELECT *
          FROM workspaces
          WHERE firm_id = $1
            AND UPPER(
              COALESCE(
                state,
                ''
              )
            ) = $2
          ORDER BY
            updated_at DESC
          LIMIT 100
        `,

        [
          firmId,
          state,
        ]
      ),
    ]);

  return toolResult({
    tool:
      "get_state_operations",

    ok:
      localities.ok ||
      tasks.ok ||
      workspaces.ok,

    summary:
      `${state} operations include ${localities.rows.length} localities, ` +
      `${workspaces.rows.length} workspaces, and ${tasks.rows.length} tasks.`,

    data: {
      state,

      locality:
        locality ||
        null,

      localities:
        localities.rows,

      workspaces:
        workspaces.rows,

      tasks:
        tasks.rows,
    },

    sources: [
      {
        source:
          "VoterSpheres State Operations",

        fetched_at:
          now(),

        confidence:
          88,
      },

      {
        source:
          "U.S. Census locality import",

        reporting_period:
          localities.rows?.[0]
            ?.source_year ||
          localities.rows?.[0]
            ?.vintage ||
          null,

        fetched_at:
          now(),

        confidence:
          95,
      },
    ],

    warnings: [
      localities,
      tasks,
      workspaces,
    ]
      .filter(
        (
          item
        ) =>
          !item.ok
      )
      .map(
        (
          item
        ) =>
          `${item.key}: ${item.error}`
      ),

    degraded: [
      localities,
      tasks,
      workspaces,
    ].some(
      (
        item
      ) =>
        !item.ok
    ),
  });
}

async function candidateTool(
  args
) {
  const response =
    await resolveCandidateProfile(
      args
    );

  return toolResult({
    tool:
      "get_candidate_statistics",

    ok:
      response.ok &&
      response.rows.length >
        0,

    summary:
      response.rows.length
        ? `Found ${response.rows.length} candidate records.`
        : "No candidate record matched the request.",

    data: {
      candidates:
        response.rows,
    },

    sources: [
      {
        source:
          "VoterSpheres Candidate Database",

        published_at:
          response.rows?.[0]
            ?.updated_at ||
          response.rows?.[0]
            ?.created_at ||
          null,

        fetched_at:
          now(),

        confidence:
          90,
      },
    ],

    warnings:
      response.ok
        ? []
        : [
            response.error,
          ],

    degraded:
      !response.ok,
  });
}

export async function executeExecutiveVoiceTool({
  name,
  arguments: args = {},
  user = {},
} = {}) {
  switch (
    name
  ) {
    case "get_unified_executive_intelligence":
      return unifiedTool(
        args,
        user
      );

    case "search_live_news":
      return newsTool(
        args,
        user
      );

    case "get_candidate_live_intelligence":
      return candidateLiveTool(
        args,
        user
      );

    case "get_latest_polling":
      return pollingTool(
        args
      );

    case "get_fec_finance":
      return fecTool(
        args
      );

    case "get_legislative_updates": {
      const live =
        await getCongressUpdates(
          args
        );

      return toolResult({
        tool:
          name,

        ok:
          live.ok,

        summary:
          live.summary,

        data:
          live.data,

        sources:
          live.sources ||
          [],

        warnings:
          live.warnings ||
          [],

        diagnostics:
          live.diagnostics ||
          [],

        degraded:
          Boolean(
            live.degraded
          ),
      });
    }

    case "get_weather_field_risk": {
      const live =
        await getWeatherFieldRisk(
          args
        );

      return toolResult({
        tool:
          name,

        ok:
          live.ok,

        summary:
          live.summary,

        data:
          live.data,

        sources:
          live.sources ||
          [],

        warnings:
          live.warnings ||
          [],

        diagnostics:
          live.diagnostics ||
          [],

        degraded:
          Boolean(
            live.degraded
          ),
      });
    }

    case "get_election_administration_updates": {
      const live =
        await getElectionAdministrationUpdates(
          args
        );

      return toolResult({
        tool:
          name,

        ok:
          live.ok,

        summary:
          live.summary,

        data:
          live.data,

        sources:
          live.sources ||
          [],

        warnings:
          live.warnings ||
          [],

        diagnostics:
          live.diagnostics ||
          [],

        degraded:
          Boolean(
            live.degraded
          ),
      });
    }

    case "get_state_operations":
      return operationsTool(
        args,
        user
      );

    case "get_candidate_statistics":
      return candidateTool(
        args
      );

    default:
      return toolResult({
        tool:
          name ||
          "unknown",

        ok:
          false,

        summary:
          `Unknown Executive Voice tool: ${
            name ||
            "missing tool name"
          }.`,

        warnings: [
          "The requested tool is not registered.",
        ],

        degraded:
          true,
      });
  }
}
