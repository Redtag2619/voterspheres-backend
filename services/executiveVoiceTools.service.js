import OpenAI from "openai";
import { pool } from "../db/pool.js";
import { getUnifiedExecutiveIntelligence } from "./unifiedExecutiveIntelligence.service.js";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const now = () => new Date().toISOString();

const clean = (value = "") =>
  String(value || "").trim();

const num = (value = 0) =>
  Number.isFinite(Number(value))
    ? Number(value)
    : 0;

const limitValue = (
  value,
  fallback = 5,
  max = 20
) => {
  const parsed = Number.parseInt(
    value,
    10
  );

  return Number.isFinite(parsed)
    ? Math.min(
        max,
        Math.max(1, parsed)
      )
    : fallback;
};

function firmId(user = {}) {
  return (
    user.firmId ||
    user.firm_id ||
    user.firm?.id ||
    null
  );
}

function freshness(value) {
  if (!value) {
    return "unknown";
  }

  const stamp =
    new Date(value).getTime();

  if (!Number.isFinite(stamp)) {
    return "unknown";
  }

  const age =
    Date.now() - stamp;

  if (age <= 3600000) {
    return "live";
  }

  if (age <= 86400000) {
    return "fresh";
  }

  if (age <= 604800000) {
    return "recent";
  }

  return "historical";
}

function sourceMeta({
  source,
  url = null,
  publishedAt = null,
  reportingPeriod = null,
  confidence = 85,
  modeled = false,
  note = null,
}) {
  return {
    source,
    source_url: url,
    fetched_at: now(),
    published_at:
      publishedAt,
    reporting_period:
      reportingPeriod,
    freshness: freshness(
      publishedAt ||
        reportingPeriod ||
        now()
    ),
    confidence:
      num(confidence),
    modeled:
      Boolean(modeled),
    note,
  };
}

function result({
  tool,
  ok = true,
  summary = "",
  data = null,
  sources = [],
  warnings = [],
  degraded = false,
}) {
  return {
    ok,
    tool,
    summary,
    data,
    sources,
    warnings,
    degraded,
    generated_at: now(),
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
      ok: true,
      rows:
        response.rows || [],
      error: null,
    };
  } catch (error) {
    console.warn(
      "[executive-voice-tools] " +
        key +
        " unavailable:",
      error.message
    );

    return {
      key,
      ok: false,
      rows: [],
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
        candidate.params || []
      );

    if (response.ok) {
      return response;
    }
  }

  return {
    key:
      candidates[0]?.key ||
      "unknown",
    ok: false,
    rows: [],
    error:
      "No compatible data source is available.",
  };
}

export const EXECUTIVE_VOICE_TOOL_DEFINITIONS =
  [
    {
      type: "function",
      name:
        "get_unified_executive_intelligence",
      description:
        "Get the current VoterSpheres executive operating picture, including health, workspaces, tasks, alerts, recommendations, and source freshness.",
      parameters: {
        type: "object",
        properties: {
          workspace_id: {
            type: [
              "number",
              "string",
              "null",
            ],
          },
          state: {
            type: "string",
          },
          office: {
            type: "string",
          },
          risk: {
            type: "string",
          },
        },
        additionalProperties:
          false,
      },
    },

    {
      type: "function",
      name:
        "search_live_news",
      description:
        "Search current political news and recent sourced articles. Use for latest, today, breaking, current coverage, or recent developments.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
          },
          state: {
            type: "string",
          },
          locality: {
            type: "string",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10,
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
      type: "function",
      name:
        "get_latest_polling",
      description:
        "Get the latest available polling for a candidate, race, state, office, or locality. Distinguish individual polls from aggregates.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
          },
          office: {
            type: "string",
          },
          candidate: {
            type: "string",
          },
          locality: {
            type: "string",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
          },
        },
        additionalProperties:
          false,
      },
    },

    {
      type: "function",
      name:
        "get_fec_finance",
      description:
        "Get the latest available official federal campaign-finance totals and reporting period for a candidate or committee.",
      parameters: {
        type: "object",
        properties: {
          candidate: {
            type: "string",
          },
          candidate_id: {
            type: "string",
          },
          committee_id: {
            type: "string",
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
      type: "function",
      name:
        "get_state_operations",
      description:
        "Get state, county, parish, workspace, task, and operational intelligence for a U.S. state or locality.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
          },
          locality: {
            type: "string",
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
      type: "function",
      name:
        "get_candidate_statistics",
      description:
        "Get current VoterSpheres candidate profile, race, contact, finance, and campaign statistics.",
      parameters: {
        type: "object",
        properties: {
          candidate: {
            type: "string",
          },
          candidate_id: {
            type: [
              "number",
              "string",
            ],
          },
          state: {
            type: "string",
          },
          office: {
            type: "string",
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
        clean(args.state),
      office:
        clean(args.office),
      risk:
        clean(args.risk),
    });

  return result({
    tool:
      "get_unified_executive_intelligence",

    summary:
      data?.briefing
        ?.strategic_summary ||
      "Unified executive intelligence loaded.",

    data,

    sources: [
      sourceMeta({
        source:
          "VoterSpheres Unified Executive Intelligence",

        publishedAt:
          data.generated_at,

        confidence:
          data?.health
            ?.intelligence_confidence ||
          80,
      }),
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

function webRows(
  response,
  maxRows
) {
  const rows = [];
  const seen = new Set();

  for (
    const item
    of response?.output || []
  ) {
    for (
      const content
      of item?.content || []
    ) {
      const text =
        clean(content?.text);

      for (
        const annotation
        of content?.annotations ||
        []
      ) {
        const url =
          annotation?.url ||
          annotation
            ?.url_citation
            ?.url ||
          null;

        const title =
          annotation?.title ||
          annotation
            ?.url_citation
            ?.title ||
          url;

        if (
          !url ||
          seen.has(url)
        ) {
          continue;
        }

        seen.add(url);

        rows.push({
          title:
            title ||
            "Current political report",

          url,

          summary:
            text.slice(
              0,
              700
            ),

          publisher: null,

          published_at:
            null,

          source_type:
            "openai_web_search",
        });

        if (
          rows.length >=
          maxRows
        ) {
          return rows;
        }
      }
    }
  }

  return rows;
}

async function databaseNews({
  query,
  state,
  locality,
  limit,
  user,
}) {
  const params = [
    "%" + query + "%",
  ];

  let where = `
    WHERE (
      COALESCE(title, '') ILIKE $1
      OR COALESCE(summary, '') ILIKE $1
      OR COALESCE(description, '') ILIKE $1
    )
  `;

  const resolvedFirmId =
    firmId(user);

  if (resolvedFirmId) {
    params.push(
      resolvedFirmId
    );

    where += `
      AND (
        firm_id = $${params.length}
        OR firm_id IS NULL
      )
    `;
  }

  if (state) {
    params.push(
      state.toUpperCase()
    );

    where += `
      AND UPPER(
        COALESCE(state, '')
      ) = $${params.length}
    `;
  }

  if (locality) {
    params.push(
      "%" + locality + "%"
    );

    where += `
      AND (
        COALESCE(county, '') ILIKE $${params.length}
        OR COALESCE(locality, '') ILIKE $${params.length}
        OR COALESCE(title, '') ILIKE $${params.length}
      )
    `;
  }

  params.push(limit);

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
    (row) => ({
      id: row.id,

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
    clean(args.query);

  const state =
    clean(args.state);

  const locality =
    clean(args.locality);

  const limit =
    limitValue(
      args.limit,
      5,
      10
    );

  const localRows =
    await databaseNews({
      query,
      state,
      locality,
      limit,
      user,
    });

  let currentRows = [];
  const warnings = [];

  if (openai) {
    try {
      const response =
        await openai.responses.create({
          model:
            process.env
              .OPENAI_WEB_SEARCH_MODEL ||
            "gpt-5-mini",

          tools: [
            {
              type:
                "web_search",
            },
          ],

          tool_choice:
            "auto",

          input:
            "Find the newest reliable political reporting for " +
            [
              query,
              state,
              locality,
            ]
              .filter(Boolean)
              .join(" ") +
            ". Prefer official sources, established newsrooms, pollsters, election administrators, and campaign-finance authorities. Return a concise sourced briefing.",
        });

      currentRows =
        webRows(
          response,
          limit
        );
    } catch (error) {
      warnings.push(
        "OpenAI web search unavailable: " +
          error.message
      );
    }
  } else {
    warnings.push(
      "OPENAI_API_KEY is not configured for live web search."
    );
  }

  const articles = [
    ...currentRows,
    ...localRows,
  ]
    .filter(
      (
        row,
        index,
        array
      ) =>
        array.findIndex(
          (candidate) =>
            clean(
              candidate.url ||
                candidate.title
            ).toLowerCase() ===
            clean(
              row.url ||
                row.title
            ).toLowerCase()
        ) === index
    )
    .slice(
      0,
      limit
    );

  return result({
    tool:
      "search_live_news",

    ok:
      articles.length >
      0,

    summary:
      articles.length
        ? "Found " +
          articles.length +
          " current political reports for " +
          query +
          "."
        : "No current reports were found for " +
          query +
          ".",

    data: {
      query,
      state:
        state || null,
      locality:
        locality || null,
      articles,
    },

    sources:
      articles.map(
        (article) =>
          sourceMeta({
            source:
              article.publisher ||
              article.source_type ||
              "Current political news",

            url:
              article.url,

            publishedAt:
              article.published_at,

            confidence:
              article.score ||
              82,
          })
      ),

    warnings,

    degraded:
      warnings.length >
      0,
  });
}

async function pollingTool(
  args
) {
  const state =
    clean(args.state);

  const office =
    clean(args.office);

  const candidate =
    clean(args.candidate);

  const locality =
    clean(args.locality);

  const limit =
    limitValue(
      args.limit,
      10,
      20
    );

  const params = [];
  const conditions = [];

  const like = (
    column,
    value
  ) => {
    if (!value) {
      return;
    }

    params.push(
      "%" + value + "%"
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

  params.push(limit);

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
        key: "polls",

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
    response.rows.map(
      (row) => ({
        id: row.id,

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
    );

  return result({
    tool:
      "get_latest_polling",

    ok:
      response.ok &&
      polls.length > 0,

    summary:
      polls.length
        ? "Found " +
          polls.length +
          " latest available polling records."
        : "No compatible polling records are currently available.",

    data: {
      state:
        state || null,
      office:
        office || null,
      candidate:
        candidate || null,
      locality:
        locality || null,
      polls,
    },

    sources:
      polls.map(
        (poll) =>
          sourceMeta({
            source:
              poll.pollster ||
              "Polling source",

            url:
              poll.source_url,

            publishedAt:
              poll.published_at ||
              poll.field_end,

            reportingPeriod:
              poll.field_start &&
              poll.field_end
                ? poll.field_start +
                  " to " +
                  poll.field_end
                : poll.field_end,

            confidence: 80,

            note:
              poll.is_aggregate
                ? "Polling aggregate."
                : "Individual poll; do not treat as a definitive forecast.",
          })
      ),

    warnings:
      response.ok
        ? []
        : [
            "No polling_results, polls, or election_polls table is available. Configure a polling provider and ingestion pipeline.",
          ],

    degraded:
      !response.ok,
  });
}

async function fecTool(
  args
) {
  const candidate =
    clean(args.candidate);

  const candidateId =
    clean(
      args.candidate_id
    );

  const committeeId =
    clean(
      args.committee_id
    );

  const cycle =
    clean(args.cycle);

  const params = [];
  const conditions = [];

  if (candidate) {
    params.push(
      "%" +
        candidate +
        "%"
    );

    conditions.push(
      `(COALESCE(candidate_name, '') ILIKE $${params.length} OR COALESCE(name, '') ILIKE $${params.length})`
    );
  }

  if (candidateId) {
    params.push(
      candidateId
    );

    conditions.push(
      `COALESCE(candidate_id, '') = $${params.length}`
    );
  }

  if (committeeId) {
    params.push(
      committeeId
    );

    conditions.push(
      `COALESCE(committee_id, '') = $${params.length}`
    );
  }

  if (cycle) {
    params.push(cycle);

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
      (row) => ({
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

  return result({
    tool:
      "get_fec_finance",

    ok:
      response.ok &&
      records.length > 0,

    summary:
      records.length
        ? "Found " +
          records.length +
          " latest available campaign-finance records."
        : "No campaign-finance record matched the request.",

    data: {
      records,
    },

    sources:
      records.map(
        (record) =>
          sourceMeta({
            source:
              "Federal Election Commission / VoterSpheres FEC Sync",

            url:
              record.source_url,

            reportingPeriod:
              record.coverage_through_date,

            confidence:
              95,

            note:
              "Official filing data reflects the latest available reporting period and is not necessarily real-time.",
          })
      ),

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

async function operationsTool(
  args,
  user
) {
  const resolvedFirmId =
    firmId(user);

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

  if (locality) {
    localityParams.push(
      "%" +
        locality +
        "%"
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
    resolvedFirmId,
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

  if (workspaceId) {
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
  ] = await Promise.all([
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
        resolvedFirmId,
        state,
      ]
    ),
  ]);

  return result({
    tool:
      "get_state_operations",

    ok:
      localities.ok ||
      tasks.ok ||
      workspaces.ok,

    summary:
      state +
      " operations include " +
      localities.rows.length +
      " localities, " +
      workspaces.rows.length +
      " workspaces, and " +
      tasks.rows.length +
      " tasks.",

    data: {
      state,
      locality:
        locality || null,
      localities:
        localities.rows,
      workspaces:
        workspaces.rows,
      tasks:
        tasks.rows,
    },

    sources: [
      sourceMeta({
        source:
          "VoterSpheres State Operations",

        publishedAt:
          now(),

        confidence:
          88,
      }),

      sourceMeta({
        source:
          "U.S. Census locality import",

        reportingPeriod:
          localities.rows?.[0]
            ?.source_year ||
          localities.rows?.[0]
            ?.vintage ||
          null,

        confidence:
          95,
      }),
    ],

    warnings: [
      localities,
      tasks,
      workspaces,
    ]
      .filter(
        (item) =>
          !item.ok
      )
      .map(
        (item) =>
          item.key +
          ": " +
          item.error
      ),

    degraded: [
      localities,
      tasks,
      workspaces,
    ].some(
      (item) =>
        !item.ok
    ),
  });
}

async function candidateTool(
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

  const params = [];
  const conditions = [];

  if (candidateId) {
    params.push(
      candidateId
    );

    conditions.push(
      `CAST(id AS text) = $${params.length}`
    );
  }

  if (candidate) {
    params.push(
      "%" +
        candidate +
        "%"
    );

    conditions.push(
      `(COALESCE(name, '') ILIKE $${params.length} OR COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') ILIKE $${params.length})`
    );
  }

  if (state) {
    params.push(
      state.toUpperCase()
    );

    conditions.push(
      `UPPER(COALESCE(state, '')) = $${params.length}`
    );
  }

  if (office) {
    params.push(
      "%" +
        office +
        "%"
    );

    conditions.push(
      `COALESCE(office, '') ILIKE $${params.length}`
    );
  }

  if (cycle) {
    params.push(cycle);

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

  const response =
    await safeQuery(
      "candidates",
      `
        SELECT *
        FROM candidates
        ${where}
        ORDER BY
          updated_at DESC
        LIMIT 20
      `,
      params
    );

  return result({
    tool:
      "get_candidate_statistics",

    ok:
      response.ok &&
      response.rows.length >
        0,

    summary:
      response.rows.length
        ? "Found " +
          response.rows.length +
          " candidate records."
        : "No candidate record matched the request.",

    data: {
      candidates:
        response.rows,
    },

    sources: [
      sourceMeta({
        source:
          "VoterSpheres Candidate Database",

        publishedAt:
          response.rows?.[0]
            ?.updated_at ||
          response.rows?.[0]
            ?.created_at ||
          null,

        confidence:
          90,
      }),
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
  switch (name) {
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

    case "get_latest_polling":
      return pollingTool(
        args
      );

    case "get_fec_finance":
      return fecTool(
        args
      );

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
      return result({
        tool:
          name ||
          "unknown",

        ok: false,

        summary:
          "Unknown Executive Voice tool: " +
          (
            name ||
            "missing tool name"
          ) +
          ".",

        warnings: [
          "The requested tool is not registered.",
        ],

        degraded:
          true,
      });
  }
}
