import { getDarkMoneyExposure } from "./darkMoneyExposure.service.js";

 

const ENTITY_MAP = {

  amp: "&",

  apos: "'",

  gt: ">",

  lt: "<",

  nbsp: " ",

  quot: '"',

};

 

function clean(value = "") {

  return String(value ?? "")

    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {

      const key = String(entity).toLowerCase();

      if (ENTITY_MAP[key]) return ENTITY_MAP[key];

      if (key.startsWith("#x")) {

        const code = Number.parseInt(key.slice(2), 16);

        return Number.isFinite(code) ? String.fromCodePoint(code) : match;

      }

      if (key.startsWith("#")) {

        const code = Number.parseInt(key.slice(1), 10);

        return Number.isFinite(code) ? String.fromCodePoint(code) : match;

      }

      return match;

    })

    .replace(/<[^>]*>/g, " ")

    .replace(/\s+/g, " ")

    .trim();

}

 

function number(value = 0) {

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;

}

 

function money(value = 0) {

  return new Intl.NumberFormat("en-US", {

    style: "currency",

    currency: "USD",

    notation: "compact",

    maximumFractionDigits: 1,

  }).format(number(value));

}

 

function extractHref(value = "") {

  const match = String(value).match(/href\s*=\s*["']([^"']+)["']/i);

  const href = match?.[1] || "";

  return /^https?:\/\//i.test(href) ? href : "";

}

 

function extractAnchorText(value = "") {

  const match = String(value).match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);

  return clean(match?.[1] || "");

}

 

function rank(value = "") {

  const normalized = clean(value).toLowerCase();

  if (["critical", "urgent", "severe"].some((item) => normalized.includes(item))) return 4;

  if (["high", "elevated", "overdue"].some((item) => normalized.includes(item))) return 3;

  if (["medium", "watch", "review"].some((item) => normalized.includes(item))) return 2;

  return 1;

}

 

function severityForScore(score) {

  if (score >= 85) return "critical";

  if (score >= 70) return "high";

  if (score >= 50) return "medium";

  if (score >= 30) return "watch";

  return "low";

}

 

function normalizeNarrativeSignal(signal = {}) {

  const rawTitle = String(signal.title || "");

  const rawSummary = String(signal.summary || "");

  const anchorTitle = extractAnchorText(rawSummary) || extractAnchorText(rawTitle);

  const headline = clean(anchorTitle || rawTitle)

    .replace(/^narrative signal\s*:\s*/i, "")

    .replace(/\s+-\s+[^-]{2,90}$/i, "")

    .trim();

  const summary = clean(rawSummary)

    .replace(headline, "")

    .replace(/^[-–—:\s]+/, "")

    .trim();

  const score = number(signal.signal_score || signal.score);

 

  return {

    id: `signal-${signal.id}`,

    alert_type: "narrative",

    category: clean(signal.signal_type || "Political narrative"),

    headline: headline || "Political development requires review",

    summary: summary || "Review the source reporting and supporting evidence before taking action.",

    source_label: "Political Signals",

    evidence_type: "Narrative reporting",

    severity: clean(signal.severity || signal.risk || severityForScore(score)).toLowerCase(),

    score,

    state: clean(signal.state),

    published_at: signal.created_at || null,

    route: "/political-signals",

    external_url: extractHref(rawSummary) || extractHref(rawTitle) || null,

  };

}

 

function normalizePoliticalMoney(row = {}) {

  const score = number(row.exposure_score || row.dark_money_score);

  const committeeName = clean(row.committee_name || row.organization_name || row.committee_id);

  const amount = number(row.political_money_amount || row.total_amount);

  const activity = amount > 0 ? `${money(amount)} in mapped activity` : "mapped political-money activity";

 

  return {

    id: `fec-${row.committee_id || row.political_money_organization_id || committeeName}`,

    alert_type: "fec",

    category: "Political finance",

    headline: `${committeeName} requires political-finance review`,

    summary:

      `${committeeName} has ${activity} and a ${score}/100 exposure score. ` +

      "This is a review indicator, not a finding of wrongdoing.",

    source_label: "FEC / Political Money",

    evidence_type: row.data_origin === "political_money_evidence"

      ? "FEC-linked evidence"

      : "FEC committee activity",

    severity: clean(row.severity || severityForScore(score)).toLowerCase(),

    score,

    state: clean(row.organization_state || row.states?.[0]),

    published_at: row.last_activity || row.calculated_at || null,

    route: "/political-money-exposure",

    external_url: null,

    committee_id: clean(row.committee_id),

    committee_name: committeeName,

    amount,

    dark_money_indicator: Boolean(row.dark_money_indicator),

    exposure_tier: clean(row.exposure_tier),

  };

}

 

export async function getExecutiveMaterialAlerts({

  signals = [],

  cycle = 2026,

  state = "",

  limit = 4,

} = {}) {

  let politicalMoneyRows = [];

  let politicalMoneyAvailable = true;

 

  try {

    const result = await getDarkMoneyExposure({

      cycle,

      state,

      limit: 25,

    });

    politicalMoneyRows = Array.isArray(result?.results) ? result.results : [];

  } catch (error) {

    politicalMoneyAvailable = false;

    console.warn("[material-alerts] political-money source unavailable:", error.message);

  }

 

  const fecAlerts = politicalMoneyRows

    .filter((row) => row.committee_id)

    .map(normalizePoliticalMoney)

    .sort((a, b) => b.score - a.score);

 

  const narrativeAlerts = (Array.isArray(signals) ? signals : [])

    .map(normalizeNarrativeSignal)

    .sort((a, b) => rank(b.severity) - rank(a.severity) || b.score - a.score);

 

  const requestedLimit = Math.min(8, Math.max(1, number(limit) || 4));

  const fecSlots = Math.min(2, fecAlerts.length, requestedLimit);

  const selected = [

    ...fecAlerts.slice(0, fecSlots),

    ...narrativeAlerts.slice(0, requestedLimit - fecSlots),

  ];

 

  if (selected.length < requestedLimit) {

    selected.push(...fecAlerts.slice(fecSlots, fecSlots + requestedLimit - selected.length));

  }

 

  return {

    alerts: selected.slice(0, requestedLimit),

    summary: {

      shown: Math.min(selected.length, requestedLimit),

      total_candidates: fecAlerts.length + narrativeAlerts.length,

      fec_available: politicalMoneyAvailable,

      fec_records: fecAlerts.length,

      narrative_records: narrativeAlerts.length,

      cycle: number(cycle) || 2026,

      state: clean(state).toUpperCase(),

    },

  };

}

 

export default { getExecutiveMaterialAlerts };
