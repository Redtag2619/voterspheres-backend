import axios from "axios";
import { pool } from "../db/pool.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeStateName(value = "") {
  const raw = String(value || "").trim().toUpperCase();
  const map = {
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
    DC: "District of Columbia"
  };

  return map[raw] || value || "";
}

function stateCode(value = "") {
  const raw = String(value || "").trim();
  if (raw.length === 2) return raw.toUpperCase();

  const reverse = {
    Alabama: "AL",
    Alaska: "AK",
    Arizona: "AZ",
    Arkansas: "AR",
    California: "CA",
    Colorado: "CO",
    Connecticut: "CT",
    Delaware: "DE",
    Florida: "FL",
    Georgia: "GA",
    Hawaii: "HI",
    Idaho: "ID",
    Illinois: "IL",
    Indiana: "IN",
    Iowa: "IA",
    Kansas: "KS",
    Kentucky: "KY",
    Louisiana: "LA",
    Maine: "ME",
    Maryland: "MD",
    Massachusetts: "MA",
    Michigan: "MI",
    Minnesota: "MN",
    Mississippi: "MS",
    Missouri: "MO",
    Montana: "MT",
    Nebraska: "NE",
    Nevada: "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    Ohio: "OH",
    Oklahoma: "OK",
    Oregon: "OR",
    Pennsylvania: "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    Tennessee: "TN",
    Texas: "TX",
    Utah: "UT",
    Vermont: "VT",
    Virginia: "VA",
    Washington: "WA",
    "West Virginia": "WV",
    Wisconsin: "WI",
    Wyoming: "WY",
    "District of Columbia": "DC"
  };

  return reverse[raw] || raw;
}

function buildNewsQuery(row) {
  const bits = [
    normalizeText(row.candidate),
    normalizeText(row.office),
    normalizeText(stateCode(row.state))
  ].filter(Boolean);

  return bits.join(" ");
}

function extractItems(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.news?.results)) return payload.news.results;
  if (Array.isArray(payload?.news)) return payload.news;
  return [];
}

function deriveExternalId(item) {
  return normalizeText(item?.uuid || item?.id || item?.url || item?.link || "");
}

function deriveUrl(item) {
  return normalizeText(item?.url || item?.link || "");
}

function derivePublishedAt(item) {
  const value =
    item?.published ||
    item?.published_at ||
    item?.age ||
    item?.page_age ||
    item?.date ||
    null;

  if (!value) return null;

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) return asDate;

  return null;
}

export async function ensureNewsSignalsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_signals (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'brave_news',
      external_id TEXT,
      title TEXT NOT NULL,
      url TEXT,
      description TEXT,
      published_at TIMESTAMP,
      state TEXT,
      office TEXT,
      candidate_name TEXT,
      candidate_id TEXT,
      query TEXT,
      raw_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_news_signals_source_external
    ON news_signals (COALESCE(source, ''), COALESCE(external_id, ''))
    WHERE external_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_news_signals_published_at
    ON news_signals (published_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_news_signals_state
    ON news_signals (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_news_signals_candidate_id
    ON news_signals (candidate_id)
  `);
}

export async function getNewsIngestionTargets(limit = 8) {
  const query = `
    with vendor_counts as (
      select upper(state) as state_code, count(*)::int as vendor_count
      from vendors
      where state is not null and state <> ''
      group by upper(state)
    ),
    finance as (
      select
        candidate_id,
        coalesce(receipts, 0) as receipts,
        coalesce(cash_on_hand, 0) as cash_on_hand
      from fundraising_live
    )
    select
      c.id,
      c.external_id,
      c.full_name as candidate,
      c.state,
      c.office,
      c.party,
      coalesce(f.receipts, 0) as receipts,
      coalesce(v.vendor_count, 0) as vendor_count
    from candidates c
    left join finance f
      on f.candidate_id = c.external_id
    left join vendor_counts v
      on v.state_code = upper(c.state)
    where c.state is not null
      and c.state <> ''
      and c.office is not null
      and c.office <> ''
      and c.office in ('Senate', 'House', 'Governor', 'President')
    order by
      coalesce(f.receipts, 0) desc,
      c.state asc,
      c.office asc,
      c.full_name asc
    limit $1
  `;

  const { rows } = await pool.query(query, [limit]);

  return (rows || []).map((row) => ({
    candidate_id: row.external_id,
    candidate: row.candidate,
    state: normalizeStateName(row.state),
    office: row.office,
    party: row.party || "",
    receipts: Number(row.receipts || 0),
    vendor_count: Number(row.vendor_count || 0)
  }));
}

export async function fetchBraveNewsForQuery(query, count = 5) {
  const apiKey = normalizeText(process.env.BRAVE_SEARCH_API_KEY || "");
  if (!apiKey) {
    throw new Error("Missing BRAVE_SEARCH_API_KEY");
  }

  const endpoint =
    process.env.BRAVE_NEWS_API_URL ||
    "https://api.search.brave.com/res/v1/news/search";

  const response = await axios.get(endpoint, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey
    },
    params: {
      q: query,
      count
    },
    timeout: 30000
  });

  return extractItems(response.data);
}

export async function upsertNewsSignal({
  source = "brave_news",
  external_id,
  title,
  url,
  description,
  published_at,
  state,
  office,
  candidate_name,
  candidate_id,
  query,
  raw_payload
}) {
  const existing = await pool.query(
    `
      select id
      from news_signals
      where coalesce(source, '') = coalesce($1, '')
        and coalesce(external_id, '') = coalesce($2, '')
      limit 1
    `,
    [source, external_id]
  );

  const params = [
    source,
    external_id,
    title,
    url,
    description,
    published_at,
    state,
    office,
    candidate_name,
    candidate_id,
    query,
    JSON.stringify(raw_payload || {})
  ];

  if (existing.rows.length) {
    await pool.query(
      `
        update news_signals
        set
          title = $3,
          url = $4,
          description = $5,
          published_at = $6,
          state = $7,
          office = $8,
          candidate_name = $9,
          candidate_id = $10,
          query = $11,
          raw_payload = $12::jsonb,
          updated_at = now()
        where coalesce(source, '') = coalesce($1, '')
          and coalesce(external_id, '') = coalesce($2, '')
      `,
      params
    );
    return "updated";
  }

  await pool.query(
    `
      insert into news_signals (
        source,
        external_id,
        title,
        url,
        description,
        published_at,
        state,
        office,
        candidate_name,
        candidate_id,
        query,
        raw_payload,
        created_at,
        updated_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now(),now()
      )
    `,
    params
  );

  return "inserted";
}

export async function ingestNewsSignals(limit = 8, countPerQuery = 5) {
  await ensureNewsSignalsTable();

  const targets = await getNewsIngestionTargets(limit);

  let seen = 0;
  let inserted = 0;
  let updated = 0;

  for (const row of targets) {
    const query = buildNewsQuery(row);
    if (!query) continue;

    const items = await fetchBraveNewsForQuery(query, countPerQuery);

    for (const item of items) {
      const title = normalizeText(item?.title);
      if (!title) continue;

      seen += 1;

      const result = await upsertNewsSignal({
        external_id: deriveExternalId(item),
        title,
        url: deriveUrl(item),
        description: normalizeText(item?.description || item?.snippet || ""),
        published_at: derivePublishedAt(item),
        state: row.state,
        office: row.office,
        candidate_name: row.candidate,
        candidate_id: row.candidate_id,
        query,
        raw_payload: item
      });

      if (result === "inserted") inserted += 1;
      if (result === "updated") updated += 1;
    }
  }

  return {
    success: true,
    source: "brave_news",
    targets: targets.length,
    seen,
    inserted,
    updated
  };
}

export async function getRecentNewsSignals(limit = 10) {
  await ensureNewsSignalsTable();

  const result = await pool.query(
    `
      select
        id,
        source,
        external_id,
        title,
        url,
        description,
        published_at,
        state,
        office,
        candidate_name,
        candidate_id,
        query,
        raw_payload,
        created_at,
        updated_at
      from news_signals
      order by coalesce(published_at, updated_at, created_at) desc, id desc
      limit $1
    `,
    [limit]
  );

  return result.rows || [];
}
