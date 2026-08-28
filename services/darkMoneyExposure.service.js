import pool from "../config/database.js";
import {
  POLITICAL_MONEY_BUILD,
  getPoliticalMoneyEvidenceProfile,
} from "./politicalMoneyEvidence.service.js";

const clean = (value = "") =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value) => number(value);

const limitValue = (value, fallback = 100, maximum = 500) =>
  Math.min(maximum, Math.max(1, number(value, fallback)));

const list = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [value];
};

function defaultCycle() {
  return number(process.env.FEC_DEFAULT_CYCLE, 2026);
}

function exposureTier(score) {
  if (score >= 85) return "Critical Exposure";
  if (score >= 70) return "High Exposure";
  if (score >= 50) return "Watch Closely";
  if (score >= 30) return "Emerging Exposure";
  return "Low Signal";
}

function severity(score) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "watch";
  return "low";
}

function moneyLabel(value) {
  const amount = money(value);
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

async function schemaAvailable() {
  const result = await pool.query(
    `SELECT to_regclass('public.political_money_scores') AS scores`
  );

  return Boolean(result.rows[0]?.scores);
}

export async function ensureDarkMoneyExposureSchema() {
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_cycle_committee
       ON consultant_candidate_relationships(cycle, committee_id)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_consultant
       ON consultant_candidate_relationships(consultant_id)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_candidate_state
       ON consultant_candidate_relationships(candidate_state)`
  );
}

async function evidenceByCommittee(cycle) {
  if (!(await schemaAvailable())) return new Map();

  const result = await pool.query(
    `WITH transaction_totals AS (
       SELECT source_organization_id AS organization_id,
              COALESCE(
                SUM(amount) FILTER (
                  WHERE transaction_type = 'independent_expenditure'
                ),
                0
              )::numeric AS independent_expenditure_amount
         FROM political_money_transactions
        WHERE cycle = $1
        GROUP BY source_organization_id
     ),
     evidence_totals AS (
       SELECT organization_id,
              COALESCE(
                SUM(amount) FILTER (
                  WHERE evidence_type = 'nonprofit_spending'
                ),
                0
              )::numeric AS nonprofit_spending_amount,
              COALESCE(
                SUM(amount) FILTER (
                  WHERE evidence_type = 'organization_transfer'
                ),
                0
              )::numeric AS organization_transfer_amount,
              COUNT(*)::int AS evidence_record_count
         FROM political_money_evidence
        WHERE CASE
                WHEN COALESCE(metadata->>'cycle', '') ~ '^[0-9]+$'
                  THEN (metadata->>'cycle')::int
                ELSE $1
              END = $1
        GROUP BY organization_id
     )
     SELECT DISTINCT ON (i.identifier_value)
            i.identifier_value AS committee_id,
            o.id AS political_money_organization_id,
            o.canonical_name AS organization_name,
            o.organization_type,
            o.state AS organization_state,
            s.dark_money_score,
            s.disclosure_gap_score,
            s.nonprofit_spending_score,
            s.independent_expenditure_score,
            s.organization_transfer_score,
            s.shell_organization_score,
            s.indicator_count,
            s.review_tier,
            s.human_review_required,
            s.reasons,
            s.calculated_at,
            COALESCE(
              t.independent_expenditure_amount,
              0
            )::numeric AS independent_expenditure_amount,
            COALESCE(
              e.nonprofit_spending_amount,
              0
            )::numeric AS nonprofit_spending_amount,
            COALESCE(
              e.organization_transfer_amount,
              0
            )::numeric AS organization_transfer_amount,
            COALESCE(e.evidence_record_count, 0)::int AS evidence_record_count
       FROM political_money_identifiers i
       JOIN political_money_organizations o
         ON o.id = i.organization_id
       LEFT JOIN political_money_scores s
         ON s.organization_id = o.id
        AND s.cycle = $1
       LEFT JOIN transaction_totals t
         ON t.organization_id = o.id
       LEFT JOIN evidence_totals e
         ON e.organization_id = o.id
      WHERE i.identifier_type = 'fec_committee_id'
      ORDER BY
        i.identifier_value,
        s.calculated_at DESC NULLS LAST,
        o.id`,
    [cycle]
  );

  return new Map(
    result.rows.map((row) => [clean(row.committee_id), row])
  );
}

async function legacyCommitteeRows(cycle) {
  const result = await pool.query(
    `WITH base AS (
       SELECT r.committee_id,
              COALESCE(
                NULLIF(TRIM(r.committee_name), ''),
                r.committee_id
              ) AS committee_name,
              COUNT(*)::int AS relationship_rows,
              COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
              COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
              COUNT(DISTINCT r.candidate_state)::int AS state_count,
              COUNT(DISTINCT r.candidate_party)::int AS party_count,
              COUNT(DISTINCT r.category)::int AS category_count,
              COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
              COALESCE(SUM(r.transaction_count), 0)::int AS transaction_count,
              MAX(r.last_disbursement_date) AS last_activity,
              ARRAY_AGG(DISTINCT r.candidate_state)
                FILTER (
                  WHERE NULLIF(TRIM(r.candidate_state), '') IS NOT NULL
                ) AS states,
              ARRAY_AGG(DISTINCT r.candidate_party)
                FILTER (
                  WHERE NULLIF(TRIM(r.candidate_party), '') IS NOT NULL
                ) AS parties,
              ARRAY_AGG(DISTINCT r.category)
                FILTER (
                  WHERE NULLIF(TRIM(r.category), '') IS NOT NULL
                ) AS categories
         FROM consultant_candidate_relationships r
        WHERE r.cycle = $1
          AND r.committee_id IS NOT NULL
          AND TRIM(r.committee_id) <> ''
        GROUP BY
          r.committee_id,
          COALESCE(
            NULLIF(TRIM(r.committee_name), ''),
            r.committee_id
          )
     )
     SELECT *,
            LEAST(
              100,
              ROUND(
                LEAST(28, LN(GREATEST(total_amount, 1)) * 3) +
                LEAST(24, consultant_count * 4) +
                LEAST(18, candidate_count * 3) +
                LEAST(16, state_count * 3) +
                LEAST(14, party_count * 8)
              )
            )::int AS exposure_score
       FROM base
      ORDER BY exposure_score DESC, total_amount DESC
      LIMIT 500`,
    [cycle]
  );

  return result.rows;
}

function politicalMoneyAmount(row = {}) {
  return (
    money(row.independent_expenditure_amount) +
    money(row.nonprofit_spending_amount) +
    money(row.organization_transfer_amount)
  );
}

function evidenceOnlyRow(committeeId, linked = {}) {
  const activityAmount = politicalMoneyAmount(linked);

  return {
    committee_id: committeeId,
    committee_name:
      clean(linked.organization_name) || committeeId,
    relationship_rows: 0,
    consultant_count: 0,
    candidate_count: 0,
    state_count: clean(linked.organization_state) ? 1 : 0,
    party_count: 0,
    category_count: 0,
    total_amount: activityAmount,
    transaction_count: 0,
    last_activity: linked.calculated_at || null,
    states: clean(linked.organization_state)
      ? [clean(linked.organization_state)]
      : [],
    parties: [],
    categories: ["political_money_evidence"],
    exposure_score: 0,
    data_origin: "political_money_evidence",
  };
}

function unifiedRow(base = {}, linked = {}) {
  const legacyScore = number(base.exposure_score);
  const darkScore = number(linked.dark_money_score);
  const combinedScore =
    darkScore > 0
      ? Math.max(legacyScore, darkScore)
      : legacyScore;
  const activityAmount = politicalMoneyAmount(linked);
  const legacyAmount = money(base.total_amount);
  const displayAmount =
    base.data_origin === "political_money_evidence"
      ? activityAmount
      : legacyAmount;

  return {
    ...base,
    ...linked,
    committee_id: clean(base.committee_id || linked.committee_id),
    committee_name:
      clean(base.committee_name) ||
      clean(linked.organization_name) ||
      clean(base.committee_id || linked.committee_id),
    data_origin:
      base.data_origin ||
      (linked.political_money_organization_id
        ? "consultant_and_political_money"
        : "consultant_relationships"),
    total_amount: displayAmount,
    consultant_activity_amount: legacyAmount,
    political_money_amount: activityAmount,
    exposure_score: combinedScore,
    dark_money_indicator:
      darkScore >= 30 &&
      number(linked.indicator_count) >= 1,
    exposure_tier: exposureTier(combinedScore),
    severity: severity(combinedScore),
    narrative:
      `${base.committee_name || linked.organization_name || base.committee_id} ` +
      `has ${moneyLabel(displayAmount)} in mapped activity` +
      `${darkScore ? ` and a ${darkScore}/100 political-money disclosure review score` : ""}. ` +
      "This is an investigative indicator, not a finding of wrongdoing.",
  };
}

function matchesFilters(row, options = {}) {
  const state = clean(options.state).toUpperCase();
  const party = clean(options.party).toLowerCase();
  const search = clean(options.search).toLowerCase();
  const minAmount = number(options.minAmount || options.min_amount);

  const states = [
    ...list(row.states),
    row.organization_state,
  ]
    .map((value) => clean(value).toUpperCase())
    .filter(Boolean);

  const parties = list(row.parties)
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);

  const searchable = [
    row.committee_id,
    row.committee_name,
    row.organization_name,
    row.organization_type,
    ...states,
    ...parties,
    ...list(row.categories),
  ]
    .map((value) => clean(value).toLowerCase())
    .join(" ");

  if (state && !states.includes(state)) return false;
  if (party && !parties.some((value) => value.includes(party))) {
    return false;
  }
  if (search && !searchable.includes(search)) return false;
  if (minAmount > 0 && money(row.total_amount) < minAmount) return false;

  return true;
}

export async function getDarkMoneyExposure(options = {}) {
  await ensureDarkMoneyExposureSchema();

  const cycle = number(options.cycle, defaultCycle());
  const limit = limitValue(options.limit);
  const indicatorsOnly = ["1", "true", "yes"].includes(
    clean(
      options.dark_money_indicators ||
        options.darkIndicatorsOnly
    ).toLowerCase()
  );

  const [legacyRows, evidence] = await Promise.all([
    legacyCommitteeRows(cycle),
    evidenceByCommittee(cycle),
  ]);

  const merged = new Map();

  for (const legacy of legacyRows) {
    const committeeId = clean(legacy.committee_id);
    const linked = evidence.get(committeeId) || {};
    merged.set(committeeId, unifiedRow(legacy, linked));
  }

  for (const [committeeId, linked] of evidence.entries()) {
    if (merged.has(committeeId)) continue;
    const base = evidenceOnlyRow(committeeId, linked);
    merged.set(committeeId, unifiedRow(base, linked));
  }

  let rows = Array.from(merged.values()).filter((row) =>
    matchesFilters(row, options)
  );

  if (indicatorsOnly) {
    rows = rows.filter(
      (row) =>
        row.dark_money_indicator ||
        ["high", "critical"].includes(row.severity)
    );
  }

  rows.sort(
    (left, right) =>
      number(right.exposure_score) -
        number(left.exposure_score) ||
      money(right.total_amount) - money(left.total_amount) ||
      clean(left.committee_name).localeCompare(
        clean(right.committee_name)
      )
  );

  rows = rows.slice(0, limit);

  const totalAmount = rows.reduce(
    (sum, row) => sum + money(row.total_amount),
    0
  );

  const evidenceOnlyCount = rows.filter(
    (row) => row.data_origin === "political_money_evidence"
  ).length;

  return {
    ok: true,
    build: POLITICAL_MONEY_BUILD,
    cycle,
    limit,
    filters: {
      cycle,
      state: clean(options.state).toUpperCase(),
      party: clean(options.party),
      search: clean(options.search),
      min_amount: number(options.minAmount || options.min_amount),
      dark_money_indicators: indicatorsOnly,
    },
    summary: {
      total_committees: rows.length,
      high_exposure: rows.filter(
        (row) => number(row.exposure_score) >= 70
      ).length,
      critical_exposure: rows.filter(
        (row) => number(row.exposure_score) >= 85
      ).length,
      dark_money_indicator_records: rows.filter(
        (row) => row.dark_money_indicator
      ).length,
      evidence_only_organizations: evidenceOnlyCount,
      total_amount: totalAmount,
    },
    results: rows,
    top_exposure: rows.slice(0, 10),
    consultant_clusters: [],
    cross_party_exposure: [],
    state_chains: [],
    candidate_exposure: [],
    briefing: [
      `${rows.length} committees are represented in the Political Money Exposure model.`,
      `${evidenceOnlyCount} organizations were added from the source-backed political-money evidence registry.`,
      `${rows.filter((row) => row.dark_money_indicator).length} records contain source-backed dark-money review indicators.`,
      `${moneyLabel(totalAmount)} in mapped political-money and consultant-related activity is represented.`,
      "Indicators require cited evidence and human review; they are not findings of unlawful conduct.",
    ],
  };
}

export async function getDarkMoneyExposureProfile(
  committeeId,
  options = {}
) {
  await ensureDarkMoneyExposureSchema();

  const id = clean(committeeId);
  if (!id) {
    const error = new Error("Invalid committee id");
    error.statusCode = 400;
    throw error;
  }

  const cycle = number(options.cycle, defaultCycle());

  const relationships = await pool.query(
    `SELECT r.*,
            c.name AS consultant_name,
            c.firm_name,
            c.category AS consultant_category,
            c.state AS consultant_state,
            c.website AS consultant_website,
            c.email AS consultant_email,
            c.phone AS consultant_phone,
            c.influence_score,
            c.exposure_score,
            c.risk_label
       FROM consultant_candidate_relationships r
       LEFT JOIN consultants c
         ON c.id = r.consultant_id
      WHERE r.cycle = $1
        AND TRIM(r.committee_id) = TRIM($2)
      ORDER BY COALESCE(r.total_amount, 0) DESC
      LIMIT 500`,
    [cycle, id]
  );

  const evidenceMap = await evidenceByCommittee(cycle);
  const linked = evidenceMap.get(id);

  const evidenceProfile = linked?.political_money_organization_id
    ? await getPoliticalMoneyEvidenceProfile(
        linked.political_money_organization_id,
        { limit: options.limit || 250 }
      )
    : null;

  if (!relationships.rows.length && !evidenceProfile) return null;

  return {
    ok: true,
    build: POLITICAL_MONEY_BUILD,
    cycle,
    committee_id: id,
    data_origin:
      relationships.rows.length && evidenceProfile
        ? "consultant_and_political_money"
        : evidenceProfile
          ? "political_money_evidence"
          : "consultant_relationships",
    relationships: relationships.rows,
    political_money: evidenceProfile,
  };
}

export default {
  getDarkMoneyExposure,
  getDarkMoneyExposureProfile,
