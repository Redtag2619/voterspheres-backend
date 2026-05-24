import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeState(value) {
  return clean(value).toUpperCase();
}

function getDefaultCycle() {
  return Number(process.env.FEC_DEFAULT_CYCLE || 2026);
}

function parseList(value, fallback = []) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (!value) return fallback;
  return String(value).split(",").map(clean).filter(Boolean);
}

function moneyNumber(value) {
  return Number(value || 0);
}

function moneyLabel(value) {
  const amount = moneyNumber(value);
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
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

function buildExposureNarrative(row = {}) {
  const committee = row.committee_name || row.committee_id || "This committee";
  const amount = moneyLabel(row.total_amount);
  const consultants = num(row.consultant_count);
  const candidates = num(row.candidate_count);
  const states = num(row.state_count);
  const parties = num(row.party_count);

  const flags = [];
  if (consultants >= 8) flags.push("dense consultant/vendor concentration");
  if (candidates >= 8) flags.push("broad candidate money-flow footprint");
  if (states >= 4) flags.push("multi-state influence chain");
  if (parties > 1) flags.push("cross-party exposure");
  if (num(row.battleground_amount) > 0) flags.push("battleground spending pressure");

  const flagText = flags.length
    ? `Signals include ${flags.join(", ")}.`
    : "Signals remain limited but should continue to be monitored.";

  return `${committee} is tied to ${amount} in mapped consultant-related disbursement activity across ${consultants} consultant/vendor relationship${consultants === 1 ? "" : "s"}, ${candidates} candidate relationship${candidates === 1 ? "" : "s"}, and ${states} state footprint${states === 1 ? "" : "s"}. ${flagText}`;
}

function buildWhereClause(options = {}) {
  const cycle = num(options.cycle, getDefaultCycle());
  const state = normalizeState(options.state);
  const party = clean(options.party);
  const search = clean(options.search);
  const committee = clean(options.committee);
  const consultant = clean(options.consultant);
  const candidate = clean(options.candidate);
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

  if (committee) {
    values.push(`%${committee}%`);
    where.push(`(r.committee_name ILIKE $${values.length} OR r.committee_id ILIKE $${values.length})`);
  }

  if (consultant) {
    values.push(`%${consultant}%`);
    where.push(`(c.name ILIKE $${values.length} OR c.firm_name ILIKE $${values.length})`);
  }

  if (candidate) {
    values.push(`%${candidate}%`);
    where.push(`r.candidate_name ILIKE $${values.length}`);
  }

  if (minAmount > 0) {
    values.push(minAmount);
    where.push(`COALESCE(r.total_amount, 0) >= $${values.length}`);
  }

  return {
    values,
    whereSql: where.join(" AND "),
    filters: {
      cycle,
      state,
      party,
      search,
      committee,
      consultant,
      candidate,
      min_amount: minAmount,
    },
  };
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dark_money_ccr_party
    ON consultant_candidate_relationships(candidate_party)
  `);
}

export async function getDarkMoneyExposure(options = {}) {
  await ensureDarkMoneyExposureSchema();

  const limit = Math.min(Math.max(num(options.limit, 100), 1), 500);
  const offset = Math.max(num(options.offset, 0), 0);
  const battlegroundStates = parseList(
    options.battlegroundStates || options.battleground_states || "AZ,GA,MI,NV,NC,PA,WI"
  ).map(normalizeState);

  const { values, whereSql, filters } = buildWhereClause(options);

  const exposureValues = [...values, battlegroundStates, limit, offset];
  const battlegroundParam = values.length + 1;
  const limitParam = values.length + 2;
  const offsetParam = values.length + 3;

  const exposureSql = `
    WITH committee_base AS (
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
        ARRAY_AGG(DISTINCT r.candidate_state) FILTER (
          WHERE r.candidate_state IS NOT NULL AND TRIM(r.candidate_state) <> ''
        ) AS states,
        ARRAY_AGG(DISTINCT r.candidate_party) FILTER (
          WHERE r.candidate_party IS NOT NULL AND TRIM(r.candidate_party) <> ''
        ) AS parties,
        ARRAY_AGG(DISTINCT r.category) FILTER (
          WHERE r.category IS NOT NULL AND TRIM(r.category) <> ''
        ) AS categories,
        COUNT(DISTINCT CASE
          WHEN UPPER(COALESCE(r.candidate_state, '')) = ANY($${battlegroundParam}::text[])
          THEN r.candidate_id
        END)::int AS battleground_candidate_count,
        COALESCE(SUM(CASE
          WHEN UPPER(COALESCE(r.candidate_state, '')) = ANY($${battlegroundParam}::text[])
          THEN r.total_amount
          ELSE 0
        END), 0)::numeric AS battleground_amount
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
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
            LEAST(24, LN(GREATEST(total_amount, 1)) * 2.5)
            + LEAST(22, consultant_count * 4)
            + LEAST(18, candidate_count * 2.5)
            + LEAST(14, state_count * 3)
            + LEAST(12, party_count * 8)
            + LEAST(10, category_count * 2)
            + CASE WHEN battleground_amount > 0 THEN 8 ELSE 0 END
          )
        )::int AS exposure_score
      FROM committee_base
    )
    SELECT *
    FROM scored
    ORDER BY exposure_score DESC, total_amount DESC, committee_name ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const exposureResult = await pool.query(exposureSql, exposureValues);

  const summaryResult = await pool.query(
    `
      WITH base AS (
        SELECT
          r.committee_id,
          COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
          COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
          COUNT(DISTINCT r.candidate_state)::int AS state_count,
          COUNT(DISTINCT r.candidate_party)::int AS party_count,
          COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount
        FROM consultant_candidate_relationships r
        LEFT JOIN consultants c ON c.id = r.consultant_id
        WHERE ${whereSql}
        GROUP BY r.committee_id
      ),
      scored AS (
        SELECT
          *,
          LEAST(
            100,
            ROUND(
              LEAST(24, LN(GREATEST(total_amount, 1)) * 2.5)
              + LEAST(22, consultant_count * 4)
              + LEAST(18, candidate_count * 2.5)
              + LEAST(14, state_count * 3)
              + LEAST(12, party_count * 8)
            )
          )::int AS exposure_score
        FROM base
      )
      SELECT
        COUNT(*)::int AS total_committees,
        COUNT(*) FILTER (WHERE exposure_score >= 85)::int AS critical_exposure,
        COUNT(*) FILTER (WHERE exposure_score >= 70)::int AS high_exposure,
        COUNT(*) FILTER (WHERE exposure_score >= 50)::int AS watch_exposure,
        COUNT(DISTINCT committee_id)::int AS committees_tracked,
        COALESCE(SUM(total_amount), 0)::numeric AS total_amount,
        ROUND(AVG(exposure_score)::numeric, 2) AS avg_exposure_score
      FROM scored
    `,
    values
  );

  const consultantClusterResult = await pool.query(
    `
      SELECT
        c.id AS consultant_id,
        COALESCE(c.name, c.firm_name, 'Unknown Consultant') AS consultant_name,
        c.firm_name,
        c.category,
        c.state,
        c.influence_score,
        c.exposure_score,
        c.risk_label,
        COUNT(DISTINCT r.committee_id)::int AS committee_count,
        COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
        COUNT(DISTINCT r.candidate_state)::int AS state_count,
        COUNT(DISTINCT r.candidate_party)::int AS party_count,
        ARRAY_AGG(DISTINCT r.candidate_state) FILTER (WHERE r.candidate_state IS NOT NULL) AS states,
        ARRAY_AGG(DISTINCT r.candidate_party) FILTER (WHERE r.candidate_party IS NOT NULL) AS parties,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
        MAX(r.last_disbursement_date) AS last_activity,
        LEAST(
          100,
          ROUND(
            LEAST(30, LN(GREATEST(COALESCE(SUM(r.total_amount), 0), 1)) * 3)
            + LEAST(25, COUNT(DISTINCT r.committee_id) * 5)
            + LEAST(20, COUNT(DISTINCT r.candidate_id) * 3)
            + LEAST(15, COUNT(DISTINCT r.candidate_state) * 3)
            + LEAST(10, COUNT(DISTINCT r.candidate_party) * 8)
          )
        )::int AS cluster_score
      FROM consultant_candidate_relationships r
      JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
      GROUP BY
        c.id,
        c.name,
        c.firm_name,
        c.category,
        c.state,
        c.influence_score,
        c.exposure_score,
        c.risk_label
      HAVING COUNT(DISTINCT r.committee_id) >= 2
      ORDER BY cluster_score DESC, total_amount DESC
      LIMIT 25
    `,
    values
  );

  const crossPartyResult = await pool.query(
    `
      SELECT
        r.consultant_id,
        COALESCE(c.name, c.firm_name, 'Unknown Consultant') AS consultant_name,
        c.category,
        c.state,
        COUNT(DISTINCT r.candidate_party)::int AS party_count,
        COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
        COUNT(DISTINCT r.committee_id)::int AS committee_count,
        ARRAY_AGG(DISTINCT r.candidate_party) FILTER (WHERE r.candidate_party IS NOT NULL) AS parties,
        ARRAY_AGG(DISTINCT r.candidate_state) FILTER (WHERE r.candidate_state IS NOT NULL) AS states,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
        LEAST(
          100,
          ROUND(
            LEAST(40, COUNT(DISTINCT r.candidate_party) * 20)
            + LEAST(25, COUNT(DISTINCT r.candidate_id) * 4)
            + LEAST(20, COUNT(DISTINCT r.committee_id) * 4)
            + LEAST(15, LN(GREATEST(COALESCE(SUM(r.total_amount), 0), 1)) * 2)
          )
        )::int AS exposure_score
      FROM consultant_candidate_relationships r
      JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
      GROUP BY r.consultant_id, c.name, c.firm_name, c.category, c.state
      HAVING COUNT(DISTINCT r.candidate_party) > 1
      ORDER BY exposure_score DESC, total_amount DESC
      LIMIT 25
    `,
    values
  );

  const stateChainResult = await pool.query(
    `
      SELECT
        COALESCE(r.candidate_state, 'Unknown') AS state,
        COUNT(DISTINCT r.committee_id)::int AS committee_count,
        COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
        COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
        COUNT(DISTINCT r.candidate_party)::int AS party_count,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
        LEAST(
          100,
          ROUND(
            LEAST(35, LN(GREATEST(COALESCE(SUM(r.total_amount), 0), 1)) * 3)
            + LEAST(25, COUNT(DISTINCT r.committee_id) * 3)
            + LEAST(25, COUNT(DISTINCT r.consultant_id) * 3)
            + LEAST(15, COUNT(DISTINCT r.candidate_id) * 2)
          )
        )::int AS pressure_score
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
      GROUP BY COALESCE(r.candidate_state, 'Unknown')
      ORDER BY pressure_score DESC, total_amount DESC
      LIMIT 25
    `,
    values
  );

  const candidateExposureResult = await pool.query(
    `
      SELECT
        r.candidate_id,
        r.candidate_name,
        r.candidate_state,
        r.candidate_office,
        r.candidate_party,
        COUNT(DISTINCT r.committee_id)::int AS committee_count,
        COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
        COUNT(DISTINCT r.category)::int AS category_count,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
        LEAST(
          100,
          ROUND(
            LEAST(35, LN(GREATEST(COALESCE(SUM(r.total_amount), 0), 1)) * 3)
            + LEAST(25, COUNT(DISTINCT r.committee_id) * 5)
            + LEAST(25, COUNT(DISTINCT r.consultant_id) * 5)
            + LEAST(15, COUNT(DISTINCT r.category) * 3)
          )
        )::int AS exposure_score
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
      GROUP BY
        r.candidate_id,
        r.candidate_name,
        r.candidate_state,
        r.candidate_office,
        r.candidate_party
      ORDER BY exposure_score DESC, total_amount DESC
      LIMIT 25
    `,
    values
  );

  const results = exposureResult.rows.map((row) => ({
    ...row,
    exposure_tier: exposureTier(row.exposure_score),
    severity: severityFromScore(row.exposure_score),
    narrative: buildExposureNarrative(row),
  }));

  const topExposure = results.slice(0, 10);
  const summary = summaryResult.rows[0] || {};

  return {
    ok: true,
    cycle: filters.cycle,
    limit,
    offset,
    filters: {
      ...filters,
      battleground_states: battlegroundStates,
    },
    summary,
    results,
    top_exposure: topExposure,
    consultant_clusters: consultantClusterResult.rows.map((row) => ({
      ...row,
      exposure_tier: exposureTier(row.cluster_score),
      severity: severityFromScore(row.cluster_score),
    })),
    cross_party_exposure: crossPartyResult.rows.map((row) => ({
      ...row,
      exposure_tier: exposureTier(row.exposure_score),
      severity: severityFromScore(row.exposure_score),
    })),
    state_chains: stateChainResult.rows.map((row) => ({
      ...row,
      exposure_tier: exposureTier(row.pressure_score),
      severity: severityFromScore(row.pressure_score),
    })),
    candidate_exposure: candidateExposureResult.rows.map((row) => ({
      ...row,
      exposure_tier: exposureTier(row.exposure_score),
      severity: severityFromScore(row.exposure_score),
    })),
    briefing: [
      `${summary.total_committees || 0} committees are tracked in the current exposure model.`,
      `${summary.high_exposure || 0} committees are high-exposure or higher, with ${summary.critical_exposure || 0} in critical exposure.`,
      `${moneyLabel(summary.total_amount)} in mapped consultant-related money flow is represented in this dark-money exposure layer.`,
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

  const relationships = await pool.query(
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
        c.risk_label,
        cand.fec_candidate_id,
        cand.website AS candidate_website,
        cand.contact_email AS candidate_contact_email,
        cand.press_email AS candidate_press_email,
        cand.phone AS candidate_phone,
        cp.campaign_website,
        cp.official_website,
        cp.email AS profile_email,
        cp.press_contact_email,
        cp.phone AS profile_phone,
        cp.contact_confidence
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      LEFT JOIN candidates cand ON cand.id = r.candidate_id
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = cand.id
      WHERE r.cycle = $1
        AND r.committee_id = $2
      ORDER BY COALESCE(r.total_amount, 0) DESC, COALESCE(r.transaction_count, 0) DESC
      LIMIT 500
    `,
    [cycle, id]
  );

  if (!relationships.rows.length) return null;

  const totalAmount = relationships.rows.reduce((sum, row) => sum + moneyNumber(row.total_amount), 0);
  const consultantCount = new Set(relationships.rows.map((row) => row.consultant_id).filter(Boolean)).size;
  const candidateCount = new Set(relationships.rows.map((row) => row.candidate_id).filter(Boolean)).size;
  const stateCount = new Set(relationships.rows.map((row) => row.candidate_state).filter(Boolean)).size;
  const partyCount = new Set(relationships.rows.map((row) => row.candidate_party).filter(Boolean)).size;

  const exposureScore = Math.min(
    100,
    Math.round(
      Math.min(30, Math.log10(Math.max(totalAmount, 1)) * 3) +
        Math.min(25, consultantCount * 5) +
        Math.min(20, candidateCount * 3) +
        Math.min(15, stateCount * 3) +
        Math.min(10, partyCount * 8)
    )
  );

  return {
    ok: true,
    cycle,
    committee_id: id,
    summary: {
      total_amount: totalAmount,
      consultant_count: consultantCount,
      candidate_count: candidateCount,
      state_count: stateCount,
      party_count: partyCount,
      exposure_score: exposureScore,
      exposure_tier: exposureTier(exposureScore),
      severity: severityFromScore(exposureScore),
    },
    relationships: relationships.rows,
  };
}
