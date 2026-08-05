
import OpenAI from "openai";
import { pool } from "../db/pool.js";

/*
 * =========================================================
 * Executive Voice Live Sources
 * Build 5.3.0
 * =========================================================
 *
 * Adds:
 * - Provider-specific candidate queries
 * - Candidate relevance scoring with adaptive thresholds
 * - Exact-name, surname, office, and state context handling
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
  ) || 12000;

const OPENAI_TIMEOUT_MS =
  Number(
    process.env
      .EXECUTIVE_VOICE_OPENAI_TIMEOUT_MS
  ) || 15000;

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

const CANDIDATE_MIN_RELEVANCE =
  Number(
    process.env
      .EXECUTIVE_VOICE_CANDIDATE_MIN_RELEVANCE
  ) || 30;

const CANDIDATE_STRICT_RELEVANCE =
  Number(
    process.env
      .EXECUTIVE_VOICE_CANDIDATE_STRICT_RELEVANCE
  ) || 45;

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
  configured = true,
  summary = "",
  data = null,
  records = null,
  sources = [],
  warnings = [],
  diagnostics = [],
  degraded = false,
  cached = false,
  stale = false,
} = {}) {
  const normalizedRecords = Array.isArray(records)
    ? records
    : [];

  return {
    ok: Boolean(ok),
    configured: Boolean(configured),
    provider,
    summary,
    data,
    records: normalizedRecords,
    count: normalizedRecords.length,
    sources,
    warnings,
    diagnostics,
    degraded: Boolean(degraded),
    cached: Boolean(cached),
    stale: Boolean(stale),

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

function buildProviderCandidateQuery({
  provider,
  candidate,
  office = "",
  state = "",
  locality = "",
} = {}) {
  const candidateName =
    normalizeCandidateName(
      candidate
    );

  if (!candidateName) {
    return buildNewsQuery({
      query:
        "political candidate campaign election",

      state,
      locality,
    });
  }

  const exactName =
    `"${escapeSearchPhrase(
      candidateName
    )}"`;

  const context =
    [
      clean(state),
      clean(office),
      clean(locality),
    ]
      .filter(Boolean)
      .join(" ");

  switch (provider) {
    case "newsapi":
      return [
        exactName,
        context,
      ]
        .filter(Boolean)
        .join(" ");

    case "gnews":
      return [
        exactName,
        clean(state),
        clean(locality),
      ]
        .filter(Boolean)
        .join(" ");

    case "openai_web_search":
      return buildCandidateNewsQuery({
        candidate:
          candidateName,

        office,
        state,
      });

    default:
      return [
        exactName,
        context,
      ]
        .filter(Boolean)
        .join(" ");
  }
}

function candidateArticleFilter(
  rows,
  {
    candidate,
    state = "",
    office = "",
    minimumRelevance = CANDIDATE_MIN_RELEVANCE,

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
      ? buildProviderCandidateQuery({
          provider,
          candidate,
          office,
          state,
          locality,
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
      ? buildProviderCandidateQuery({
          provider,
          candidate,
          office,
          state,
          locality,
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

    console.log(
      "[executive-voice-live-sources] NewsAPI search result",
      {
        query:
          searchQuery,

        raw_article_count:
          rawArticles.length,

        filtered_article_count:
          relevantArticles.length,

        returned_article_count:
          articles.length,
      }
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
      ? buildProviderCandidateQuery({
          provider,
          candidate,
          office,
          state,
          locality,
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

    console.log(
      "[executive-voice-live-sources] GNews search result",
      {
        query:
          searchQuery,

        raw_article_count:
          rawArticles.length,

        filtered_article_count:
          relevantArticles.length,

        returned_article_count:
          articles.length,
      }
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

function decodeXmlEntities(value = "") {
  return clean(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '\"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function xmlTag(block, tag) {
  const match = String(block || "").match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")
  );

  return match ? decodeXmlEntities(match[1]) : "";
}

async function searchGoogleNewsRss({
  query,
  state = "",
  locality = "",
  limit = 10,
  candidate = "",
  office = "",
  candidateMode = false,
} = {}) {
  const provider = "google_news_rss";
  const startedAt = Date.now();
  const normalizedLimit = clamp(limit, 10, 1, 20);
  const searchQuery = candidateMode
    ? buildProviderCandidateQuery({ provider, candidate, office, state, locality })
    : buildNewsQuery({ query, state, locality }) || "United States politics elections";

  const params = new URLSearchParams({ q: searchQuery, hl: "en-US", gl: "US", ceid: "US:en" });

  try {
    const xml = await fetchJson(`https://news.google.com/rss/search?${params.toString()}`, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": process.env.NEWS_RSS_USER_AGENT || "VoterSpheres/1.0 contact@voterspheres.org",
      },
      timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 10000),
      label: "Google News RSS",
    });

    const rawXml = typeof xml === "string" ? xml : "";
    const items = rawXml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    const rawArticles = items.map((item) => {
      const sourceMatch = item.match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/i);
      return normalizeArticle({
        title: xmlTag(item, "title"),
        url: xmlTag(item, "link"),
        published_at: xmlTag(item, "pubDate"),
        summary: xmlTag(item, "description"),
        publisher: sourceMatch ? decodeXmlEntities(sourceMatch[2]) : "Google News",
      }, provider);
    });

    const relevantArticles = candidateMode
      ? candidateArticleFilter(rawArticles, {
          candidate, state, office, minimumRelevance: Math.max(20, CANDIDATE_MIN_RELEVANCE - 10),
        })
      : rawArticles;
    const articles = deduplicateArticles(relevantArticles).slice(0, normalizedLimit);

    return {
      provider,
      ok: articles.length > 0,
      articles,
      sources: articles.map((article) => sourceMeta({
        name: article.publisher || "Google News RSS",
        url: article.url,
        published_at: article.published_at,
        confidence: article.published_at ? 82 : 68,
        note: "Public Google News RSS fallback used when configured providers are slow or unavailable.",
        provider,
        latency_ms: elapsedMs(startedAt),
      })),
      warnings: [],
      diagnostic: providerDiagnostic({ provider, ok: articles.length > 0, startedAt, itemCount: articles.length }),
    };
  } catch (error) {
    return {
      provider, ok: false, articles: [], sources: [], warnings: [errorMessage(error)],
      diagnostic: providerDiagnostic({ provider, ok: false, startedAt, error, itemCount: 0, timedOut: error?.code === "PROVIDER_TIMEOUT" }),
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

  providerNames.push("google_news_rss");
  providerCalls.push(
    searchGoogleNewsRss({ query, state, locality, limit, candidate, office, candidateMode })
  );

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

  if (
    candidateMode
  ) {
    console.log(
      "[executive-voice-live-sources] About to summarize provider results"
    );

    console.log(
      "[executive-voice-live-sources] Candidate provider results:",
      {
        candidate,
        state,
        office,
        locality,

        providers:
          providerResults.map(
            (providerResult) => ({
              provider:
                providerResult.provider,

              ok:
                providerResult.ok,

              article_count:
                providerResult.articles
                  ?.length ||
                0,

              warning_count:
                providerResult.warnings
                  ?.length ||
                0,
            })
          ),
      }
    );
  }

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

        records: providerOutput.articles,

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
    ok: false,
    configured: providerOutput.providerNames.length > 0,

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
  console.log(
    "[executive-voice-live-sources] searchCandidatePoliticalNews called",
    {
      candidate,
      state,
      office,
      locality,
      limit,
    }
  );

  try {
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
    buildProviderCandidateQuery({
      provider:
        "candidate_live_news",

      candidate:
        candidateName,

      state,
      office,
      locality,
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

  const strictArticles =
    providerOutput
      .articles
      .filter(
        (article) =>
          Number(
            article.candidate_relevance ||
            0
          ) >=
          CANDIDATE_STRICT_RELEVANCE
      );

  const fallbackArticles =
    providerOutput
      .articles
      .filter(
        (article) =>
          Number(
            article.candidate_relevance ||
            0
          ) >=
          CANDIDATE_MIN_RELEVANCE

      );

  const articles =
    (
      strictArticles.length
        ? strictArticles
        : fallbackArticles
    ).slice(
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

          relevance_threshold:
            strictArticles.length
              ? CANDIDATE_STRICT_RELEVANCE
              : CANDIDATE_MIN_RELEVANCE,
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

      `No article met the candidate relevance thresholds (${CANDIDATE_MIN_RELEVANCE}/${CANDIDATE_STRICT_RELEVANCE}).`,
    ],

    diagnostics:
      providerOutput.diagnostics,

    degraded:
      true,
  });
  } catch (error) {
    console.error(
      "[executive-voice-live-sources] searchCandidatePoliticalNews FAILED",
      {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause,
      }
    );

    throw error;
  }
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
      ok: false,
      configured: false,
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

  const nationalMode = !candidate && !committee;

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
      : candidate
        ? `https://api.open.fec.gov/v1/candidate/${encodeURIComponent(
            candidate
          )}/totals/?${params.toString()}`
        : `https://api.open.fec.gov/v1/candidate/totals/?${params.toString()}&sort=name`;

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

    const records = (Array.isArray(payload?.results) ? payload.results : [])
      .sort((a, b) => {
        if (!nationalMode) return 0;
        const aReceipts = Number(a?.receipts || a?.total_receipts || a?.receipts_ytd || 0);
        const bReceipts = Number(b?.receipts || b?.total_receipts || b?.receipts_ytd || 0);
        return bReceipts - aReceipts;
      });

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
          mode: nationalMode ? "national_candidate_totals" : "entity_totals",
          records,
        },

        records,

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
      ok: false,
      configured: false,
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

    const queryTokens = normalizedQuery
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
      .filter(
        (token) =>
          ![
            "united",
            "states",
            "politics",
            "campaigns",
            "horizon",
          ].includes(token)
      )
      .slice(0, 8);

    if (queryTokens.length) {
      bills = bills.filter((bill) => {
        const haystack = [
          bill.title,
          bill.type,
          bill.number,
          bill.latestAction?.text,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return queryTokens.some((token) =>
          haystack.includes(token)
        );
      });
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

        records: bills,

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

const STATE_FIELD_COORDINATES = Object.freeze({
  AL: { latitude: 32.377716, longitude: -86.300568, location: "Montgomery, AL" },
  AK: { latitude: 58.301598, longitude: -134.420212, location: "Juneau, AK" },
  AZ: { latitude: 33.448143, longitude: -112.096962, location: "Phoenix, AZ" },
  AR: { latitude: 34.746613, longitude: -92.288986, location: "Little Rock, AR" },
  CA: { latitude: 38.576668, longitude: -121.493629, location: "Sacramento, CA" },
  CO: { latitude: 39.739227, longitude: -104.984856, location: "Denver, CO" },
  CT: { latitude: 41.764046, longitude: -72.682198, location: "Hartford, CT" },
  DE: { latitude: 39.157307, longitude: -75.519722, location: "Dover, DE" },
  DC: { latitude: 38.895110, longitude: -77.036370, location: "Washington, DC" },
  FL: { latitude: 30.438118, longitude: -84.281296, location: "Tallahassee, FL" },
  GA: { latitude: 33.749027, longitude: -84.388229, location: "Atlanta, GA" },
  HI: { latitude: 21.307442, longitude: -157.857376, location: "Honolulu, HI" },
  ID: { latitude: 43.617775, longitude: -116.199722, location: "Boise, ID" },
  IL: { latitude: 39.798363, longitude: -89.654961, location: "Springfield, IL" },
  IN: { latitude: 39.768623, longitude: -86.162643, location: "Indianapolis, IN" },
  IA: { latitude: 41.591087, longitude: -93.603729, location: "Des Moines, IA" },
  KS: { latitude: 39.048191, longitude: -95.677956, location: "Topeka, KS" },
  KY: { latitude: 38.186722, longitude: -84.875374, location: "Frankfort, KY" },
  LA: { latitude: 30.457069, longitude: -91.187393, location: "Baton Rouge, LA" },
  ME: { latitude: 44.307167, longitude: -69.781693, location: "Augusta, ME" },
  MD: { latitude: 38.978764, longitude: -76.490936, location: "Annapolis, MD" },
  MA: { latitude: 42.358162, longitude: -71.063698, location: "Boston, MA" },
  MI: { latitude: 42.733635, longitude: -84.555328, location: "Lansing, MI" },
  MN: { latitude: 44.955097, longitude: -93.102211, location: "Saint Paul, MN" },
  MS: { latitude: 32.303848, longitude: -90.182106, location: "Jackson, MS" },
  MO: { latitude: 38.579201, longitude: -92.172935, location: "Jefferson City, MO" },
  MT: { latitude: 46.585709, longitude: -112.018417, location: "Helena, MT" },
  NE: { latitude: 40.808075, longitude: -96.699654, location: "Lincoln, NE" },
  NV: { latitude: 39.163914, longitude: -119.766121, location: "Carson City, NV" },
  NH: { latitude: 43.206898, longitude: -71.537994, location: "Concord, NH" },
  NJ: { latitude: 40.220596, longitude: -74.769913, location: "Trenton, NJ" },
  NM: { latitude: 35.682240, longitude: -105.939728, location: "Santa Fe, NM" },
  NY: { latitude: 42.652843, longitude: -73.757874, location: "Albany, NY" },
  NC: { latitude: 35.780430, longitude: -78.639099, location: "Raleigh, NC" },
  ND: { latitude: 46.820850, longitude: -100.783318, location: "Bismarck, ND" },
  OH: { latitude: 39.961346, longitude: -82.999069, location: "Columbus, OH" },
  OK: { latitude: 35.492207, longitude: -97.503342, location: "Oklahoma City, OK" },
  OR: { latitude: 44.938461, longitude: -123.030403, location: "Salem, OR" },
  PA: { latitude: 40.264378, longitude: -76.883598, location: "Harrisburg, PA" },
  RI: { latitude: 41.830914, longitude: -71.414963, location: "Providence, RI" },
  SC: { latitude: 34.000343, longitude: -81.033211, location: "Columbia, SC" },
  SD: { latitude: 44.367031, longitude: -100.346405, location: "Pierre, SD" },
  TN: { latitude: 36.165810, longitude: -86.784241, location: "Nashville, TN" },
  TX: { latitude: 30.274670, longitude: -97.740349, location: "Austin, TX" },
  UT: { latitude: 40.777477, longitude: -111.888237, location: "Salt Lake City, UT" },
  VT: { latitude: 44.262436, longitude: -72.580536, location: "Montpelier, VT" },
  VA: { latitude: 37.538857, longitude: -77.433640, location: "Richmond, VA" },
  WA: { latitude: 47.035805, longitude: -122.905014, location: "Olympia, WA" },
  WV: { latitude: 38.336246, longitude: -81.612328, location: "Charleston, WV" },
  WI: { latitude: 43.074684, longitude: -89.384445, location: "Madison, WI" },
  WY: { latitude: 41.140259, longitude: -104.820236, location: "Cheyenne, WY" },
});

function resolveWeatherCoordinates({
  latitude,
  longitude,
  location = "",
  state = "",
  state_code = "",
  geographic_scope = "",
} = {}) {
  const directLatitude = Number(latitude);
  const directLongitude = Number(longitude);

  if (
    Number.isFinite(directLatitude) &&
    Number.isFinite(directLongitude)
  ) {
    return {
      latitude: directLatitude,
      longitude: directLongitude,
      location: clean(location) || `${directLatitude}, ${directLongitude}`,
      resolution: "coordinates",
    };
  }

  const stateCode = clean(
    state_code || state || geographic_scope
  )
    .toUpperCase()
    .slice(0, 2);

  const resolved = STATE_FIELD_COORDINATES[stateCode];

  if (!resolved) {
    return null;
  }

  return {
    ...resolved,
    location: clean(location) || resolved.location,
    state_code: stateCode,
    resolution: "state_capital",
  };
}

export async function getWeatherFieldRisk({
  latitude,
  longitude,
  location = "",
  state = "",
  state_code = "",
  geographic_scope = "",
} = {}) {
  const provider =
    "nws";

  const startedAt =
    Date.now();

  const resolvedLocation = resolveWeatherCoordinates({
    latitude,
    longitude,
    location,
    state,
    state_code,
    geographic_scope,
  });

  if (!resolvedLocation) {
    return result({
      provider,
      ok: false,
      configured: true,
      summary:
        "Weather risk requires coordinates or a supported U.S. state code.",
      warnings: [
        "Provide latitude/longitude or state/state_code.",
      ],
      diagnostics: [
        providerDiagnostic({
          provider,
          ok: false,
          startedAt,
          itemCount: 0,
        }),
      ],
      degraded: true,
    });
  }

  const lat = resolvedLocation.latitude;
  const lon = resolvedLocation.longitude;
  const resolvedLocationName = resolvedLocation.location;

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
          `${resolvedLocationName} field risk is ${riskLevel}. ` +
          `${alertRows.length} active alert${
            alertRows.length ===
            1
              ? ""
              : "s"
          } are present.`,

        data: {
          location: resolvedLocationName,
          state_code: resolvedLocation.state_code || null,
          coordinate_resolution: resolvedLocation.resolution,
          latitude: lat,
          longitude: lon,
          risk_level: riskLevel,
          records: [
            {
              id: `weather:${resolvedLocation.state_code || `${lat},${lon}`}`,
              title: `${resolvedLocationName} field risk is ${riskLevel}`,
              name: `${resolvedLocationName} weather field risk`,
              state_code: resolvedLocation.state_code || null,
              risk_level: riskLevel,
              score:
                riskLevel === "High"
                  ? 88
                  : riskLevel === "Elevated"
                    ? 68
                    : 25,
              summary:
                `${alertRows.length} active alert${alertRows.length === 1 ? "" : "s"}; ` +
                `${periods.length} forecast period${periods.length === 1 ? "" : "s"}.`,
              published_at:
                normalizeDate(
                  forecast?.properties?.updated ||
                    alertRows[0]?.properties?.sent
                ),
              active_alert_count: alertRows.length,
            },
          ],
          active_alerts: alertRows,
          forecast_periods: periods.slice(0, 6),
        },

        records: [
          {
            id: `weather:${resolvedLocation.state_code || `${lat},${lon}`}`,
            title: `${resolvedLocationName} field risk is ${riskLevel}`,
            name: `${resolvedLocationName} weather field risk`,
            state_code: resolvedLocation.state_code || null,
            risk_level: riskLevel,
            score: riskLevel === "High" ? 88 : riskLevel === "Elevated" ? 68 : 25,
            summary: `${alertRows.length} active weather alerts and ${periods.length} forecast periods.`,
            published_at: normalizeDate(forecast?.properties?.updated || alertRows[0]?.properties?.sent),
          },
        ],

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

async function readStoredPollingRecords(args = {}) {
  const state = clean(args.state_code || args.state).toUpperCase().slice(0, 2);
  const office = clean(args.office);
  const limit = clamp(args.limit, 20, 1, 100);

  try {
    const metadata = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'polling_results'`
    );
    const columns = new Set(metadata.rows.map((row) => row.column_name));
    if (!columns.size) return { configured: false, records: [], error: "polling_results table is not configured." };

    const stateColumn = columns.has("state") ? "state" : columns.has("state_code") ? "state_code" : null;
    const officeColumn = columns.has("office") ? "office" : null;
    const dateColumn = ["field_end", "published_at", "updated_at", "created_at"].find((column) => columns.has(column));
    const conditions = [];
    const params = [];
    if (state && stateColumn) {
      params.push(state);
      conditions.push(`UPPER(COALESCE("${stateColumn}"::text, '')) = $${params.length}`);
    }
    if (office && officeColumn) {
      params.push(`%${office}%`);
      conditions.push(`"${officeColumn}" ILIKE $${params.length}`);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `SELECT * FROM polling_results ${whereSql} ORDER BY ${dateColumn ? `"${dateColumn}"` : "1"} DESC NULLS LAST LIMIT ${limit}`;
    const result = await pool.query(query, params);
    return { configured: true, records: result.rows, error: null };
  } catch (error) {
    return { configured: true, records: [], error: errorMessage(error) };
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
    const stored = await readStoredPollingRecords(args);
    return result({
      provider: "stored_polling",
      ok: stored.records.length > 0,
      configured: stored.configured,
      summary: stored.records.length
        ? `Found ${stored.records.length} stored polling records.`
        : "No external polling provider is configured and no stored polling records were available.",
      data: { polls: stored.records, records: stored.records, fallback: "polling_results" },
      records: stored.records,
      warnings: [
        "POLLING_PROVIDER_URL is missing; using the polling_results database fallback.",
        ...(stored.error ? [stored.error] : []),
      ],
      diagnostics: [providerDiagnostic({
        provider: "stored_polling", ok: stored.records.length > 0, startedAt,
        itemCount: stored.records.length, error: stored.error ? new Error(stored.error) : null,
      })],
      degraded: stored.records.length === 0,
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

        records: polls,

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
    const stored = await readStoredPollingRecords(args);
    if (stored.records.length > 0) {
      return result({
        provider: "stored_polling",
        ok: true,
        summary: `The external polling provider failed; returning ${stored.records.length} stored polling records.`,
        data: { polls: stored.records, records: stored.records, fallback: "polling_results" },
        records: stored.records,
        warnings: [errorMessage(error), "Using the polling_results database fallback."],
        diagnostics: [providerDiagnostic({ provider, ok: false, startedAt, error, itemCount: 0, timedOut: error?.code === "PROVIDER_TIMEOUT" })],
        degraded: true,
      });
    }

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
  const state =
    clean(
      args.state ||
      args.state_code
    );

  const locality =
    clean(
      args.locality
    );

  const query =
    clean(
      args.query
    ) ||
    [
      state,
      locality,
      "Secretary of State",
      "election administration",
      "voting",
      "ballot",
      "election officials",
      "election law",
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      );

  return searchCurrentPoliticalNews({
    query,
    state,
    locality,

    limit:
      args.limit,
  });
}

export async function getExecutiveVoiceSourceHealth() {
  const providers = [
    { id: "google_news_rss", configured: true, required_env: [], timeout_ms: Math.max(DEFAULT_TIMEOUT_MS, 10000) },

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
      "5.2",

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

    candidate_relevance: {
      minimum:
        CANDIDATE_MIN_RELEVANCE,

      strict:
        CANDIDATE_STRICT_RELEVANCE,
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
      "5.2",

    message:
      "Executive Voice live-source cache cleared.",

    cleared_entries:
      cleared,

    generated_at:
      now(),
  };
}

