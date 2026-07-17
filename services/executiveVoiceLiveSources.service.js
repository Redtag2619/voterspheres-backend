import OpenAI from "openai";

/*
 * =========================================================
 * Executive Voice Live Sources
 * Build 3.5.2
 * =========================================================
 *
 * Adds:
 * - Candidate-specific exact-name news queries
 * - Candidate relevance filtering
 * - Parallel OpenAI, NewsAPI, and GNews lookups
 * - Hard provider timeouts
 * - No automatic OpenAI retries
 * - Fresh and stale cache layers
 * - Provider latency diagnostics
 * - Newest-first ranking
 * - Article deduplication
 * - OpenFEC, Congress.gov, NWS, and polling support
 */

const DEFAULT_TIMEOUT_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_PROVIDER_TIMEOUT_MS
  ) || 6000;

const OPENAI_SDK_TIMEOUT_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_OPENAI_SDK_TIMEOUT_MS
  ) || 6500;

const OPENAI_TIMEOUT_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_OPENAI_TIMEOUT_MS
  ) || 7000;

const NEWS_CACHE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_NEWS_CACHE_TTL_MS
  ) || 60 * 1000;

const NEWS_STALE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_NEWS_STALE_TTL_MS
  ) || 30 * 60 * 1000;

const CANDIDATE_NEWS_CACHE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_CANDIDATE_NEWS_CACHE_TTL_MS
  ) || 45 * 1000;

const CANDIDATE_NEWS_STALE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_CANDIDATE_NEWS_STALE_TTL_MS
  ) || 20 * 60 * 1000;

const OFFICIAL_CACHE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_OFFICIAL_CACHE_TTL_MS
  ) || 5 * 60 * 1000;

const OFFICIAL_STALE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_OFFICIAL_STALE_TTL_MS
  ) || 60 * 60 * 1000;

const POLLING_CACHE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_POLLING_CACHE_TTL_MS
  ) || 5 * 60 * 1000;

const WEATHER_CACHE_TTL_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_WEATHER_CACHE_TTL_MS
  ) || 2 * 60 * 1000;

const CANDIDATE_NEWS_LOOKBACK_DAYS =
  Number(
    process.env
      .EXECUTIVE_VOICE_CANDIDATE_NEWS_LOOKBACK_DAYS
  ) || 14;

const GENERAL_NEWS_LOOKBACK_DAYS =
  Number(
    process.env
      .EXECUTIVE_VOICE_GENERAL_NEWS_LOOKBACK_DAYS
  ) || 7;

const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY,

        timeout:
          OPENAI_SDK_TIMEOUT_MS,

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

    candidate_relevance:
      Number(
        article.candidate_relevance ||
        0
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

    const existingRelevance =
      Number(
        existing.candidate_relevance ||
        0
      );

    const candidateRelevance =
      Number(
        article.candidate_relevance ||
        0
      );

    if (
      candidateRelevance >
        existingRelevance ||
      (
        candidateRelevance ===
          existingRelevance &&
        candidateStamp >
          existingStamp
      )
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

  return [
    ...seen.values(),
  ].sort(
    (
      a,
      b
    ) => {
      const relevanceDifference =
        Number(
          b.candidate_relevance ||
          0
        ) -
        Number(
          a.candidate_relevance ||
          0
        );

      if (
        relevanceDifference !==
        0
      ) {
        return relevanceDifference;
      }

      return (
        timestamp(
          b.published_at
        ) -
        timestamp(
          a.published_at
        )
      );
    }
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

function escapeSearchPhrase(
  value
) {
  return clean(
    value
  ).replace(
    /"/g,
    '\\"'
  );
}

function normalizeCandidateName(
  value
) {
  return clean(
    value
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function candidateNameParts(
  candidate
) {
  return normalizeCandidateName(
    candidate
  )
    .toLowerCase()
    .split(
      /\s+/
    )
    .filter(
      (part) =>
        part.length >
        1
    );
}

function articleCandidateRelevance(
  article,
  candidate,
  {
    state = "",
    office = "",
  } = {}
) {
  const candidateName =
    normalizeCandidateName(
      candidate
    );

  if (
    !candidateName
  ) {
    return 0;
  }

  const candidateLower =
    candidateName.toLowerCase();

  const parts =
    candidateNameParts(
      candidateName
    );

  const haystack =
    [
      article?.title,
      article?.summary,
      article?.publisher,
      article?.url,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  if (!haystack) {
    return 0;
  }

  let score =
    0;

  if (
    haystack.includes(
      candidateLower
    )
  ) {
    score +=
      70;
  }

  const matchedParts =
    parts.filter(
      (part) =>
        haystack.includes(
          part
        )
    ).length;

  if (
    parts.length >
    0
  ) {
    score +=
      Math.round(
        (
          matchedParts /
          parts.length
        ) *
        20
      );
  }

  const politicalTerms = [
    "candidate",
    "campaign",
    "election",
    "primary",
    "general election",
    "poll",
    "polling",
    "endorsement",
    "fundraising",
    "fundraiser",
    "debate",
    "ballot",
    "vote",
    "voters",
    "committee",
    "fec",
    "advertising",
    "ad buy",
    "filing",
    "race",
  ];

  if (
    politicalTerms.some(
      (term) =>
        haystack.includes(
          term
        )
    )
  ) {
    score +=
      10;
  }

  if (
    clean(state) &&
    haystack.includes(
      clean(state)
        .toLowerCase()
    )
  ) {
    score +=
      5;
  }

  if (
    clean(office) &&
    haystack.includes(
      clean(office)
        .toLowerCase()
    )
  ) {
    score +=
      5;
  }

  return Math.min(
    100,
    score
  );
}

function buildCandidateNewsQuery({
  candidate,
  office = "",
  state = "",
} = {}) {
  const candidateName =
    escapeSearchPhrase(
      candidate
    );

  if (
    !candidateName
  ) {
    return buildNewsQuery({
      query:
        "political candidate campaign election",

      state,
    });
  }

  const contextTerms = [
    "campaign",
    "election",
    "candidate",
    "endorsement",
    "fundraising",
    "poll",
    "polling",
    "debate",
    "advertising",
    "filing",
    "primary",
    "ballot",
  ];

  const optionalLocationTerms =
    [
      clean(office),
      clean(state),
    ].filter(Boolean);

  const locationClause =
    optionalLocationTerms.length
      ? ` AND (${optionalLocationTerms
          .map(
            (term) =>
              `"${escapeSearchPhrase(
                term
              )}"`
          )
          .join(" OR ")})`
      : "";

  return (
    `"${candidateName}" AND ` +
    `(${contextTerms.join(
      " OR "
    )})` +
    locationClause
  );
}

function candidateArticleFilter(
  rows,
  {
    candidate,
    state = "",
    office = "",
    minimumRelevance = 45,
  } = {}
) {
  return rows
    .map(
      (row) => {
        const normalized =
          normalizeArticle(
            row,
            row?.provider
          );

        return {
          ...normalized,

          candidate_relevance:
            articleCandidateRelevance(
              normalized,
              candidate,
              {
                state,
                office,
              }
            ),
        };
      }
    )
    .filter(
      (article) =>
        article.title &&
        article.url &&
        article.candidate_relevance >=
          minimumRelevance
    );
}

function newsLookbackStart(
  days
) {
  return new Date(
    Date.now() -
      clamp(
        days,
        7,
        1,
        60
      ) *
        24 *
        60 *
        60 *
        1000
  );
}

async function searchOpenAiNews({
  query,
  state = "",
  locality = "",
  limit = 6,
  candidate = "",
  office = "",
  candidateMode = false,
} = {}) {
  const provider =
    "openai_web_search";

  const startedAt =
    Date.now();

  if (!openai) {
    return {
      provider,
      ok:
        false,

      articles:
        [],

      sources:
        [],

      warnings: [
        "OPENAI_API_KEY is missing on the backend.",
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok:
            false,
          startedAt,
          itemCount:
            0,
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

  const normalizedLimit =
    clamp(
      limit,
      6,
      1,
      10
    );

  const searchQuery =
    candidateMode
      ? buildCandidateNewsQuery({
          candidate,
          office,
          state,
        })
      : buildNewsQuery({
          query,
          state,
          locality,
        });

  const subjectInstruction =
    candidateMode
      ? (
          `The named candidate is "${normalizeCandidateName(
            candidate
          )}". ` +
          "Only return reports that clearly refer to this exact political candidate. " +
          "Reject unrelated people with similar names. "
        )
      : "";

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
              subjectInstruction +
              `Topic: ${searchQuery || "United States politics"}. ` +
              `State: ${clean(state) || "any"}. ` +
              `Locality: ${clean(locality) || "any"}. ` +
              `Office: ${clean(office) || "any"}. ` +
              `Today is ${today}. ` +
              `Return no more than ${normalizedLimit} articles. ` +
              (
                candidateMode
                  ? `Prefer articles from the last ${CANDIDATE_NEWS_LOOKBACK_DAYS} days. `
                  : `Prefer articles from the last ${GENERAL_NEWS_LOOKBACK_DAYS} days. `
              ) +
              "Prioritize official government sources, election administrators, established newsrooms, " +
              "campaign-finance authorities, pollsters, campaigns, legislatures, and courts. " +
              "Reject old background articles when newer reporting exists. " +
              "Do not invent publication dates or URLs. " +
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
        candidateMode
          ? "OpenAI candidate live search"
          : "OpenAI live web search"
      );

    const parsed =
      extractJsonObject(
        response?.output_text ||
          ""
      );

    const rawArticles =
      Array.isArray(
        parsed?.articles
      )
        ? parsed.articles.map(
            (article) =>
              normalizeArticle(
                article,
                provider
              )
          )
        : [];

    const relevantArticles =
      candidateMode
        ? candidateArticleFilter(
            rawArticles,
            {
              candidate,
              state,
              office,
            }
          )
        : rawArticles;

    const articles =
      deduplicateArticles(
        relevantArticles
      ).slice(
        0,
        normalizedLimit
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
                candidateMode
                  ? Math.max(
                      75,
                      Math.min(
                        96,
                        article.candidate_relevance
                      )
                    )
                  : article.published_at
                    ? 88
                    : 72,

              note:
                candidateMode
                  ? `Candidate relevance score: ${article.candidate_relevance}.`
                  : article.published_at
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

      ok:
        false,

      articles:
        [],

      sources:
        [],

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostic:
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          error,

          itemCount:
            0,

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
  candidate = "",
  office = "",
  candidateMode = false,
} = {}) {
  const provider =
    "newsapi";

  const startedAt =
    Date.now();

  const apiKey =
    clean(
      process.env
        .NEWS_API_KEY
    );

  if (!apiKey) {
    return {
      provider,

      ok:
        false,

      articles:
        [],

      sources:
        [],

      warnings: [
        "NEWS_API_KEY is not configured.",
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok:
            false,
          startedAt,
          itemCount:
            0,
        }),
    };
  }

  const normalizedLimit =
    clamp(
      limit,
      6,
      1,
      20
    );

  const searchQuery =
    candidateMode
      ? buildCandidateNewsQuery({
          candidate,
          office,
          state,
        })
      : (
          buildNewsQuery({
            query,
            state,
            locality,
          }) ||
          "United States politics"
        );

  const lookbackDays =
    candidateMode
      ? CANDIDATE_NEWS_LOOKBACK_DAYS
      : GENERAL_NEWS_LOOKBACK_DAYS;

  const fromDate =
    newsLookbackStart(
      lookbackDays
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
          normalizedLimit
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
            candidateMode
              ? "NewsAPI candidate search"
              : "NewsAPI",
        }
      );

    const rawArticles =
      (
        Array.isArray(
          payload?.articles
        )
          ? payload.articles
          : []
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
      );

    const relevantArticles =
      candidateMode
        ? candidateArticleFilter(
            rawArticles,
            {
              candidate,
              state,
              office,
            }
          )
        : rawArticles;

    const articles =
      deduplicateArticles(
        relevantArticles
      ).slice(
        0,
        normalizedLimit
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
                candidateMode
                  ? Math.max(
                      75,
                      Math.min(
                        96,
                        article.candidate_relevance
                      )
                    )
                  : article.published_at
                    ? 90
                    : 75,

              note:
                candidateMode
                  ? `Candidate relevance score: ${article.candidate_relevance}.`
                  : "Article metadata returned by NewsAPI.",

              provider,

              latency_ms:
                latency,
            })
        ),

      warnings:
        candidateMode &&
        rawArticles.length >
          0 &&
        articles.length ===
          0
          ? [
              "NewsAPI returned articles, but none passed the candidate relevance threshold.",
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

      ok:
        false,

      articles:
        [],

      sources:
        [],

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostic:
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          error,

          itemCount:
            0,

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
  candidate = "",
  office = "",
  candidateMode = false,
} = {}) {
  const provider =
    "gnews";

  const startedAt =
    Date.now();

  const apiKey =
    clean(
      process.env
        .GNEWS_API_KEY
    );

  if (!apiKey) {
    return {
      provider,

      ok:
        false,

      articles:
        [],

      sources:
        [],

      warnings: [
        "GNEWS_API_KEY is not configured.",
      ],

      diagnostic:
        providerDiagnostic({
          provider,
          ok:
            false,
          startedAt,
          itemCount:
            0,
        }),
    };
  }

  const normalizedLimit =
    clamp(
      limit,
      6,
      1,
      10
    );

  const searchQuery =
    candidateMode
      ? buildCandidateNewsQuery({
          candidate,
          office,
          state,
        })
      : (
          buildNewsQuery({
            query,
            state,
            locality,
          }) ||
          "United States politics"
        );

  const lookbackDays =
    candidateMode
      ? CANDIDATE_NEWS_LOOKBACK_DAYS
      : GENERAL_NEWS_LOOKBACK_DAYS;

  const fromTimestamp =
    newsLookbackStart(
      lookbackDays
    ).toISOString();

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
          normalizedLimit
        ),

      from:
        fromTimestamp,

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
            candidateMode
              ? "GNews candidate search"
              : "GNews",
        }
      );

    const rawArticles =
      (
        Array.isArray(
          payload?.articles
        )
          ? payload.articles
          : []
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
      );

    const relevantArticles =
      candidateMode
        ? candidateArticleFilter(
            rawArticles,
            {
              candidate,
              state,
              office,
            }
          )
        : rawArticles;

    const articles =
      deduplicateArticles(
        relevantArticles
      ).slice(
        0,
        normalizedLimit
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
                candidateMode
                  ? Math.max(
                      75,
                      Math.min(
                        95,
                        article.candidate_relevance
                      )
                    )
                  : article.published_at
                    ? 88
                    : 73,

              note:
                candidateMode
                  ? `Candidate relevance score: ${article.candidate_relevance}.`
                  : "Article metadata returned by GNews.",

              provider,

              latency_ms:
                latency,
            })
        ),

      warnings:
        candidateMode &&
        rawArticles.length >
          0 &&
        articles.length ===
          0
          ? [
              "GNews returned articles, but none passed the candidate relevance threshold.",
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

      ok:
        false,

      articles:
        [],

      sources:
        [],

      warnings: [
        errorMessage(
          error
        ),
      ],

      diagnostic:
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          error,

          itemCount:
            0,

          timedOut:
            error?.code ===
            "PROVIDER_TIMEOUT",
        }),
    };
  }
}

async function runNewsProviders({
  query,
  state = "",
  locality = "",
  limit = 6,
  candidate = "",
  office = "",
  candidateMode = false,
} = {}) {
  const providerCalls =
    [];

  const providerNames =
    [];

  if (
    process.env
      .OPENAI_API_KEY
  ) {
    providerNames.push(
      "openai_web_search"
    );

    providerCalls.push(
      searchOpenAiNews({
        query,
        state,
        locality,
        limit,
        candidate,
        office,
        candidateMode,
      })
    );
  }

  if (
    process.env
      .NEWS_API_KEY
  ) {
    providerNames.push(
      "newsapi"
    );

    providerCalls.push(
      searchNewsApi({
        query,
        state,
        locality,
        limit,
        candidate,
        office,
        candidateMode,
      })
    );
  }

  if (
    process.env
      .GNEWS_API_KEY
  ) {
    providerNames.push(
      "gnews"
    );

    providerCalls.push(
      searchGNews({
        query,
        state,
        locality,
        limit,
        candidate,
        office,
        candidateMode,
      })
    );
  }

  if (
    providerCalls.length ===
    0
  ) {
    return {
      providerResults:
        [],

      providerNames:
        [],

      articles:
        [],

      sources:
        [],

      warnings: [
        "Configure OPENAI_API_KEY, NEWS_API_KEY, or GNEWS_API_KEY.",
      ],

      diagnostics:
        [],

      successfulProviders:
        [],
    };
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

          articles:
            [],

          sources:
            [],

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
      (providerResult) =>
        providerResult.ok
    );

  const articles =
    deduplicateArticles(
      providerResults.flatMap(
        (providerResult) =>
          providerResult.articles ||
          []
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

  const sources =
    providerResults.flatMap(
      (providerResult) =>
        providerResult.sources ||
        []
    );

  const warnings =
    providerResults.flatMap(
      (providerResult) =>
        providerResult.warnings ||
        []
    );

  const diagnostics =
    providerResults
      .map(
        (providerResult) =>
          providerResult.diagnostic
      )
      .filter(Boolean);

  return {
    providerResults,
    providerNames,
    articles,
    sources,
    warnings,
    diagnostics,
    successfulProviders,
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
        clean(
          state
        ),

      locality:
        clean(
          locality
        ),

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

  const providerOutput =
    await runNewsProviders({
      query:
        normalizedQuery,

      state,
      locality,

      limit:
        normalizedLimit,

      candidateMode:
        false,
    });

  if (
    providerOutput
      .articles
      .length >
    0
  ) {
    const output =
      result({
        provider:
          "unified_live_news",

        ok:
          true,

        summary:
          `Found ${providerOutput.articles.length} current political reports from ` +
          `${providerOutput.successfulProviders.length} live provider${
            providerOutput.successfulProviders.length ===
            1
              ? ""
              : "s"
          }.`,

        data: {
          query:
            normalizedQuery,

          state:
            clean(
              state
            ) ||
            null,

          locality:
            clean(
              locality
            ) ||
            null,

          articles:
            providerOutput.articles,

          successful_providers:
            providerOutput.successfulProviders.map(
              (
                providerResult
              ) =>
                providerResult.provider
            ),

          attempted_providers:
            providerOutput.providerNames,
        },

        sources:
          providerOutput.sources,

        warnings:
          providerOutput.warnings,

        diagnostics:
          providerOutput.diagnostics,

        degraded:
          providerOutput.successfulProviders.length <
          providerOutput.providerNames.length,
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

      diagnostics:
        providerOutput.diagnostics,

      warnings: [
        ...(
          staleCached
            .warnings ||
          []
        ),

        ...providerOutput.warnings,
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
        clean(
          state
        ) ||
        null,

      locality:
        clean(
          locality
        ) ||
        null,

      articles:
        [],

      successful_providers:
        [],

      attempted_providers:
        providerOutput.providerNames,
    },

    sources:
      [],

    warnings:
      providerOutput.warnings,

    diagnostics:
      providerOutput.diagnostics,

    degraded:
      true,
  });
}

export async function searchCandidatePoliticalNews({
  candidate,
  state = "",
  office = "",
  locality = "",
  limit = 10,
} = {}) {
  const candidateName =
    normalizeCandidateName(
      candidate
    );

  const normalizedLimit =
    clamp(
      limit,
      10,
      1,
      20
    );

  if (
    !candidateName
  ) {
    return result({
      provider:
        "candidate_live_news",

      ok:
        false,

      summary:
        "A candidate name is required for live candidate intelligence.",

      data: {
        candidate:
          null,

        articles:
          [],
      },

      warnings: [
        "Provide the candidate's full name.",
      ],

      degraded:
        true,
    });
  }

  const key =
    `candidate-news:${JSON.stringify({
      candidate:
        candidateName.toLowerCase(),

      state:
        clean(
          state
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

  const query =
    buildCandidateNewsQuery({
      candidate:
        candidateName,

      state,
      office,
    });

  const providerOutput =
    await runNewsProviders({
      query,
      state,
      locality,

      limit:
        normalizedLimit,

      candidate:
        candidateName,

      office,

      candidateMode:
        true,
    });

  const articles =
    providerOutput
      .articles
      .filter(
        (
          article
        ) =>
          Number(
            article.candidate_relevance ||
            0
          ) >=
          45
      )
      .slice(
        0,
        normalizedLimit
      );

  if (
    articles.length >
    0
  ) {
    const newestArticle =
      articles[0];

    const output =
      result({
        provider:
          "candidate_live_news",

        ok:
          true,

        summary:
          `Found ${articles.length} current reports about ${candidateName} from ` +
          `${providerOutput.successfulProviders.length} live provider${
            providerOutput.successfulProviders.length ===
            1
              ? ""
              : "s"
          }.`,

        data: {
          candidate:
            candidateName,

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

          locality:
            clean(
              locality
            ) ||
            null,

          query,

          articles,

          latest_published_at:
            newestArticle
              ?.published_at ||
            null,

          successful_providers:
            providerOutput.successfulProviders.map(
              (
                providerResult
              ) =>
                providerResult.provider
            ),

          attempted_providers:
            providerOutput.providerNames,
        },

        sources:
          providerOutput.sources,

        warnings:
          providerOutput.warnings,

        diagnostics:
          providerOutput.diagnostics,

        degraded:
          providerOutput.successfulProviders.length <
          providerOutput.providerNames.length,
      });

    return setCached(
      key,
      output,
      CANDIDATE_NEWS_CACHE_TTL_MS,
      CANDIDATE_NEWS_STALE_TTL_MS
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

      diagnostics:
        providerOutput.diagnostics,

      warnings: [
        ...(
          staleCached
            .warnings ||
          []
        ),

        ...providerOutput.warnings,
      ],
    };
  }

  return result({
    provider:
      "candidate_live_news",

    ok:
      false,

    summary:
      `No recent verified political reporting was found for ${candidateName}.`,

    data: {
      candidate:
        candidateName,

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

      locality:
        clean(
          locality
        ) ||
        null,

      query,

      articles:
        [],

      successful_providers:
        [],

      attempted_providers:
        providerOutput.providerNames,
    },

    sources:
      [],

    warnings: [
      ...providerOutput.warnings,

      "No article met the candidate relevance threshold.",
    ],

    diagnostics:
      providerOutput.diagnostics,

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
      process.env
        .FEC_API_KEY
    );

  if (!apiKey) {
    return result({
      provider,

      ok:
        false,

      summary:
        "OpenFEC is not configured.",

      warnings: [
        "FEC_API_KEY is missing.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          itemCount:
            0,
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

      ok:
        false,

      summary:
        "A candidate ID or committee ID is required.",

      warnings: [
        "Provide candidate_id or committee_id.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          itemCount:
            0,
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
  } catch (
    error
  ) {
    const staleCached =
      getStaleCached(
        key
      );

    const diagnostic =
      providerDiagnostic({
        provider,

        ok:
          false,

        startedAt,

        error,

        itemCount:
          0,

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

      ok:
        false,

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
      process.env
        .CONGRESS_API_KEY
    );

  if (!apiKey) {
    return result({
      provider,

      ok:
        false,

      summary:
        "Congress.gov is not configured.",

      warnings: [
        "CONGRESS_API_KEY is missing.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          itemCount:
            0,
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
          (
            bill
          ) =>
            [
              bill.title,
              bill.type,
              bill.number,
              bill.latestAction
                ?.text,
            ]
              .filter(
                Boolean
              )
              .some(
                (
                  value
                ) =>
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
          (
            bill
          ) => ({
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
  } catch (
    error
  ) {
    const staleCached =
      getStaleCached(
        key
      );

    const diagnostic =
      providerDiagnostic({
        provider,

        ok:
          false,

        startedAt,

        error,

        itemCount:
          0,

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

      ok:
        false,

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

      ok:
        false,

      summary:
        "Latitude and longitude are required.",

      warnings: [
        "Provide numeric latitude and longitude.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          itemCount:
            0,
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

    const settled =
      await Promise.allSettled([
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
      ]);

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
          (
            entry
          ) =>
            entry.status ===
            "rejected"
        )
        .map(
          (
            entry
          ) =>
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
        (
          alert
        ) =>
          severeTerms.some(
            (
              term
            ) =>
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
        (
          entry
        ) =>
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
            clean(
              location
            ) ||
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
                (
                  entry
                ) =>
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
          2,
      });

    return setCached(
      key,
      output,
      WEATHER_CACHE_TTL_MS,
      OFFICIAL_STALE_TTL_MS
    );
  } catch (
    error
  ) {
    const staleCached =
      getStaleCached(
        key
      );

    const diagnostic =
      providerDiagnostic({
        provider,

        ok:
          false,

        startedAt,

        error,

        itemCount:
          0,

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

      ok:
        false,

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
      process.env
        .POLLING_PROVIDER_URL
    );

  const apiKey =
    clean(
      process.env
        .POLLING_PROVIDER_API_KEY
    );

  if (
    !baseUrl
  ) {
    return result({
      provider,

      ok:
        false,

      summary:
        "No external polling provider is configured.",

      warnings: [
        "POLLING_PROVIDER_URL is missing.",
      ],

      diagnostics: [
        providerDiagnostic({
          provider,

          ok:
            false,

          startedAt,

          itemCount:
            0,
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
            process.env
              .POLLING_PROVIDER_NAME ||
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
              (
                poll
              ) => ({
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

            provider,

            latency_ms:
              latency,
          }),
        ],

        warnings:
          polls.some(
            (
              poll
            ) =>
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
  } catch (
    error
  ) {
    const staleCached =
      getStaleCached(
        cacheKey
      );

    const diagnostic =
      providerDiagnostic({
        provider,

        ok:
          false,

        startedAt,

        error,

        itemCount:
          0,

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

      ok:
        false,

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
          process.env
            .OPENAI_API_KEY
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
          process.env
            .NEWS_API_KEY
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
          process.env
            .GNEWS_API_KEY
        ),

      required_env: [
        "GNEWS_API_KEY",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
    },

    {
      id:
        "candidate_live_news",

      configured:
        Boolean(
          process.env
            .OPENAI_API_KEY ||
          process.env
            .NEWS_API_KEY ||
          process.env
            .GNEWS_API_KEY
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

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
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
          process.env
            .POLLING_PROVIDER_URL
        ),

      required_env: [
        "POLLING_PROVIDER_URL",
      ],

      timeout_ms:
        DEFAULT_TIMEOUT_MS,
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

    build:
      "3.5.2",

    providers,

    configured_count:
      providers.filter(
        (
          item
        ) =>
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

      candidate_news_ttl_ms:
        CANDIDATE_NEWS_CACHE_TTL_MS,

      candidate_news_stale_ttl_ms:
        CANDIDATE_NEWS_STALE_TTL_MS,

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

    lookback: {
      candidate_news_days:
        CANDIDATE_NEWS_LOOKBACK_DAYS,

      general_news_days:
        GENERAL_NEWS_LOOKBACK_DAYS,
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

    build:
      "3.5.2",

    message:
      "Executive Voice live-source cache cleared.",

    cleared_entries:
      cleared,

    generated_at:
      now(),
  };
}
