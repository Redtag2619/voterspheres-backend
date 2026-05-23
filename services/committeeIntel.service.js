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

function riskLabel(score) {
  const value = num(score);
  if (value >= 80) return "High Concentration";
  if (value >= 60) return "Watch Closely";
  if (value >= 40) return "Active Committee";
  return "Emerging Signal";
}

function buildNarrative(row = {}) {
  const committee = row.committee_name || "This committee";
  const amount = Number(row.total_amount || 0).toLocaleString();
  const consultants = num(row.consultant_count);
  const candidates = num(row.candidate_count);
  const states = Array.isArray(row.states) ? row.states.length : 0;
  const parties = Array.isArray(row.parties) ? row.parties.length : 0;

  const flags = [];

  if (consultants >= 10) flags.push("dense consultant/vendor footprint");
  if (candidates >= 10) flags.push("broad candidate relationship map");
  if (states >= 5) flags.push("multi-state activity");
  if (parties > 1) flags.push("cross-party exposure");

  const risk = flags.length
    ? `Key signals: ${flags.join(", ")}.`
    : "Current signals show a limited or focused footprint.";

  return `${committee} is mapped to $${amount} in consultant-related disbursement activity across ${consultants} consultant/vendor relationship${consultants === 1 ? "" : "s"} and ${candidates} candidate relationship${candidates === 1 ? "" : "s"}. ${risk}`;
}

export async function ensureCommitteeIntelSchema() {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ccr_committee_id
    ON consultant_candidate_relationships(committee_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ccr_committee_cycle
    ON consultant_candidate_relationships(cycle, committee_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ccr_candidate_state
    ON consultant_candidate_relationships(candidate_state)
  `);
}

function buildWhereClause({ cycle, search, state, party }) {
  const values = [cycle];
  const where = [
    "r.cycle = $1",
    "r.committee_id IS NOT NULL",
    "TRIM(r.committee_id) <> ''",
  ];

  if (search) {
    values.push(`%${search}%`);
    where.push(`(
      r.committee_name ILIKE $${values.length}
      OR r.committee_id ILIKE $${values.length}
      OR r.candidate_name ILIKE $${values.length}
      OR c.name ILIKE $${values.length}
      OR c.firm_name ILIKE $${values.length}
    )`);
  }

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(r.candidate_state, '')) = $${values.length}`);
  }

  if (party) {
    values.push(`%${party}%`);
    where.push(`COALESCE(r.candidate_party, '') ILIKE $${values.length}`);
  }

  return {
    values,
    whereSql: where.join(" AND "),
  };
}

export async function getCommitteeIntel(options = {}) {
  await ensureCommitteeIntelSchema();

  const cycle = num(options.cycle, getDefaultCycle());
  const limit = Math.min(Math.max(num(options.limit, 500), 1), 1000);
  const offset = Math.max(num(options.offset, 0), 0);
  const search = clean(options.search);
  const state = normalizeState(options.state);
  const party = clean(options.party);
  const minAmount = num(options.minAmount || options.min_amount, 0);

  const battlegroundStates = parseList(
    options.battlegroundStates ||
      options.battleground_states ||
      "AZ,GA,MI,NV,NC,PA,WI"
  ).map(normalizeState);

  const { values, whereSql } = buildWhereClause({
    cycle,
    search,
    state,
    party,
  });

  const committeesValues = [
    ...values,
    battlegroundStates,
    minAmount,
    limit,
    offset,
  ];

  const battlegroundParam = values.length + 1;
  const minAmountParam = values.length + 2;
  const limitParam = values.length + 3;
  const offsetParam = values.length + 4;

  const committeesSql = `
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
        ARRAY_AGG(DISTINCT r.candidate_office) FILTER (
          WHERE r.candidate_office IS NOT NULL AND TRIM(r.candidate_office) <> ''
        ) AS offices,
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
            LEAST(35, LN(GREATEST(total_amount, 1)) * 3)
            + LEAST(25, consultant_count * 5)
            + LEAST(20, candidate_count * 3)
            + LEAST(10, state_count * 2)
            + LEAST(10, party_count * 5)
          )
        ) AS concentration_score
      FROM committee_base
      WHERE total_amount >= $${minAmountParam}
    )
    SELECT *
    FROM scored
    ORDER BY total_amount DESC, concentration_score DESC, committee_name ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const committeeResult = await pool.query(committeesSql, committeesValues);

  const summaryResult = await pool.query(
    `
      SELECT
        COUNT(DISTINCT r.committee_id)::int AS total_committees,
        COUNT(DISTINCT r.consultant_id)::int AS total_consultants,
        COUNT(DISTINCT r.candidate_id)::int AS total_candidates,
        COUNT(DISTINCT r.candidate_state)::int AS total_states,
        COUNT(DISTINCT r.candidate_party)::int AS total_parties,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
        COALESCE(SUM(r.transaction_count), 0)::int AS total_transactions,
        COUNT(*)::int AS total_relationship_rows
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
    `,
    values
  );

  const heatmapResult = await pool.query(
    `
      SELECT
        COALESCE(r.candidate_state, 'Unknown') AS state,
        COUNT(DISTINCT r.committee_id)::int AS committee_count,
        COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
        COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
        COALESCE(SUM(r.transaction_count), 0)::int AS transaction_count
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE ${whereSql}
      GROUP BY COALESCE(r.candidate_state, 'Unknown')
      ORDER BY total_amount DESC
      LIMIT 25
    `,
    values
  );

  const concentrationValues = [...values, minAmount];

  const concentrationResult = await pool.query(
    `
      WITH base AS (
        SELECT
          r.committee_id,
          COALESCE(NULLIF(TRIM(r.committee_name), ''), r.committee_id) AS committee_name,
          COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
          COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
          COUNT(DISTINCT r.candidate_party)::int AS party_count,
          COUNT(DISTINCT r.candidate_state)::int AS state_count,
          COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount
        FROM consultant_candidate_relationships r
        LEFT JOIN consultants c ON c.id = r.consultant_id
        WHERE ${whereSql}
        GROUP BY
          r.committee_id,
          COALESCE(NULLIF(TRIM(r.committee_name), ''), r.committee_id)
      )
      SELECT
        *,
        LEAST(
          100,
          ROUND(
            LEAST(35, LN(GREATEST(total_amount, 1)) * 3)
            + LEAST(25, consultant_count * 5)
            + LEAST(20, candidate_count * 3)
            + LEAST(10, state_count * 2)
            + LEAST(10, party_count * 5)
          )
        ) AS concentration_score
      FROM base
      WHERE total_amount >= $${concentrationValues.length}
      ORDER BY concentration_score DESC, total_amount DESC
      LIMIT 25
    `,
    concentrationValues
  );

  const committeeIds = committeeResult.rows.map((row) => row.committee_id);

  let topConsultants = [];
  let topCandidates = [];

  if (committeeIds.length) {
    const consultantsResult = await pool.query(
      `
        SELECT *
        FROM (
          SELECT
            r.committee_id,
            r.consultant_id,
            c.name AS consultant_name,
            c.firm_name,
            c.category,
            c.state,
            c.influence_score,
            c.exposure_score,
            c.risk_label,
            COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
            COALESCE(SUM(r.transaction_count), 0)::int AS transaction_count,
            COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
            ROW_NUMBER() OVER (
              PARTITION BY r.committee_id
              ORDER BY COALESCE(SUM(r.total_amount), 0) DESC
            ) AS rn
          FROM consultant_candidate_relationships r
          LEFT JOIN consultants c ON c.id = r.consultant_id
          WHERE r.cycle = $1
            AND r.committee_id = ANY($2::text[])
          GROUP BY
            r.committee_id,
            r.consultant_id,
            c.name,
            c.firm_name,
            c.category,
            c.state,
            c.influence_score,
            c.exposure_score,
            c.risk_label
        ) ranked
        WHERE rn <= 10
        ORDER BY committee_id, total_amount DESC
      `,
      [cycle, committeeIds]
    );

    const candidatesResult = await pool.query(
      `
        SELECT *
        FROM (
          SELECT
            r.committee_id,
            r.candidate_id,
            r.candidate_name,
            r.candidate_state,
            r.candidate_office,
            r.candidate_party,
            COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
            COALESCE(SUM(r.transaction_count), 0)::int AS transaction_count,
            COUNT(DISTINCT r.consultant_id)::int AS consultant_count,
            ROW_NUMBER() OVER (
              PARTITION BY r.committee_id
              ORDER BY COALESCE(SUM(r.total_amount), 0) DESC
            ) AS rn
          FROM consultant_candidate_relationships r
          WHERE r.cycle = $1
            AND r.committee_id = ANY($2::text[])
          GROUP BY
            r.committee_id,
            r.candidate_id,
            r.candidate_name,
            r.candidate_state,
            r.candidate_office,
            r.candidate_party
        ) ranked
        WHERE rn <= 10
        ORDER BY committee_id, total_amount DESC
      `,
      [cycle, committeeIds]
    );

    topConsultants = consultantsResult.rows;
    topCandidates = candidatesResult.rows;
  }

  const consultantsByCommittee = new Map();
  for (const row of topConsultants) {
    const list = consultantsByCommittee.get(row.committee_id) || [];
    list.push(row);
    consultantsByCommittee.set(row.committee_id, list);
  }

  const candidatesByCommittee = new Map();
  for (const row of topCandidates) {
    const list = candidatesByCommittee.get(row.committee_id) || [];
    list.push(row);
    candidatesByCommittee.set(row.committee_id, list);
  }

  const committees = committeeResult.rows.map((row) => {
    const normalized = {
      ...row,
      states: Array.isArray(row.states) ? row.states.filter(Boolean).sort() : [],
      parties: Array.isArray(row.parties) ? row.parties.filter(Boolean).sort() : [],
      offices: Array.isArray(row.offices) ? row.offices.filter(Boolean).sort() : [],
      categories: Array.isArray(row.categories) ? row.categories.filter(Boolean).sort() : [],
      top_consultants: consultantsByCommittee.get(row.committee_id) || [],
      top_candidates: candidatesByCommittee.get(row.committee_id) || [],
    };

    normalized.risk_label = riskLabel(normalized.concentration_score);
    normalized.narrative = buildNarrative(normalized);

    return normalized;
  });

  return {
    ok: true,
    cycle,
    total: num(summaryResult.rows[0]?.total_committees, committees.length),
    limit,
    offset,
    filters: {
      search,
      state,
      party,
      min_amount: minAmount,
      battleground_states: battlegroundStates,
    },
    summary: summaryResult.rows[0] || {},
    results: committees,
    heatmap: heatmapResult.rows,
    concentration_risks: concentrationResult.rows.map((row) => ({
      ...row,
      risk_label: riskLabel(row.concentration_score),
    })),
  };
}

export async function getCommitteeProfile(committeeId, options = {}) {
  await ensureCommitteeIntelSchema();

  const id = clean(committeeId);

  if (!id) {
    const error = new Error("Invalid committee id");
    error.statusCode = 400;
    throw error;
  }

  const cycle = num(options.cycle, getDefaultCycle());

  const profile = await pool.query(
    `
      SELECT
        r.*,
        c.name AS consultant_name,
        c.firm_name,
        c.category AS consultant_category,
        c.influence_score,
        c.exposure_score,
        c.risk_label
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE r.cycle = $1
        AND r.committee_id = $2
      ORDER BY r.total_amount DESC, r.transaction_count DESC
      LIMIT 500
    `,
    [cycle, id]
  );

  if (!profile.rows.length) return null;

  return {
    ok: true,
    cycle,
    committee_id: id,
    relationships: profile.rows,
  };
}
