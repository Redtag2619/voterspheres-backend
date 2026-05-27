import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function getDefaultCycle() {
  return Number(process.env.FEC_DEFAULT_CYCLE || 2026);
}

function moneyNumber(value) {
  return Number(value || 0);
}

function exposureTier(score) {
  const value = num(score);
  if (value >= 85) return "Critical Exposure";
  if (value >= 70) return "High Exposure";
  if (value >= 50) return "Watch Closely";
  if (value >= 30) return "Emerging Exposure";
  return "Low Signal";
}

function severityFromScore(score) {
  const value = num(score);
  if (value >= 85) return "critical";
  if (value >= 70) return "high";
  if (value >= 50) return "medium";
  if (value >= 30) return "watch";
  return "low";
}

function moneyLabel(value) {
  const amount = moneyNumber(value);
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

export async function ensureDarkMoneyExposureSchema() {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_cycle_committee
    ON consultant_candidate_relationships(cycle, committee_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_consultant
    ON consultant_candidate_relationships(consultant_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_candidate_state
    ON consultant_candidate_relationships(candidate_state)
  `);
}

export async function getDarkMoneyExposure(options = {}) {
  await ensureDarkMoneyExposureSchema();

  const cycle = num(options.cycle, getDefaultCycle());
  const limit = Math.min(Math.max(num(options.limit, 100), 1), 500);
  const state = clean(options.state).toUpperCase();
  const party = clean(options.party);
  const search = clean(options.search);
  const minAmount = num(options.minAmount || options.min_amount, 0);

  const values = [cycle];
  const where = [
    "r.cycle = $1",
    "r.committee_id IS NOT NULL",
    "TRIM(r.committee_id) <> ''",
  ];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(r.candidate_state, '')) = $${values.length}`);
  }

  if (party) {
    values.push(`%${party}%`);
    where.push(`COALESCE(r.candidate_party, '') ILIKE $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    where.push(`(
      r.committee_name ILIKE $${values.length}
      OR r.committee_id ILIKE $${values.length}
      OR r.candidate_name ILIKE $${values.length}
      OR c.name ILIKE $${values.length}
      OR c.firm_name ILIKE $${values.length}
      OR r.category ILIKE $${values.length}
      OR r.purpose ILIKE $${values.length}
    )`);
  }

  if (minAmount > 0) {
    values.push(minAmount);
    where.push(`COALESCE(r.total_amount, 0) >= $${values.length}`);
  }

  values.push(limit);
  const limitParam = values.length;

  const result = await pool.query(
    `
      WITH base AS (
        SELECT
          r.committee_id,
          COALESCE(NULLIF(TRIM(r.committee_name), ''), r.committee_id) AS committee_name,
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
            FILTER (WHERE r.candidate_state IS NOT NULL AND TRIM(r.candidate_state) <> '') AS states,
          ARRAY_AGG(DISTINCT r.candidate_party)
            FILTER (WHERE r.candidate_party IS NOT NULL AND TRIM(r.candidate_party) <> '') AS parties,
          ARRAY_AGG(DISTINCT r.category)
            FILTER (WHERE r.category IS NOT NULL AND TRIM(r.category) <> '') AS categories
        FROM consultant_candidate_relationships r
        LEFT JOIN consultants c ON c.id = r.consultant_id
        WHERE ${where.join(" AND ")}
        GROUP BY
          r.committee_id,
          COALESCE(NULLIF(TRIM(r.committee_name), ''), r.committee_id)
      ),
      scored AS (
        SELECT
          *,
          LEAST(
            100,
            ROUND(
              LEAST(28, LN(GREATEST(total_amount, 1)) * 3)
              + LEAST(24, consultant_count * 4)
              + LEAST(18, candidate_count * 3)
              + LEAST(16, state_count * 3)
              + LEAST(14, party_count * 8)
            )
          )::int AS exposure_score
        FROM base
      )
      SELECT *
      FROM scored
      ORDER BY exposure_score DESC, total_amount DESC
      LIMIT $${limitParam}
    `,
    values
  );

  const rows = result.rows.map((row) => {
    const score = num(row.exposure_score);

    return {
      ...row,
      exposure_tier: exposureTier(score),
      severity: severityFromScore(score),
      narrative: `${row.committee_name || row.committee_id} is tied to ${moneyLabel(
        row.total_amount
      )} in mapped consultant-related disbursement activity across ${
        row.consultant_count || 0
      } consultant/vendor links, ${row.candidate_count || 0} candidate links, and ${
        row.state_count || 0
      } state footprints.`,
    };
  });

  const totalAmount = rows.reduce(
    (sum, row) => sum + moneyNumber(row.total_amount),
    0
  );

  return {
    ok: true,
    cycle,
    limit,
    filters: {
      cycle,
      state,
      party,
      search,
      min_amount: minAmount,
    },
    summary: {
      total_committees: rows.length,
      high_exposure: rows.filter((row) => num(row.exposure_score) >= 70).length,
      critical_exposure: rows.filter((row) => num(row.exposure_score) >= 85).length,
      total_amount: totalAmount,
    },
    results: rows,
    top_exposure: rows.slice(0, 10),
    consultant_clusters: [],
    cross_party_exposure: [],
    state_chains: [],
    candidate_exposure: [],
    briefing: [
      `${rows.length} committees are currently tracked in the dark-money exposure model.`,
      `${rows.filter((row) => num(row.exposure_score) >= 70).length} committees are high exposure or higher.`,
      `${moneyLabel(totalAmount)} in mapped consultant-related money flow is currently represented.`,
    ],
  };
}

export async function getDarkMoneyExposureProfile(committeeId, options = {}) {
  await ensureDarkMoneyExposureSchema();

  const id = clean(committeeId);

  if (!id) {
    const error = new Error("Invalid committee id");
    error.statusCode = 400;
    throw error;
  }

  const cycle = num(options.cycle, getDefaultCycle());

  const result = await pool.query(
    `
      SELECT
        r.*,
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
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE r.cycle = $1
        AND r.committee_id = $2
      ORDER BY COALESCE(r.total_amount, 0) DESC
      LIMIT 500
    `,
    [cycle, id]
  );

  if (!result.rows.length) return null;

  return {
    ok: true,
    cycle,
    committee_id: id,
    relationships: result.rows,
  };
}
