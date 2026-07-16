import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const CACHE = new Map();

const now = () =>
  new Date().toISOString();

const clean = (value = "") =>
  String(value || "").trim();

function clamp(
  value,
  fallback = 6,
  min = 1,
  max = 25
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

function freshness(
  value
) {
  const stamp =
    timestamp(value);

  if (!stamp) {
    return "unknown";
  }

  const age =
    Date.now() - stamp;

  const hour =
    60 * 60 * 1000;

  const day =
    24 * hour;

  if (age <= hour) {
    return "live";
  }

  if (age <= day) {
    return "fresh";
  }

  if (age <= 7 * day) {
    return "recent";
  }

  return "historical";
}

function getCached(
  key
) {
  const entry =
    CACHE.get(key);

  if (
    !entry ||
    entry.expires_at <=
      Date.now()
  ) {
    CACHE.delete(key);
    return null;
  }

  return {
    ...entry.value,
    cached: true,
  };
}

function setCached(
  key,
  value,
  ttlMs
) {
  CACHE.set(key, {
    value,

    expires_at:
      Date.now() +
      ttlMs,
  });

  return value;
}

async function fetchJson(
  url,
  {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 12000,
  } = {}
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method,
          headers,
          body,

          signal:
            controller.signal,
        }
      );

    const text =
      await response.text();

    let payload;

    try {
      payload =
        text
          ? JSON.parse(
              text
            )
          : null;
    } catch {
      payload = text;
    }

    if (
      !response.ok
    ) {
      throw new Error(
        payload?.message ||
          payload?.error ||
          `${response.status} ${response.statusText}`
      );
    }

    return payload;
  } finally {
    clearTimeout(
      timer
    );
  }
}

function sourceMeta({
  name,
  url = null,
  published_at = null,
  reporting_period = null,
  confidence = 85,
  note = null,
} = {}) {
  return {
    name,
    url,

    fetched_at:
      now(),

    published_at,

    reporting_period,

    freshness:
      freshness(
        published_at ||
          reporting_period
      ),

    confidence,

    note,
  };
}

function result({
  provider,
  ok = true,
  summary = "",
  data = null,
  sources = [],
  warnings = [],
  degraded = false,
} = {}) {
  return {
    ok,
    provider,
    summary,
    data,
    sources,
    warnings,
    degraded,

    generated_at:
      now(),
  };
}

function safeJson(
  value
) {
  try {
    return JSON.parse(
      value
    );
  } catch {
    return null;
  }
}

function sortByNewest(
  rows = []
) {
  return [
    ...rows,
  ].sort(
    (a, b) =>
      timestamp(
        b.published_at ||
          b.field_end ||
          b.updated_at
      ) -
      timestamp(
        a.published_at ||
          a.field_end ||
          a.updated_at
      )
  );
}

function normalizeArticle(
  article = {}
) {
  return {
    title:
      clean(
        article.title
      ),

    publisher:
      clean(
        article.publisher
      ) ||
      null,

    published_at:
      clean(
        article.published_at
      ) ||
      null,

    url:
      clean(
        article.url
      ),

    summary:
      clean(
        article.summary
      ),

    source_type:
      article.source_type ||
      "public_web",
  };
}

export async function searchCurrentPoliticalNews({
  query,
  state = "",
  locality = "",
  limit = 6,
} = {}) {
  const normalizedLimit =
    clamp(
      limit,
      6,
      1,
      10
    );

  const key =
    `news:${JSON.stringify({
      query:
        clean(query),

      state:
        clean(state),

      locality:
        clean(locality),

      limit:
        normalizedLimit,
    })}`;

  const cached =
    getCached(key);

  if (cached) {
    return cached;
  }

  if (!openai) {
    return result({
      provider:
        "openai_web_search",

      ok: false,

      summary:
        "Live public web search is not configured.",

      warnings: [
        "OPENAI_API_KEY is missing on the backend.",
      ],

      degraded:
        true,
    });
  }

  try {
    const today =
      new Date()
        .toISOString()
        .slice(
          0,
          10
        );

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
          "Search the public web for the newest reliable political reporting. " +
          `Topic: ${clean(query)}. ` +
          `State: ${clean(state) || "any"}. ` +
          `Locality: ${clean(locality) || "any"}. ` +
          `Today is ${today}. ` +
          "Prefer articles published during the last 24 hours, then the last 7 days. " +
          "Prefer official government sources, election administrators, established newsrooms, " +
          "pollsters, campaigns, and campaign-finance authorities. " +
          "Do not return old background articles when newer reporting exists. " +
          "Return ONLY valid JSON with this exact shape: " +
          '{"articles":[{"title":"","publisher":"","published_at":"","url":"","summary":""}]}. ' +
          "Use ISO-8601 publication dates when available. Do not include markdown.",
      });

    const parsed =
      safeJson(
        response.output_text ||
          ""
      );

    const articles =
      sortByNewest(
        Array.isArray(
          parsed?.articles
        )
          ? parsed.articles
          : []
      )
        .map(
          normalizeArticle
        )
        .filter(
          (article) =>
            article.title &&
            article.url
        )
        .slice(
          0,
          normalizedLimit
        );

    const output =
      result({
        provider:
          "openai_web_search",

        ok:
          articles.length >
          0,

        summary:
          articles.length
            ? `Found ${articles.length} current public political reports.`
            : "No current public political reports were returned.",

        data: {
          query:
            clean(query),

          state:
            clean(state) ||
            null,

          locality:
            clean(locality) ||
            null,

          articles,
        },

        sources:
          articles.map(
            (article) =>
              sourceMeta({
                name:
                  article.publisher ||
                  "Public web source",

                url:
                  article.url,

                published_at:
                  article.published_at,

                confidence:
                  article.published_at
                    ? 88
                    : 74,

                note:
                  article.published_at
                    ? "Publication date supplied by the public source."
                    : "Publication date was unavailable; freshness is uncertain.",
              })
          ),

        warnings:
          articles.some(
            (article) =>
              !article.published_at
          )
            ? [
                "Some public articles did not include a verifiable publication timestamp.",
              ]
            : [],

        degraded:
          articles.length ===
          0,
      });

    return setCached(
      key,
      output,
      5 * 60 * 1000
    );
  } catch (error) {
    return result({
      provider:
        "openai_web_search",

      ok: false,

      summary:
        "Live public political news search failed.",

      warnings: [
        error.message,
      ],

      degraded:
        true,
    });
  }
}

export async function getOpenFecFinance({
  candidateId = "",
  committeeId = "",
  cycle = "",
} = {}) {
  const apiKey =
    clean(
      process.env
        .FEC_API_KEY
    );

  if (!apiKey) {
    return result({
      provider:
        "openfec",

      ok: false,

      summary:
        "OpenFEC is not configured.",

      warnings: [
        "FEC_API_KEY is missing.",
      ],

      degraded:
        true,
    });
  }

  const candidate =
    clean(candidateId);

  const committee =
    clean(committeeId);

  if (
    !candidate &&
    !committee
  ) {
    return result({
      provider:
        "openfec",

      ok: false,

      summary:
        "A candidate ID or committee ID is required.",

      warnings: [
        "Provide candidate_id or committee_id.",
      ],

      degraded:
        true,
    });
  }

  const key =
    `fec:${candidate}:${committee}:${clean(
      cycle
    )}`;

  const cached =
    getCached(key);

  if (cached) {
    return cached;
  }

  const params =
    new URLSearchParams({
      api_key:
        apiKey,

      per_page:
        "20",
    });

  if (clean(cycle)) {
    params.set(
      "cycle",
      clean(cycle)
    );
  }

  const endpoint =
    committee
      ? `https://api.open.fec.gov/v1/committee/${encodeURIComponent(
          committee
        )}/totals/?${params.toString()}`
      : `https://api.open.fec.gov/v1/candidate/${encodeURIComponent(
          candidate
        )}/totals/?${params.toString()}`;

  try {
    const payload =
      await fetchJson(
        endpoint
      );

    const records =
      payload?.results ||
      [];

    const output =
      result({
        provider:
          "openfec",

        ok:
          records.length >
          0,

        summary:
          records.length
            ? `Found ${records.length} official FEC finance records.`
            : "No official FEC finance record matched the request.",

        data: {
          candidate_id:
            candidate ||
            null,

          committee_id:
            committee ||
            null,

          cycle:
            clean(cycle) ||
            null,

          records,
        },

        sources: [
          sourceMeta({
            name:
              "Federal Election Commission OpenFEC API",

            url:
              "https://api.open.fec.gov/",

            reporting_period:
              records[0]
                ?.coverage_end_date ||
              records[0]
                ?.coverage_start_date ||
              clean(cycle) ||
              null,

            confidence:
              97,

            note:
              "Official filing data reflects the latest available filing period, not second-by-second activity.",
          }),
        ],
      });

    return setCached(
      key,
      output,
      15 * 60 * 1000
    );
  } catch (error) {
    return result({
      provider:
        "openfec",

      ok: false,

      summary:
        "OpenFEC finance lookup failed.",

      warnings: [
        error.message,
      ],

      degraded:
        true,
    });
  }
}

export async function getCongressUpdates({
  query = "",
  limit = 10,
} = {}) {
  const apiKey =
    clean(
      process.env
        .CONGRESS_API_KEY
    );

  if (!apiKey) {
    return result({
      provider:
        "congress_gov",

      ok: false,

      summary:
        "Congress.gov is not configured.",

      warnings: [
        "CONGRESS_API_KEY is missing.",
      ],

      degraded:
        true,
    });
  }

  try {
    const params =
      new URLSearchParams({
        api_key:
          apiKey,

        format:
          "json",

        limit:
          String(
            clamp(
              limit,
              10,
              1,
              25
            )
          ),

        sort:
          "updateDate+desc",
      });

    const payload =
      await fetchJson(
        `https://api.congress.gov/v3/bill?${params.toString()}`
      );

    let bills =
      payload?.bills ||
      [];

    const needle =
      clean(query)
        .toLowerCase();

    if (needle) {
      bills =
        bills.filter(
          (bill) =>
            [
              bill.title,
              bill.type,
              bill.number,
              bill.latestAction
                ?.text,
            ]
              .filter(Boolean)
              .some(
                (value) =>
                  String(value)
                    .toLowerCase()
                    .includes(
                      needle
                    )
              )
        );
    }

    bills =
      sortByNewest(
        bills.map(
          (bill) => ({
            ...bill,

            published_at:
              bill.updateDate ||
              bill.latestAction
                ?.actionDate ||
              null,
          })
        )
      );

    return result({
      provider:
        "congress_gov",

      ok:
        bills.length >
        0,

      summary:
        bills.length
          ? `Found ${bills.length} recent legislative updates.`
          : "No legislative updates matched the request.",

      data: {
        query:
          clean(query) ||
          null,

        bills,
      },

      sources: [
        sourceMeta({
          name:
            "Congress.gov API",

          url:
            "https://api.congress.gov/",

          published_at:
            bills[0]
              ?.published_at ||
            null,

          confidence:
            96,

          note:
            "Official legislative updates from Congress.gov.",
        }),
      ],

      degraded:
        false,
    });
  } catch (error) {
    return result({
      provider:
        "congress_gov",

      ok: false,

      summary:
        "Congress.gov lookup failed.",

      warnings: [
        error.message,
      ],

      degraded:
        true,
    });
  }
}

export async function getWeatherFieldRisk({
  latitude,
  longitude,
  location = "",
} = {}) {
  const lat =
    Number(latitude);

  const lon =
    Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return result({
      provider:
        "nws",

      ok: false,

      summary:
        "Latitude and longitude are required.",

      warnings: [
        "Provide numeric latitude and longitude.",
      ],

      degraded:
        true,
    });
  }

  const key =
    `weather:${lat}:${lon}`;

  const cached =
    getCached(key);

  if (cached) {
    return cached;
  }

  const headers = {
    Accept:
      "application/geo+json",

    "User-Agent":
      process.env
        .NWS_USER_AGENT ||
      "VoterSpheres/1.0 contact@voterspheres.org",
  };

  try {
    const point =
      await fetchJson(
        `https://api.weather.gov/points/${lat},${lon}`,
        {
          headers,
        }
      );

    const forecastUrl =
      point?.properties
        ?.forecast;

    const alertsUrl =
      `https://api.weather.gov/alerts/active?point=${lat},${lon}`;

    const [
      forecast,
      alerts,
    ] = await Promise.all([
      forecastUrl
        ? fetchJson(
            forecastUrl,
            {
              headers,
            }
          )
        : Promise.resolve(
            null
          ),

      fetchJson(
        alertsUrl,
        {
          headers,
        }
      ),
    ]);

    const alertRows =
      alerts?.features ||
      [];

    const periods =
      forecast?.properties
        ?.periods ||
      [];

    const severeTerms = [
      "tornado",
      "hurricane",
      "severe thunderstorm",
      "flash flood",
      "winter storm",
      "ice storm",
      "extreme heat",
      "high wind",
    ];

    const severeCount =
      alertRows.filter(
        (alert) =>
          severeTerms.some(
            (term) =>
              clean(
                alert
                  ?.properties
                  ?.event
              )
                .toLowerCase()
                .includes(
                  term
                )
          )
      ).length;

    const riskLevel =
      severeCount
        ? "High"
        : alertRows.length
          ? "Elevated"
          : "Stable";

    const output =
      result({
        provider:
          "nws",

        ok: true,

        summary:
          `${location || `${lat}, ${lon}`} field risk is ${riskLevel}. ` +
          `${alertRows.length} active alerts are present.`,

        data: {
          location:
            location ||
            null,

          latitude:
            lat,

          longitude:
            lon,

          risk_level:
            riskLevel,

          active_alerts:
            alertRows,

          forecast_periods:
            periods.slice(
              0,
              6
            ),
        },

        sources: [
          sourceMeta({
            name:
              "National Weather Service",

            url:
              forecastUrl ||
              alertsUrl,

            published_at:
              forecast
                ?.properties
                ?.updated ||
              alertRows[0]
                ?.properties
                ?.sent ||
              null,

            confidence:
              97,

            note:
              "Live official weather alerts and forecast data.",
          }),
        ],
      });

    return setCached(
      key,
      output,
      5 * 60 * 1000
    );
  } catch (error) {
    return result({
      provider:
        "nws",

      ok: false,

      summary:
        "National Weather Service lookup failed.",

      warnings: [
        error.message,
      ],

      degraded:
        true,
    });
  }
}

export async function getPollingProviderData(
  args = {}
) {
  const baseUrl =
    clean(
      process.env
        .POLLING_PROVIDER_URL
    );

  const apiKey =
    clean(
      process.env
        .POLLING_PROVIDER_API_KEY
    );

  if (!baseUrl) {
    return result({
      provider:
        "polling_provider",

      ok: false,

      summary:
        "No external polling provider is configured.",

      warnings: [
        "POLLING_PROVIDER_URL is missing.",
      ],

      degraded:
        true,
    });
  }

  const params =
    new URLSearchParams();

  for (
    const [
      key,
      value,
    ]
    of Object.entries(
      args || {}
    )
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      params.set(
        key,
        String(value)
      );
    }
  }

  const cacheKey =
    `polling:${baseUrl}:${params.toString()}`;

  const cached =
    getCached(
      cacheKey
    );

  if (cached) {
    return cached;
  }

  try {
    const separator =
      baseUrl.includes("?")
        ? "&"
        : "?";

    const payload =
      await fetchJson(
        `${baseUrl}${separator}${params.toString()}`,
        {
          headers: {
            Accept:
              "application/json",

            ...(apiKey
              ? {
                  Authorization:
                    `Bearer ${apiKey}`,
                }
              : {}),
          },
        }
      );

    const rawPolls =
      payload?.polls ||
      payload?.results ||
      payload?.data ||
      (
        Array.isArray(
          payload
        )
          ? payload
          : []
      );

    const polls =
      sortByNewest(
        Array.isArray(
          rawPolls
        )
          ? rawPolls
          : []
      );

    const output =
      result({
        provider:
          "polling_provider",

        ok:
          polls.length >
          0,

        summary:
          polls.length
            ? `Found ${polls.length} external polling records.`
            : "No external polling records matched the request.",

        data: {
          polls,
        },

        sources: [
          sourceMeta({
            name:
              process.env
                .POLLING_PROVIDER_NAME ||
              "Configured polling provider",

            url:
              baseUrl,

            published_at:
              polls[0]
                ?.published_at ||
              polls[0]
                ?.field_end ||
              polls[0]
                ?.updated_at ||
              null,

            confidence:
              84,

            note:
              "Polling responses should include pollster, field dates, sample size, population, and margin of error when available.",
          }),
        ],

        warnings:
          polls.some(
            (poll) =>
              !poll.field_end &&
              !poll.published_at
          )
            ? [
                "Some polling records did not include field dates or publication dates.",
              ]
            : [],

        degraded:
          polls.length ===
          0,
      });

    return setCached(
      cacheKey,
      output,
      10 * 60 * 1000
    );
  } catch (error) {
    return result({
      provider:
        "polling_provider",

      ok: false,

      summary:
        "External polling-provider lookup failed.",

      warnings: [
        error.message,
      ],

      degraded:
        true,
    });
  }
}

export async function getElectionAdministrationUpdates(
  args = {}
) {
  return searchCurrentPoliticalNews({
    query:
      clean(args.query) ||
      "election administration election officials voting systems deadlines",

    state:
      args.state,

    locality:
      args.locality,

    limit:
      args.limit,
  });
}

export async function getExecutiveVoiceSourceHealth() {
  const providers = [
    {
      id:
        "openai_web_search",

      configured:
        Boolean(
          process.env
            .OPENAI_API_KEY
        ),

      required_env: [
        "OPENAI_API_KEY",
      ],
    },

    {
      id:
        "openfec",

      configured:
        Boolean(
          process.env
            .FEC_API_KEY
        ),

      required_env: [
        "FEC_API_KEY",
      ],
    },

    {
      id:
        "congress_gov",

      configured:
        Boolean(
          process.env
            .CONGRESS_API_KEY
        ),

      required_env: [
        "CONGRESS_API_KEY",
      ],
    },

    {
      id:
        "nws",

      configured:
        true,

      required_env:
        [],
    },

    {
      id:
        "polling_provider",

      configured:
        Boolean(
          process.env
            .POLLING_PROVIDER_URL
        ),

      required_env: [
        "POLLING_PROVIDER_URL",
      ],
    },

    {
      id:
        "election_administration",

      configured:
        Boolean(
          process.env
            .OPENAI_API_KEY
        ),

      required_env: [
        "OPENAI_API_KEY",
      ],
    },
  ];

  return {
    ok: true,

    providers,

    configured_count:
      providers.filter(
        (item) =>
          item.configured
      ).length,

    total_count:
      providers.length,

    cache_entries:
      CACHE.size,

    generated_at:
      now(),
  };
}

export function clearExecutiveVoiceSourceCache() {
  CACHE.clear();

  return {
    ok: true,

    message:
      "Executive Voice live-source cache cleared.",

    generated_at:
      now(),
  };
}
