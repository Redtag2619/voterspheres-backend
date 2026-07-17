import OpenAI from "openai";

/*
 * =========================================================
 * Executive Voice Live Sources
 * Build 3.5.1
 * =========================================================
 *
 * Features:
 * - Hard OpenAI SDK timeout
 * - No automatic OpenAI retries
 * - Per-provider timeout protection
 * - Parallel live-news providers
 * - Partial-result success
 * - Fresh and stale cache layers
 * - Provider latency diagnostics
 * - Newest-first sorting
 * - Article deduplication
 * - OpenFEC, Congress.gov, NWS, polling support
 */

const DEFAULT_TIMEOUT_MS =
  Number(
    process.env.EXECUTIVE_VOICE_PROVIDER_TIMEOUT_MS
  ) || 6000;

const OPENAI_SDK_TIMEOUT_MS =
  Number(
    process.env.EXECUTIVE_VOICE_OPENAI_SDK_TIMEOUT_MS
  ) || 6500;

const OPENAI_TIMEOUT_MS =
  Number(
    process.env.EXECUTIVE_VOICE_OPENAI_TIMEOUT_MS
  ) || 7000;

const NEWS_CACHE_TTL_MS =
  Number(
    process.env.EXECUTIVE_VOICE_NEWS_CACHE_TTL_MS
  ) || 60 * 1000;

const NEWS_STALE_TTL_MS =
  Number(
    process.env.EXECUTIVE_VOICE_NEWS_STALE_TTL_MS
  ) || 30 * 60 * 1000;

const OFFICIAL_CACHE_TTL_MS =
  Number(
    process.env.EXECUTIVE_VOICE_OFFICIAL_CACHE_TTL_MS
  ) || 5 * 60 * 1000;

const OFFICIAL_STALE_TTL_MS =
  Number(
    process.env.EXECUTIVE_VOICE_OFFICIAL_STALE_TTL_MS
  ) || 60 * 60 * 1000;

const POLLING_CACHE_TTL_MS =
  Number(
    process.env.EXECUTIVE_VOICE_POLLING_CACHE_TTL_MS
  ) || 5 * 60 * 1000;

const WEATHER_CACHE_TTL_MS =
  Number(
    process.env.EXECUTIVE_VOICE_WEATHER_CACHE_TTL_MS
  ) || 2 * 60 * 1000;

const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY,

        /*
         * Prevent the SDK from waiting for its normal,
         * much longer default timeout.
         */
        timeout:
          OPENAI_SDK_TIMEOUT_MS,

        /*
         * Retries can multiply latency. The unified
         * engine already has provider fallback.
         */
        maxRetries:
          0,
      })
    : null;

const CACHE =
  new Map();

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
  fallback = 6,
  min = 1,
  max = 25
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      parsed
    )
  );
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

function normalizeDate(
  value
) {
  const stamp =
    timestamp(
      value
    );

  if (!stamp) {
    return null;
  }

  return new Date(
    stamp
  ).toISOString();
}

function freshness(
  value
) {
  const stamp =
    timestamp(
      value
    );

  if (!stamp) {
    return "unknown";
  }

  const age =
    Date.now() -
    stamp;

  const hour =
    60 * 60 * 1000;

  const day =
    24 * hour;

  if (
    age <=
    hour
  ) {
    return "live";
  }

  if (
    age <=
    day
  ) {
    return "fresh";
  }

  if (
    age <=
    7 * day
  ) {
    return "recent";
  }

  return "historical";
}

function elapsedMs(
  startedAt
) {
  return Math.max(
    0,
    Date.now() -
      startedAt
  );
}

function errorMessage(
  error
) {
  if (
    error?.name ===
    "AbortError"
  ) {
    return "Provider request timed out.";
  }

  return (
    error?.message ||
    String(
      error ||
        "Unknown provider error."
    )
  );
}

function createTimeoutError(
  label,
  timeoutMs
) {
  const error =
    new Error(
      `${label} timed out after ${timeoutMs}ms.`
    );

  error.code =
    "PROVIDER_TIMEOUT";

  error.provider =
    label;

  error.timeout_ms =
    timeoutMs;

  return error;
}

async function withTimeout(
  promise,
  timeoutMs =
    DEFAULT_TIMEOUT_MS,
  label =
    "External provider"
) {
  let timer;

  const timeoutPromise =
    new Promise(
      (
        _resolve,
        reject
      ) => {
        timer =
          setTimeout(
            () => {
              reject(
                createTimeoutError(
                  label,
                  timeoutMs
                )
              );
            },
            timeoutMs
          );
      }
    );

  try {
    return await Promise.race([
      promise,
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(
      timer
    );
  }
}

function getCacheEntry(
  key
) {
  return (
    CACHE.get(
      key
    ) ||
    null
  );
}

function getFreshCached(
  key
) {
  const entry =
    getCacheEntry(
      key
    );

  if (
    !entry ||
    entry.expires_at <=
      Date.now()
  ) {
    return null;
  }

  return {
    ...entry.value,

    cached:
      true,

    stale:
      false,

    cache_age_ms:
      Date.now() -
      entry.created_at,
  };
}

function getStaleCached(
  key
) {
  const entry =
    getCacheEntry(
      key
    );

  if (
    !entry ||
    entry.stale_expires_at <=
      Date.now()
  ) {
    if (entry) {
      CACHE.delete(
        key
      );
    }

    return null;
  }

  return {
    ...entry.value,

    cached:
      true,

    stale:
      true,

    degraded:
      true,

    cache_age_ms:
      Date.now() -
      entry.created_at,

    warnings: [
      ...(
        entry.value
          ?.warnings ||
        []
      ),

      "Live providers were unavailable; returning the most recent cached intelligence.",
    ],
  };
}

function setCached(
  key,
  value,
  ttlMs,
  staleTtlMs =
    ttlMs * 6
) {
  const createdAt =
    Date.now();

  CACHE.set(
    key,
    {
      value,

      created_at:
        createdAt,

      expires_at:
        createdAt +
        ttlMs,

      stale_expires_at:
        createdAt +
        Math.max(
          staleTtlMs,
          ttlMs
        ),
    }
  );

  return value;
}

function providerDiagnostic({
  provider,
  ok,
  startedAt,
  error = null,
  itemCount = 0,
  timedOut = false,
  cached = false,
} = {}) {
  return {
    provider,

    ok:
      Boolean(ok),

    latency_ms:
      elapsedMs(
        startedAt
      ),

    item_count:
      Number(
        itemCount ||
        0
      ),

    timed_out:
      Boolean(
        timedOut
      ),

    cached:
      Boolean(
        cached
      ),

    error:
      error
        ? errorMessage(
            error
          )
        : null,

    checked_at:
      now(),
  };
}

async function fetchJson(
  url,
  {
    method = "GET",
    headers = {},
    body,
    timeoutMs =
      DEFAULT_TIMEOUT_MS,
    label =
      "HTTP provider",
  } = {}
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
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
      payload =
        text;
    }

    if (
      !response.ok
    ) {
      const message =
        payload?.message ||
        payload?.error
          ?.message ||
        payload?.error ||
        `${response.status} ${response.statusText}`;

      throw new Error(
        `${label}: ${message}`
      );
    }

    return payload;
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw createTimeoutError(
        label,
        timeoutMs
      );
    }

    throw error;
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
  provider = null,
  latency_ms = null,
} = {}) {
  return {
    name,
    url,
    provider,

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

    latency_ms,

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
  diagnostics = [],
  degraded = false,
  cached = false,
  stale = false,
} = {}) {
  return {
    ok,
    provider,
    summary,
    data,
    sources,
    warnings,
    diagnostics,
    degraded,
    cached,
    stale,

    generated_at:
      now(),
  };
}

function safeJson(
  value
) {
  if (
    value &&
    typeof value ===
      "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(
      value
    );
  } catch {
    return null;
  }
}

function extractJsonObject(
  value
) {
  const text =
    clean(
      value
    );

  if (!text) {
    return null;
  }

  const direct =
    safeJson(
      text
    );

  if (direct) {
    return direct;
  }

  const fenced =
    text
      .replace(
        /^```(?:json)?/i,
        ""
      )
      .replace(
        /```$/,
        ""
      )
      .trim();

  const fencedParsed =
    safeJson(
      fenced
    );

  if (
    fencedParsed
  ) {
    return fencedParsed;
  }

  const firstBrace =
    text.indexOf(
      "{"
    );

  const lastBrace =
    text.lastIndexOf(
      "}"
    );

  if (
    firstBrace >= 0 &&
    lastBrace >
      firstBrace
  ) {
    return safeJson(
      text.slice(
        firstBrace,
        lastBrace + 1
      )
    );
  }

  return null;
}

function sortByNewest(
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

function normalizeUrl(
  value
) {
  const url =
    clean(
      value
    );

  if (!url) {
    return "";
  }

  try {
    const parsed =
      new URL(
        url
      );

    parsed.hash =
      "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ].forEach(
      (parameter) => {
        parsed.searchParams.delete(
          parameter
        );
      }
    );

    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeArticle(
  article = {},
  provider =
    "public_web"
) {
  const publishedAt =
    normalizeDate(
      article.published_at ||
        article.publishedAt ||
        article.published ||
        article.pubDate ||
        article.date ||
        article.updated_at
    );

  return {
    title:
      clean(
        article.title
      ),

    publisher:
      clean(
        article.publisher ||
          article.source
            ?.name ||
          article.source_name ||
          article.domain
      ) ||
      null,

    published_at:
      publishedAt,

    url:
      normalizeUrl(
        article.url ||
          article.link
      ),

    summary:
      clean(
        article.summary ||
          article.description ||
          article.content ||
          article.snippet
      ),

    source_type:
      article.source_type ||
      "public_web",

    provider:
      article.provider ||
      provider,

    freshness:
      freshness(
        publishedAt
      ),
  };
}

function articleKey(
  article
) {
  const url =
    normalizeUrl(
      article?.url
    ).toLowerCase();

  if (url) {
    return `url:${url}`;
  }

  const title =
    clean(
      article?.title
    )
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        " "
      )
      .trim();

  const publisher =
    clean(
      article?.publisher
    ).toLowerCase();

  return `title:${title}:${publisher}`;
}

function deduplicateArticles(
  rows = []
) {
  const seen =
    new Map();

  for (
    const row
    of rows
  ) {
    const article =
      normalizeArticle(
        row,
        row?.provider
      );

    if (
      !article.title ||
      !article.url
    ) {
      continue;
    }

    const key =
      articleKey(
        article
      );

    const existing =
      seen.get(
        key
      );

    if (!existing) {
      seen.set(
        key,
        article
      );

      continue;
    }

    const existingStamp =
      timestamp(
        existing.published_at
      );

    const candidateStamp =
      timestamp(
        article.published_at
      );

    if (
      candidateStamp >
      existingStamp
    ) {
      seen.set(
        key,
        {
          ...existing,
          ...article,

          summary:
            article.summary ||
            existing.summary,
        }
      );
    } else if (
      !existing.summary &&
      article.summary
    ) {
      seen.set(
        key,
        {
          ...existing,

          summary:
            article.summary,
        }
      );
    }
  }

  return sortByNewest(
    Array.from(
      seen.values()
    )
  );
}

function buildNewsQuery({
  query,
  state,
  locality,
} = {}) {
  return [
    clean(query),

    clean(state),

    clean(locality),
  ]
    .filter(Boolean)
    .join(" ");
}

async function searchOpenAiNews({
  query,
  state = "",
  locality = "",
  limit = 6,
} = {}) {
  const provider =
    "openai_web_search";

  const startedAt =
    Date.now();

  if (!openai) {
    return {
      provider,
      ok: false,
      articles: [],
      sources: [],

      warnings: [
        "OPENAI_API_KEY is missing on the backend.",
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
    };
  }

  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );

  const searchQuery =
    buildNewsQuery({
      query,
      state,
      locality,
    });

  try {
    const response =
      await withTimeout(
        openai.responses.create(
          {
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
              `Topic: ${searchQuery || "United States politics"}. ` +
              `State: ${clean(state) || "any"}. ` +
              `Locality: ${clean(locality) || "any"}. ` +
              `Today is ${today}. ` +
              `Return no more than ${clamp(
                limit,
                6,
                1,
                10
              )} articles. ` +
              "Prefer reports published within the last 24 hours, then the last 7 days. " +
              "Prioritize official government sources, election administrators, established newsrooms, " +
              "campaign-finance authorities, pollsters, campaigns, legislatures, and courts. " +
              "Reject old background articles when newer reporting exists. " +
              "Do not invent dates or URLs. " +
              "Return ONLY valid JSON with this exact shape: " +
              '{"articles":[{"title":"","publisher":"","published_at":"","url":"","summary":""}]}. ' +
              "Use ISO-8601 publication timestamps when available. Do not include markdown.",
          },
          {
            timeout:
              OPENAI_SDK_TIMEOUT_MS,

            maxRetries:
              0,
          }
        ),
        OPENAI_TIMEOUT_MS,
        "OpenAI live web search"
      );

    const parsed =
      extractJsonObject(
        response?.output_text ||
          ""
      );

    const articles =
      deduplicateArticles(
        (
          Array.isArray(
            parsed?.articles
          )
            ? parsed.articles
            : []
        ).map(
          (article) =>
            normalizeArticle(
              article,
              provider
            )
        )
      ).slice(
        0,
        clamp(
          limit,
          6,
          1,
          10
        )
      );

    const latency =
      elapsedMs(
        startedAt
      );

    return {
      provider,

      ok:
        articles.length >
        0,

      articles,

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
                  : 72,

              note:
                article.published_at
                  ? "Publication timestamp was returned by the public source."
                  : "Publication timestamp was unavailable; freshness is uncertain.",

              provider,

              latency_ms:
                latency,
            })
        ),

      warnings:
        articles.some(
          (article) =>
            !article.published_at
        )
          ? [
              "Some OpenAI web-search results did not include a publication timestamp.",
            ]
          : [],

      diagnostic:
        providerDiagnostic({
          provider,

          ok:
            articles.length >
            0,

          startedAt,

          itemCount:
            articles.length,
        }),
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      articles: [],
      sources: [],

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          error,
          itemCount: 0,

          timedOut:
            error?.code ===
              "PROVIDER_TIMEOUT" ||
            error?.name ===
              "APIConnectionTimeoutError",
        }),
    };
  }
}

async function searchNewsApi({
  query,
  state = "",
  locality = "",
  limit = 6,
} = {}) {
  const provider =
    "newsapi";

  const startedAt =
    Date.now();

  const apiKey =
    clean(
      process.env.NEWS_API_KEY
    );

  if (!apiKey) {
    return {
      provider,
      ok: false,
      articles: [],
      sources: [],

      warnings: [
        "NEWS_API_KEY is not configured.",
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
    };
  }

  const searchQuery =
    buildNewsQuery({
      query,
      state,
      locality,
    }) ||
    "United States politics";

  const fromDate =
    new Date(
      Date.now() -
        7 *
          24 *
          60 *
          60 *
          1000
    )
      .toISOString()
      .slice(
        0,
        10
      );

  const params =
    new URLSearchParams({
      q:
        searchQuery,

      language:
        "en",

      sortBy:
        "publishedAt",

      pageSize:
        String(
          clamp(
            limit,
            6,
            1,
            20
          )
        ),

      from:
        fromDate,

      apiKey,
    });

  try {
    const payload =
      await fetchJson(
        `https://newsapi.org/v2/everything?${params.toString()}`,
        {
          headers: {
            Accept:
              "application/json",
          },

          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            "NewsAPI",
        }
      );

    const articles =
      deduplicateArticles(
        (
          payload?.articles ||
          []
        ).map(
          (article) =>
            normalizeArticle(
              {
                title:
                  article.title,

                publisher:
                  article.source
                    ?.name,

                published_at:
                  article.publishedAt,

                url:
                  article.url,

                summary:
                  article.description ||
                  article.content,
              },
              provider
            )
        )
      ).slice(
        0,
        clamp(
          limit,
          6,
          1,
          20
        )
      );

    const latency =
      elapsedMs(
        startedAt
      );

    return {
      provider,

      ok:
        articles.length >
        0,

      articles,

      sources:
        articles.map(
          (article) =>
            sourceMeta({
              name:
                article.publisher ||
                "NewsAPI source",

              url:
                article.url,

              published_at:
                article.published_at,

              confidence:
                article.published_at
                  ? 90
                  : 75,

              note:
                "Article metadata returned by NewsAPI.",

              provider,

              latency_ms:
                latency,
            })
        ),

      warnings: [],

      diagnostic:
        providerDiagnostic({
          provider,

          ok:
            articles.length >
            0,

          startedAt,

          itemCount:
            articles.length,
        }),
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      articles: [],
      sources: [],

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          error,
          itemCount: 0,

          timedOut:
            error?.code ===
            "PROVIDER_TIMEOUT",
        }),
    };
  }
}

async function searchGNews({
  query,
  state = "",
  locality = "",
  limit = 6,
} = {}) {
  const provider =
    "gnews";

  const startedAt =
    Date.now();

  const apiKey =
    clean(
      process.env.GNEWS_API_KEY
    );

  if (!apiKey) {
    return {
      provider,
      ok: false,
      articles: [],
      sources: [],

      warnings: [
        "GNEWS_API_KEY is not configured.",
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
    };
  }

  const searchQuery =
    buildNewsQuery({
      query,
      state,
      locality,
    }) ||
    "United States politics";

  const params =
    new URLSearchParams({
      q:
        searchQuery,

      lang:
        "en",

      country:
        "us",

      max:
        String(
          clamp(
            limit,
            6,
            1,
            10
          )
        ),

      sortby:
        "publishedAt",

      apikey:
        apiKey,
    });

  try {
    const payload =
      await fetchJson(
        `https://gnews.io/api/v4/search?${params.toString()}`,
        {
          headers: {
            Accept:
              "application/json",
          },

          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            "GNews",
        }
      );

    const articles =
      deduplicateArticles(
        (
          payload?.articles ||
          []
        ).map(
          (article) =>
            normalizeArticle(
              {
                title:
                  article.title,

                publisher:
                  article.source
                    ?.name,

                published_at:
                  article.publishedAt,

                url:
                  article.url,

                summary:
                  article.description ||
                  article.content,
              },
              provider
            )
        )
      ).slice(
        0,
        clamp(
          limit,
          6,
          1,
          10
        )
      );

    const latency =
      elapsedMs(
        startedAt
      );

    return {
      provider,

      ok:
        articles.length >
        0,

      articles,

      sources:
        articles.map(
          (article) =>
            sourceMeta({
              name:
                article.publisher ||
                "GNews source",

              url:
                article.url,

              published_at:
                article.published_at,

              confidence:
                article.published_at
                  ? 88
                  : 73,

              note:
                "Article metadata returned by GNews.",

              provider,

              latency_ms:
                latency,
            })
        ),

      warnings: [],

      diagnostic:
        providerDiagnostic({
          provider,

          ok:
            articles.length >
            0,

          startedAt,

          itemCount:
            articles.length,
        }),
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      articles: [],
      sources: [],

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          error,
          itemCount: 0,

          timedOut:
            error?.code ===
            "PROVIDER_TIMEOUT",
        }),
    };
  }
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

  const normalizedQuery =
    clean(
      query
    ) ||
    "latest United States political developments";

  const key =
    `news:${JSON.stringify({
      query:
        normalizedQuery,

      state:
        clean(state),

      locality:
        clean(locality),

      limit:
        normalizedLimit,
    })}`;

  const freshCached =
    getFreshCached(
      key
    );

  if (
    freshCached
  ) {
    return freshCached;
  }

  const providerCalls =
    [];

  const providerNames =
    [];

  if (
    process.env.OPENAI_API_KEY
  ) {
    providerNames.push(
      "openai_web_search"
    );

    providerCalls.push(
      searchOpenAiNews({
        query:
          normalizedQuery,

        state,
        locality,

        limit:
          normalizedLimit,
      })
    );
  }

  if (
    process.env.NEWS_API_KEY
  ) {
    providerNames.push(
      "newsapi"
    );

    providerCalls.push(
      searchNewsApi({
        query:
          normalizedQuery,

        state,
        locality,

        limit:
          normalizedLimit,
      })
    );
  }

  if (
    process.env.GNEWS_API_KEY
  ) {
    providerNames.push(
      "gnews"
    );

    providerCalls.push(
      searchGNews({
        query:
          normalizedQuery,

        state,
        locality,

        limit:
          normalizedLimit,
      })
    );
  }

  if (
    providerCalls.length ===
    0
  ) {
    const staleCached =
      getStaleCached(
        key
      );

    if (
      staleCached
    ) {
      return staleCached;
    }

    return result({
      provider:
        "unified_live_news",

      ok:
        false,

      summary:
        "No live-news provider is configured.",

      data: {
        query:
          normalizedQuery,

        state:
          clean(state) ||
          null,

        locality:
          clean(locality) ||
          null,

        articles: [],

        successful_providers:
          [],

        attempted_providers:
          [],
      },

      warnings: [
        "Configure OPENAI_API_KEY, NEWS_API_KEY, or GNEWS_API_KEY.",
      ],

      degraded:
        true,
    });
  }

  const settled =
    await Promise.allSettled(
      providerCalls
    );

  const providerResults =
    settled.map(
      (
        entry,
        index
      ) => {
        const fallbackProvider =
          providerNames[
            index
          ] ||
          "unknown_news_provider";

        if (
          entry.status ===
          "fulfilled"
        ) {
          return entry.value;
        }

        return {
          provider:
            fallbackProvider,

          ok:
            false,

          articles: [],

          sources: [],

          warnings: [
            errorMessage(
              entry.reason
            ),
          ],

          diagnostic:
            providerDiagnostic({
              provider:
                fallbackProvider,

              ok:
                false,

              startedAt:
                Date.now(),

              error:
                entry.reason,

              itemCount:
                0,

              timedOut:
                entry.reason
                  ?.code ===
                "PROVIDER_TIMEOUT",
            }),
        };
      }
    );

  const successfulProviders =
    providerResults.filter(
      (provider) =>
        provider.ok
    );

  const articles =
    deduplicateArticles(
      providerResults.flatMap(
        (provider) =>
          provider.articles ||
          []
      )
    ).slice(
      0,
      normalizedLimit
    );

  const sources =
    providerResults.flatMap(
      (provider) =>
        provider.sources ||
        []
    );

  const warnings =
    providerResults.flatMap(
      (provider) =>
        provider.warnings ||
        []
    );

  const diagnostics =
    providerResults
      .map(
        (provider) =>
          provider.diagnostic
      )
      .filter(Boolean);

  if (
    articles.length >
    0
  ) {
    const output =
      result({
        provider:
          "unified_live_news",

        ok:
          true,

        summary:
          `Found ${articles.length} current political reports from ${successfulProviders.length} live provider${
            successfulProviders.length ===
            1
              ? ""
              : "s"
          }.`,

        data: {
          query:
            normalizedQuery,

          state:
            clean(state) ||
            null,

          locality:
            clean(locality) ||
            null,

          articles,

          successful_providers:
            successfulProviders.map(
              (provider) =>
                provider.provider
            ),

          attempted_providers:
            providerResults.map(
              (provider) =>
                provider.provider
            ),
        },

        sources,
        warnings,
        diagnostics,

        degraded:
          successfulProviders.length <
          providerResults.length,
      });

    return setCached(
      key,
      output,
      NEWS_CACHE_TTL_MS,
      NEWS_STALE_TTL_MS
    );
  }

  const staleCached =
    getStaleCached(
      key
    );

  if (
    staleCached
  ) {
    return {
      ...staleCached,

      diagnostics,

      warnings: [
        ...(
          staleCached
            .warnings ||
          []
        ),

        ...warnings,
      ],
    };
  }

  return result({
    provider:
      "unified_live_news",

    ok:
      false,

    summary:
      "No live political news provider returned current results.",

    data: {
      query:
        normalizedQuery,

      state:
        clean(state) ||
        null,

      locality:
        clean(locality) ||
        null,

      articles: [],

      successful_providers:
        [],

      attempted_providers:
        providerResults.map(
          (provider) =>
            provider.provider
        ),
    },

    sources: [],
    warnings,
    diagnostics,

    degraded:
      true,
  });
}

export async function getOpenFecFinance({
  candidateId = "",
  committeeId = "",
  cycle = "",
} = {}) {
  const provider =
    "openfec";

  const startedAt =
    Date.now();

  const apiKey =
    clean(
      process.env.FEC_API_KEY
    );

  if (!apiKey) {
    return result({
      provider,
      ok: false,

      summary:
        "OpenFEC is not configured.",

      warnings: [
        "FEC_API_KEY is missing.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
      ],

      degraded:
        true,
    });
  }

  const candidate =
    clean(
      candidateId
    );

  const committee =
    clean(
      committeeId
    );

  const normalizedCycle =
    clean(
      cycle
    );

  if (
    !candidate &&
    !committee
  ) {
    return result({
      provider,
      ok: false,

      summary:
        "A candidate ID or committee ID is required.",

      warnings: [
        "Provide candidate_id or committee_id.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
      ],

      degraded:
        true,
    });
  }

  const key =
    `fec:${candidate}:${committee}:${normalizedCycle}`;

  const freshCached =
    getFreshCached(
      key
    );

  if (
    freshCached
  ) {
    return freshCached;
  }

  const params =
    new URLSearchParams({
      api_key:
        apiKey,

      per_page:
        "20",
    });

  if (
    normalizedCycle
  ) {
    params.set(
      "cycle",
      normalizedCycle
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
        endpoint,
        {
          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            "OpenFEC",
        }
      );

    const records =
      Array.isArray(
        payload?.results
      )
        ? payload.results
        : [];

    const latency =
      elapsedMs(
        startedAt
      );

    const output =
      result({
        provider,

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
            normalizedCycle ||
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
              normalizedCycle ||
              null,

            confidence:
              97,

            note:
              "Official filing data reflects the latest available filing period, not second-by-second activity.",

            provider,

            latency_ms:
              latency,
          }),
        ],

        diagnostics: [
          providerDiagnostic({
            provider,

            ok:
              records.length >
              0,

            startedAt,

            itemCount:
              records.length,
          }),
        ],

        degraded:
          records.length ===
          0,
      });

    return setCached(
      key,
      output,
      OFFICIAL_CACHE_TTL_MS,
      OFFICIAL_STALE_TTL_MS
    );
  } catch (error) {
    const staleCached =
      getStaleCached(
        key
      );

    const diagnostic =
      providerDiagnostic({
        provider,
        ok: false,
        startedAt,
        error,
        itemCount: 0,

        timedOut:
          error?.code ===
          "PROVIDER_TIMEOUT",
      });

    if (
      staleCached
    ) {
      return {
        ...staleCached,

        diagnostics: [
          ...(
            staleCached
              .diagnostics ||
            []
          ),

          diagnostic,
        ],

        warnings: [
          ...(
            staleCached
              .warnings ||
            []
          ),

          errorMessage(
            error
          ),
        ],
      };
    }

    return result({
      provider,
      ok: false,

      summary:
        "OpenFEC finance lookup failed.",

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostics: [
        diagnostic,
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
  const provider =
    "congress_gov";

  const startedAt =
    Date.now();

  const apiKey =
    clean(
      process.env.CONGRESS_API_KEY
    );

  if (!apiKey) {
    return result({
      provider,
      ok: false,

      summary:
        "Congress.gov is not configured.",

      warnings: [
        "CONGRESS_API_KEY is missing.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
      ],

      degraded:
        true,
    });
  }

  const normalizedLimit =
    clamp(
      limit,
      10,
      1,
      25
    );

  const normalizedQuery =
    clean(
      query
    );

  const key =
    `congress:${normalizedQuery}:${normalizedLimit}`;

  const freshCached =
    getFreshCached(
      key
    );

  if (
    freshCached
  ) {
    return freshCached;
  }

  const params =
    new URLSearchParams({
      api_key:
        apiKey,

      format:
        "json",

      limit:
        String(
          normalizedLimit
        ),

      sort:
        "updateDate+desc",
    });

  try {
    const payload =
      await fetchJson(
        `https://api.congress.gov/v3/bill?${params.toString()}`,
        {
          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            "Congress.gov",
        }
      );

    let bills =
      Array.isArray(
        payload?.bills
      )
        ? payload.bills
        : [];

    const needle =
      normalizedQuery
        .toLowerCase();

    if (
      needle
    ) {
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
                  String(
                    value
                  )
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
              normalizeDate(
                bill.updateDate ||
                  bill.latestAction
                    ?.actionDate
              ),
          })
        )
      );

    const latency =
      elapsedMs(
        startedAt
      );

    const output =
      result({
        provider,

        ok:
          bills.length >
          0,

        summary:
          bills.length
            ? `Found ${bills.length} recent legislative updates.`
            : "No legislative updates matched the request.",

        data: {
          query:
            normalizedQuery ||
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

            provider,

            latency_ms:
              latency,
          }),
        ],

        diagnostics: [
          providerDiagnostic({
            provider,

            ok:
              bills.length >
              0,

            startedAt,

            itemCount:
              bills.length,
          }),
        ],

        degraded:
          bills.length ===
          0,
      });

    return setCached(
      key,
      output,
      OFFICIAL_CACHE_TTL_MS,
      OFFICIAL_STALE_TTL_MS
    );
  } catch (error) {
    const staleCached =
      getStaleCached(
        key
      );

    const diagnostic =
      providerDiagnostic({
        provider,
        ok: false,
        startedAt,
        error,
        itemCount: 0,

        timedOut:
          error?.code ===
          "PROVIDER_TIMEOUT",
      });

    if (
      staleCached
    ) {
      return {
        ...staleCached,

        diagnostics: [
          ...(
            staleCached
              .diagnostics ||
            []
          ),

          diagnostic,
        ],

        warnings: [
          ...(
            staleCached
              .warnings ||
            []
          ),

          errorMessage(
            error
          ),
        ],
      };
    }

    return result({
      provider,
      ok: false,

      summary:
        "Congress.gov lookup failed.",

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostics: [
        diagnostic,
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
  const provider =
    "nws";

  const startedAt =
    Date.now();

  const lat =
    Number(
      latitude
    );

  const lon =
    Number(
      longitude
    );

  if (
    !Number.isFinite(
      lat
    ) ||
    !Number.isFinite(
      lon
    )
  ) {
    return result({
      provider,
      ok: false,

      summary:
        "Latitude and longitude are required.",

      warnings: [
        "Provide numeric latitude and longitude.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
      ],

      degraded:
        true,
    });
  }

  const key =
    `weather:${lat}:${lon}`;

  const freshCached =
    getFreshCached(
      key
    );

  if (
    freshCached
  ) {
    return freshCached;
  }

  const headers = {
    Accept:
      "application/geo+json",

    "User-Agent":
      process.env.NWS_USER_AGENT ||
      "VoterSpheres/1.0 contact@voterspheres.org",
  };

  try {
    const point =
      await fetchJson(
        `https://api.weather.gov/points/${lat},${lon}`,
        {
          headers,

          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            "National Weather Service points",
        }
      );

    const forecastUrl =
      point?.properties
        ?.forecast;

    const alertsUrl =
      `https://api.weather.gov/alerts/active?point=${lat},${lon}`;

    const requests = [
      forecastUrl
        ? fetchJson(
            forecastUrl,
            {
              headers,

              timeoutMs:
                DEFAULT_TIMEOUT_MS,

              label:
                "National Weather Service forecast",
            }
          )
        : Promise.resolve(
            null
          ),

      fetchJson(
        alertsUrl,
        {
          headers,

          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            "National Weather Service alerts",
        }
      ),
    ];

    const settled =
      await Promise.allSettled(
        requests
      );

    const forecast =
      settled[0]
        .status ===
      "fulfilled"
        ? settled[0]
            .value
        : null;

    const alerts =
      settled[1]
        .status ===
      "fulfilled"
        ? settled[1]
            .value
        : null;

    const providerWarnings =
      settled
        .filter(
          (entry) =>
            entry.status ===
            "rejected"
        )
        .map(
          (entry) =>
            errorMessage(
              entry.reason
            )
        );

    const alertRows =
      Array.isArray(
        alerts?.features
      )
        ? alerts.features
        : [];

    const periods =
      Array.isArray(
        forecast
          ?.properties
          ?.periods
      )
        ? forecast.properties.periods
        : [];

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

    const successfulResponses =
      settled.filter(
        (entry) =>
          entry.status ===
          "fulfilled"
      ).length;

    const latency =
      elapsedMs(
        startedAt
      );

    const output =
      result({
        provider,

        ok:
          successfulResponses >
          0,

        summary:
          `${clean(location) || `${lat}, ${lon}`} field risk is ${riskLevel}. ` +
          `${alertRows.length} active alert${
            alertRows.length ===
            1
              ? ""
              : "s"
          } are present.`,

        data: {
          location:
            clean(location) ||
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
              normalizeDate(
                forecast
                  ?.properties
                  ?.updated ||
                  alertRows[0]
                    ?.properties
                    ?.sent
              ),

            confidence:
              97,

            note:
              "Live official weather alerts and forecast data.",

            provider,

            latency_ms:
              latency,
          }),
        ],

        warnings:
          providerWarnings,

        diagnostics: [
          providerDiagnostic({
            provider,

            ok:
              successfulResponses >
              0,

            startedAt,

            itemCount:
              alertRows.length +
              periods.length,

            error:
              successfulResponses >
              0
                ? null
                : settled[0]
                    ?.reason ||
                  settled[1]
                    ?.reason ||
                  null,

            timedOut:
              settled.some(
                (entry) =>
                  entry.status ===
                    "rejected" &&
                  entry.reason
                    ?.code ===
                    "PROVIDER_TIMEOUT"
              ),
          }),
        ],

        degraded:
          successfulResponses <
          requests.length,
      });

    return setCached(
      key,
      output,
      WEATHER_CACHE_TTL_MS,
      OFFICIAL_STALE_TTL_MS
    );
  } catch (error) {
    const staleCached =
      getStaleCached(
        key
      );

    const diagnostic =
      providerDiagnostic({
        provider,
        ok: false,
        startedAt,
        error,
        itemCount: 0,

        timedOut:
          error?.code ===
          "PROVIDER_TIMEOUT",
      });

    if (
      staleCached
    ) {
      return {
        ...staleCached,

        diagnostics: [
          ...(
            staleCached
              .diagnostics ||
            []
          ),

          diagnostic,
        ],

        warnings: [
          ...(
            staleCached
              .warnings ||
            []
          ),

          errorMessage(
            error
          ),
        ],
      };
    }

    return result({
      provider,
      ok: false,

      summary:
        "National Weather Service lookup failed.",

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostics: [
        diagnostic,
      ],

      degraded:
        true,
    });
  }
}

export async function getPollingProviderData(
  args = {}
) {
  const provider =
    "polling_provider";

  const startedAt =
    Date.now();

  const baseUrl =
    clean(
      process.env.POLLING_PROVIDER_URL
    );

  const apiKey =
    clean(
      process.env.POLLING_PROVIDER_API_KEY
    );

  if (!baseUrl) {
    return result({
      provider,
      ok: false,

      summary:
        "No external polling provider is configured.",

      warnings: [
        "POLLING_PROVIDER_URL is missing.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
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
      args ||
      {}
    )
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      params.set(
        key,
        String(
          value
        )
      );
    }
  }

  const cacheKey =
    `polling:${baseUrl}:${params.toString()}`;

  const freshCached =
    getFreshCached(
      cacheKey
    );

  if (
    freshCached
  ) {
    return freshCached;
  }

  try {
    const separator =
      baseUrl.includes(
        "?"
      )
        ? "&"
        : "?";

    const requestUrl =
      params.toString()
        ? `${baseUrl}${separator}${params.toString()}`
        : baseUrl;

    const payload =
      await fetchJson(
        requestUrl,
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

          timeoutMs:
            DEFAULT_TIMEOUT_MS,

          label:
            process.env.POLLING_PROVIDER_NAME ||
            "Polling provider",
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
          ? rawPolls.map(
              (poll) => ({
                ...poll,

                published_at:
                  normalizeDate(
                    poll.published_at ||
                      poll.publishedAt ||
                      poll.field_end ||
                      poll.updated_at ||
                      poll.created_at
                  ),
              })
            )
          : []
      );

    const latency =
      elapsedMs(
        startedAt
      );

    const output =
      result({
        provider,

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
              process.env.POLLING_PROVIDER_NAME ||
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

            provider,

            latency_ms:
              latency,
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

        diagnostics: [
          providerDiagnostic({
            provider,

            ok:
              polls.length >
              0,

            startedAt,

            itemCount:
              polls.length,
          }),
        ],

        degraded:
          polls.length ===
          0,
      });

    return setCached(
      cacheKey,
      output,
      POLLING_CACHE_TTL_MS,
      OFFICIAL_STALE_TTL_MS
    );
  } catch (error) {
    const staleCached =
      getStaleCached(
        cacheKey
      );

    const diagnostic =
      providerDiagnostic({
        provider,
        ok: false,
        startedAt,
        error,
        itemCount: 0,

        timedOut:
          error?.code ===
          "PROVIDER_TIMEOUT",
      });

    if (
      staleCached
    ) {
      return {
        ...staleCached,

        diagnostics: [
          ...(
            staleCached
              .diagnostics ||
            []
          ),

          diagnostic,
        ],

        warnings: [
          ...(
            staleCached
              .warnings ||
            []
          ),

          errorMessage(
            error
          ),
        ],
      };
    }

    return result({
      provider,
      ok: false,

      summary:
        "External polling-provider lookup failed.",

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostics: [
        diagnostic,
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
      clean(
        args.query
      ) ||
      "latest election administration election officials voting systems deadlines court rulings ballot access",

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
          process.env.OPENAI_API_KEY
        ),

      required_env: [
        "OPENAI_API_KEY",
      ],

      timeout_ms:
        OPENAI_TIMEOUT_MS,

      sdk_timeout_ms:
        OPENAI_SDK_TIMEOUT_MS,
    },

    {
      id:
        "newsapi",

      configured:
        Boolean(
          process.env.NEWS_API_KEY
        ),

      required_env: [
        "NEWS_API_KEY",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "gnews",

      configured:
        Boolean(
          process.env.GNEWS_API_KEY
        ),

      required_env: [
        "GNEWS_API_KEY",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "openfec",

      configured:
        Boolean(
          process.env.FEC_API_KEY
        ),

      required_env: [
        "FEC_API_KEY",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "congress_gov",

      configured:
        Boolean(
          process.env.CONGRESS_API_KEY
        ),

      required_env: [
        "CONGRESS_API_KEY",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "nws",

      configured:
        true,

      required_env:
        [],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "polling_provider",

      configured:
        Boolean(
          process.env.POLLING_PROVIDER_URL
        ),

      required_env: [
        "POLLING_PROVIDER_URL",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "election_administration",

      configured:
        Boolean(
          process.env.OPENAI_API_KEY ||
          process.env.NEWS_API_KEY ||
          process.env.GNEWS_API_KEY
        ),

      required_env: [
        "OPENAI_API_KEY or NEWS_API_KEY or GNEWS_API_KEY",
      ],

      timeout_ms:
        Math.max(
          OPENAI_TIMEOUT_MS,
          DEFAULT_TIMEOUT_MS
        ),
    },
  ];

  const nowMs =
    Date.now();

  let freshEntries =
    0;

  let staleEntries =
    0;

  let expiredEntries =
    0;

  for (
    const entry
    of CACHE.values()
  ) {
    if (
      entry.expires_at >
      nowMs
    ) {
      freshEntries +=
        1;
    } else if (
      entry.stale_expires_at >
      nowMs
    ) {
      staleEntries +=
        1;
    } else {
      expiredEntries +=
        1;
    }
  }

  return {
    ok:
      true,

    providers,

    configured_count:
      providers.filter(
        (item) =>
          item.configured
      ).length,

    total_count:
      providers.length,

    cache: {
      total_entries:
        CACHE.size,

      fresh_entries:
        freshEntries,

      stale_entries:
        staleEntries,

      expired_entries:
        expiredEntries,

      news_ttl_ms:
        NEWS_CACHE_TTL_MS,

      news_stale_ttl_ms:
        NEWS_STALE_TTL_MS,

      official_ttl_ms:
        OFFICIAL_CACHE_TTL_MS,

      official_stale_ttl_ms:
        OFFICIAL_STALE_TTL_MS,

      polling_ttl_ms:
        POLLING_CACHE_TTL_MS,

      weather_ttl_ms:
        WEATHER_CACHE_TTL_MS,
    },

    timeouts: {
      default_provider_ms:
        DEFAULT_TIMEOUT_MS,

      openai_sdk_ms:
        OPENAI_SDK_TIMEOUT_MS,

      openai_outer_ms:
        OPENAI_TIMEOUT_MS,
    },

    generated_at:
      now(),
  };
}

export function clearExecutiveVoiceSourceCache() {
  const cleared =
    CACHE.size;

  CACHE.clear();

  return {
    ok:
      true,

    message:
      "Executive Voice live-source cache cleared.",

    cleared_entries:
      cleared,

    generated_at:
      now(),
  };
}
