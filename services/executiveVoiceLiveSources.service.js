import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const cache = new Map();

const now = () => new Date().toISOString();

const clean = (value = "") =>
  String(value || "").trim();

function clampLimit(
  value,
  fallback = 6,
  max = 25
) {
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
}

function getCached(key) {
  const entry = cache.get(key);

  if (
    !entry ||
    entry.expires_at <= Date.now()
  ) {
    cache.delete(key);
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
  cache.set(key, {
    value,
    expires_at:
      Date.now() + ttlMs,
  });

  return value;
}

async function fetchJson(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs || 12000
  );

  try {
    const response = await fetch(
      url,
      {
        method:
          options.method ||
          "GET",

        headers:
          options.headers ||
          {},

        body:
          options.body,

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
          ? JSON.parse(text)
          : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw new Error(
        payload?.message ||
          payload?.error ||
          `${response.status} ${response.statusText}`
      );
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function makeResult({
  provider,
  ok = true,
  summary = "",
  data = null,
  warnings = [],
  sources = [],
  degraded = false,
} = {}) {
  return {
    ok,
    provider,
    summary,
    data,
    warnings,
    sources,
    degraded,
    generated_at: now(),
  };
}

function sourceMeta({
  name,
  url = null,
  published_at = null,
  reporting_period = null,
  confidence = 85,
  freshness = "unknown",
  note = null,
} = {}) {
  return {
    name,
    url,
    fetched_at: now(),
    published_at,
    reporting_period,
    confidence,
    freshness,
    note,
  };
}

function parseWebResults(
  response,
  limit
) {
  const rows = [];
  const seen = new Set();

  for (
    const output
    of response?.output || []
  ) {
    for (
      const content
      of output?.content || []
    ) {
      const summary =
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

        if (
          !url ||
          seen.has(url)
        ) {
          continue;
        }

        seen.add(url);

        rows.push({
          title:
            annotation?.title ||
            annotation
              ?.url_citation
              ?.title ||
            "Current political report",

          url,

          summary:
            summary.slice(
              0,
              900
            ),
        });

        if (
          rows.length >=
          limit
        ) {
          return rows;
        }
      }
    }
  }

  return rows;
}

export async function searchCurrentPoliticalNews({
  query,
  state = "",
  locality = "",
  limit = 6,
} = {}) {
  const normalizedLimit =
    clampLimit(
      limit,
      6,
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
    return makeResult({
      provider:
        "openai_web_search",

      ok: false,

      summary:
        "Live web search is not configured.",

      warnings: [
        "OPENAI_API_KEY is missing on the backend.",
      ],

      degraded:
        true,
    });
  }

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
          `Find the newest reliable political reporting for ${[
            clean(query),
            clean(state),
            clean(locality),
          ]
            .filter(Boolean)
            .join(" ")}. ` +
          "Prefer official government sources, election administrators, " +
          "established newsrooms, pollsters, and campaign-finance authorities.",
      });

    const articles =
      parseWebResults(
        response,
        normalizedLimit
      );

    return setCached(
      key,

      makeResult({
        provider:
          "openai_web_search",

        ok:
          articles.length > 0,

        summary:
          articles.length
            ? `Found ${articles.length} current political reports.`
            : "No current political reports were found.",

        data: {
          articles,
        },

        sources:
          articles.map(
            (article) =>
              sourceMeta({
                name:
                  "OpenAI web search result",

                url:
                  article.url,

                confidence:
                  82,

                freshness:
                  "live-search",
              })
          ),
      }),

      5 * 60 * 1000
    );
  } catch (error) {
    return makeResult({
      provider:
        "openai_web_search",

      ok: false,

      summary:
        "Live political news search failed.",

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
      process.env.FEC_API_KEY
    );

  if (!apiKey) {
    return makeResult({
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

  if (
    !clean(candidateId) &&
    !clean(committeeId)
  ) {
    return makeResult({
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
    clean(committeeId)
      ? `https://api.open.fec.gov/v1/committee/${encodeURIComponent(
          clean(
            committeeId
          )
        )}/totals/?${params.toString()}`
      : `https://api.open.fec.gov/v1/candidate/${encodeURIComponent(
          clean(
            candidateId
          )
        )}/totals/?${params.toString()}`;

  try {
    const payload =
      await fetchJson(
        endpoint
      );

    const records =
      payload?.results ||
      [];

    return makeResult({
      provider:
        "openfec",

      ok:
        records.length > 0,

      summary:
        records.length
          ? `Found ${records.length} official FEC finance records.`
          : "No official FEC finance record matched the request.",

      data: {
        candidate_id:
          clean(candidateId) ||
          null,

        committee_id:
          clean(committeeId) ||
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

          freshness:
            "latest-official-filing",

          note:
            "FEC totals reflect the latest official filing period, not second-by-second activity.",
        }),
      ],
    });
  } catch (error) {
    return makeResult({
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
    return makeResult({
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
            clampLimit(
              limit,
              10,
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

    return makeResult({
      provider:
        "congress_gov",

      ok:
        bills.length > 0,

      summary:
        bills.length
          ? `Found ${bills.length} recent legislative updates.`
          : "No legislative updates matched the request.",

      data: {
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
              ?.updateDate ||
            null,

          confidence:
            96,

          freshness:
            "latest-official-update",
        }),
      ],
    });
  } catch (error) {
    return makeResult({
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
    return makeResult({
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
        `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
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
      makeResult({
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
              "https://api.weather.gov/",

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

            freshness:
              "live-official",
          }),
        ],
      });

    return setCached(
      key,
      output,
      5 * 60 * 1000
    );
  } catch (error) {
    return makeResult({
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
    return makeResult({
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
    const [key, value]
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

  const cacheId =
    `polling:${baseUrl}:${params.toString()}`;

  const cached =
    getCached(cacheId);

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

    const polls =
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

    const output =
      makeResult({
        provider:
          "polling_provider",

        ok:
          Array.isArray(
            polls
          ) &&
          polls.length > 0,

        summary:
          Array.isArray(
            polls
          ) &&
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
              polls?.[0]
                ?.published_at ||
              polls?.[0]
                ?.field_end ||
              polls?.[0]
                ?.updated_at ||
              null,

            confidence:
              84,

            freshness:
              "provider-latest",

            note:
              "Polling responses should include pollster, field dates, sample size, population, and margin of error when available.",
          }),
        ],
      });

    return setCached(
      cacheId,
      output,
      10 * 60 * 1000
    );
  } catch (error) {
    return makeResult({
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
      cache.size,

    generated_at:
      now(),
  };
}

export function clearExecutiveVoiceSourceCache() {
  cache.clear();

  return {
    ok: true,

    message:
      "Executive Voice live-source cache cleared.",

    generated_at:
      now(),
  };
}
