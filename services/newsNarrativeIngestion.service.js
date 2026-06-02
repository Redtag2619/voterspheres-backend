import axios from "axios";
import { pool } from "../db/pool.js";
import { emitRealtimeEvent } from "./realtime.service.js";
import { ensurePoliticalSignalsTable } from "./politicalSignalIngestion.service.js";

const DEFAULT_FEEDS = [
  "https://news.google.com/rss/search?q=2026+election+campaign+politics&hl=en-US&gl=US&ceid=US:en", 
  "https://news.google.com/rss/search?q=Senate+race+2026+politics&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=governor+race+2026+politics&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=campaign+fundraising+FEC+politics&hl=en-US&gl=US&ceid=US:en",
];

const NEGATIVE_TERMS = [
  "scandal", "investigation", "lawsuit", "ethics", "fraud", "criminal",
  "attack", "controversy", "backlash", "resigns", "indicted", "probe",
  "collapse", "trouble", "crisis", "delay", "failed", "negative"
];

const POSITIVE_TERMS = [
  "surge", "endorsement", "momentum", "leads", "wins", "raises",
  "record", "strong", "growth", "boost", "advantage", "popular"
];

const ISSUE_TERMS = [
  "economy", "immigration", "abortion", "education", "healthcare",
  "crime", "taxes", "housing", "energy", "border", "democracy"
];

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming"
};

function text(value = "") {
  return String(value ?? "").trim();
}

function stripXml(value = "") {
  return text(value)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTag(itemXml, tag) {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return stripXml(match?.[1] || "");
}

function parseRssItems(xml = "") {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return items.map((item) => ({
    title: extractTag(item, "title"),
    summary: extractTag(item, "description"),
    url: extractTag(item, "link"),
    published_at: extractTag(item, "pubDate"),
    source: extractTag(item, "source") || "News RSS",
  })).filter((item) => item.title);
}

function detectState(content = "") {
  const lower = content.toLowerCase();

  for (const [abbr, name] of Object.entries(STATE_NAMES)) {
    if (lower.includes(name.toLowerCase()) || lower.includes(` ${abbr.toLowerCase()} `)) {
      return abbr;
    }
  }

  return null;
}

function scoreNarrative(item = {}) {
  const content = `${item.title || ""} ${item.summary || ""}`.toLowerCase();

  const negativeHits = NEGATIVE_TERMS.filter((term) => content.includes(term));
  const positiveHits = POSITIVE_TERMS.filter((term) => content.includes(term));
  const issueHits = ISSUE_TERMS.filter((term) => content.includes(term));

  let score = 35 + negativeHits.length * 14 + issueHits.length * 4 - positiveHits.length * 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const direction =
    negativeHits.length > positiveHits.length ? "negative" :
    positiveHits.length > negativeHits.length ? "positive" :
    "neutral";

  const severity =
    score >= 82 ? "critical" :
    score >= 65 ? "high" :
    score >= 42 ? "medium" :
    "low";

  const risk =
    score >= 82 ? "Critical" :
    score >= 65 ? "High" :
    score >= 42 ? "Elevated" :
    "Stable";

  return {
    score,
    risk,
    severity,
    direction,
    negativeHits,
    positiveHits,
    issueHits,
  };
}

async function getDefaultFirmId() {
  const { rows } = await pool.query(`SELECT id FROM firms ORDER BY id ASC LIMIT 1`).catch(() => ({ rows: [] }));
  return rows[0]?.id || 1;
}

export async function importNewsNarrativeSignals({ firmId = null, feeds = DEFAULT_FEEDS, limitPerFeed = 25 } = {}) {
  await ensurePoliticalSignalsTable();

  const resolvedFirmId = firmId || await getDefaultFirmId();

  let scanned = 0;
  let inserted = 0;
  let skipped = 0;

  for (const feed of feeds) {
    try {
      const { data } = await axios.get(feed, {
        timeout: 15000,
        headers: { "User-Agent": "VoterSpheres/1.0" },
      });

      const items = parseRssItems(data).slice(0, limitPerFeed);

      for (const item of items) {
        scanned += 1;

        const content = `${item.title} ${item.summary}`;
        const state = detectState(content);
        const narrative = scoreNarrative(item);
        const dedupeKey = `news:${item.url || item.title}`;

        const existing = await pool.query(
          `SELECT id FROM political_signals WHERE metadata->>'dedupe_key' = $1 LIMIT 1`,
          [dedupeKey]
        );

        if (existing.rows[0]) {
          skipped += 1;
          continue;
        }

        const title = `Narrative signal: ${item.title}`;
        const summary = item.summary || `News narrative signal detected from ${item.source}.`;

        const result = await pool.query(
          `
            INSERT INTO political_signals (
              firm_id, workspace_id, signal_type, source, title, summary,
              state, county, severity, signal_score, risk, url, metadata,
              observed_at, created_at, updated_at
            )
            VALUES ($1,NULL,'news',$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10::jsonb,$11,NOW(),NOW())
            RETURNING *
          `,
          [
            resolvedFirmId,
            item.source || "News RSS",
            title,
            summary,
            state,
            narrative.severity,
            narrative.score,
            narrative.risk,
            item.url || null,
            JSON.stringify({
              dedupe_key: dedupeKey,
              feed_url: feed,
              narrative_direction: narrative.direction,
              negative_terms: narrative.negativeHits,
              positive_terms: narrative.positiveHits,
              issue_terms: narrative.issueHits,
              published_at: item.published_at || null,
            }),
            item.published_at ? new Date(item.published_at) : new Date(),
          ]
        );

        inserted += 1;

        emitRealtimeEvent({
          type: "political.news_narrative.created",
          channel: "political-signals",
          firm_id: resolvedFirmId,
          state,
          payload: { signal: result.rows[0] },
        });
      }
    } catch (error) {
      console.warn("[news-narrative] feed failed", feed, error.message);
    }
  }

  return {
    ok: true,
    source: "News Narrative",
    scanned,
    inserted,
    skipped,
    firm_id: resolvedFirmId,
    updated_at: new Date().toISOString(),
  };
}

export async function getNarrativeDashboard({ firmId }) {
  await ensurePoliticalSignalsTable();

  const { rows } = await pool.query(
    `
      SELECT *
      FROM political_signals
      WHERE firm_id = $1
        AND signal_type = 'news'
      ORDER BY observed_at DESC, created_at DESC
      LIMIT 250
    `,
    [firmId]
  );

  const negative = rows.filter((row) => row.metadata?.narrative_direction === "negative");
  const positive = rows.filter((row) => row.metadata?.narrative_direction === "positive");

  const avg = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + Number(row.signal_score || 0), 0) / rows.length)
    : 0;

  return {
    summary: {
      total: rows.length,
      negative: negative.length,
      positive: positive.length,
      critical: rows.filter((row) => row.risk === "Critical").length,
      high: rows.filter((row) => row.risk === "High").length,
      average_score: avg,
      risk: avg >= 82 ? "Critical" : avg >= 65 ? "High" : avg >= 42 ? "Elevated" : "Stable",
    },
    signals: rows,
    updated_at: new Date().toISOString(),
  };
}
