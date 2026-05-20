import pool from "../config/database.js";

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeState(value) {
  return clean(value).toUpperCase();
}

function getDefaultCycle() {
  return Number(process.env.FEC_DEFAULT_CYCLE || 2026);
}

export async function ensureConsultantRiskSchema() {
  await pool.query(`
    ALTER TABLE consultants
      ADD COLUMN IF NOT EXISTS influence_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS battleground_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS overlap_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS exposure_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS risk_label TEXT,
      ADD COLUMN IF NOT EXISTS risk_summary TEXT,
      ADD COLUMN IF NOT EXISTS last_risk_scored_at TIMESTAMP
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_risk_snapshots (
      id SERIAL PRIMARY KEY,
      consultant_id INTEGER REFERENCES consultants(id) ON DELETE CASCADE,
      cycle INTEGER,
      influence_score NUMERIC DEFAULT 0,
      battleground_score NUMERIC DEFAULT 0,
      overlap_score NUMERIC DEFAULT 0,
      exposure_score NUMERIC DEFAULT 0,
      total_score NUMERIC DEFAULT 0,
      risk_label TEXT,
      risk_summary TEXT,
      source_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_consultant_risk_snapshots_consultant
    ON consultant_risk_snapshots(consultant_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_consultant_risk_snapshots_cycle
    ON consultant_risk_snapshots(cycle)
  `);
}

function riskLabel(totalScore) {
  const score = num(totalScore);
  if (score >= 80) return "High Exposure";
  if (score >= 60) return "Watch Closely";
  if (score >= 40) return "Strategic Asset";
  return "Emerging Signal";
}

function buildRiskSummary(row) {
  const parts = [];

  if (num(row.candidate_count) >= 5) {
    parts.push(`${row.candidate_count} mapped candidate relationships`);
  }

  if (num(row.party_count) > 1) {
    parts.push("cross-party overlap detected");
  }

  if (num(row.battleground_candidates) > 0) {
    parts.push(`${row.battleground_candidates} battleground candidate links`);
  }

  if (num(row.total_amount) > 100000) {
    parts.push(`high-spend footprint of $${Math.round(num(row.total_amount)).toLocaleString()}`);
  }

  if (!parts.length) {
    parts.push("limited current-cycle risk signals");
  }

  return parts.join("; ");
}

export async function scoreConsultantRisk(options = {}) {
  await ensureConsultantRiskSchema();

  const cycle = num(options.cycle, getDefaultCycle());
  const battlegroundStates = String(options.battlegroundStates || "AZ,GA,MI,NV,NC,PA,WI")
    .split(",")
    .map((state) => normalizeState(state))
    .filter(Boolean);

  const result = await pool.query(
    `
      WITH relationship_stats AS (
        SELECT
          c.id AS consultant_id,
          COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
          COUNT(DISTINCT r.candidate_state)::int AS state_count,
          COUNT(DISTINCT r.candidate_party)::int AS party_count,
          COUNT(DISTINCT r.category)::int AS category_count,
          COUNT(DISTINCT CASE WHEN r.candidate_state = ANY($2) THEN r.candidate_id END)::int AS battleground_candidates,
          COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount,
          MAX(r.last_disbursement_date) AS last_activity
        FROM consultants c
        LEFT JOIN consultant_candidate_relationships r
          ON r.consultant_id = c.id
          AND r.cycle = $1
        GROUP BY c.id
      ), scored AS (
        SELECT
          c.id,
          c.name,
          c.category,
          COALESCE(rs.candidate_count, 0) AS candidate_count,
          COALESCE(rs.state_count, 0) AS state_count,
          COALESCE(rs.party_count, 0) AS party_count,
          COALESCE(rs.category_count, 0) AS category_count,
          COALESCE(rs.battleground_candidates, 0) AS battleground_candidates,
          COALESCE(rs.total_amount, 0) AS total_amount,
          LEAST(100, ROUND(20 + LEAST(35, LN(GREATEST(COALESCE(rs.total_amount, 0), 1)) * 3) + LEAST(25, COALESCE(rs.candidate_count, 0) * 4) + LEAST(20, COALESCE(rs.state_count, 0) * 4))) AS influence_score,
          LEAST(100, ROUND(LEAST(60, COALESCE(rs.battleground_candidates, 0) * 15) + LEAST(40, LN(GREATEST(COALESCE(rs.total_amount, 0), 1)) * 3))) AS battleground_score,
          LEAST(100, ROUND(LEAST(50, COALESCE(rs.candidate_count, 0) * 8) + LEAST(50, COALESCE(rs.party_count, 0) * 20))) AS overlap_score,
          LEAST(100, ROUND(LEAST(60, COALESCE(rs.party_count, 0) * 30) + LEAST(40, COALESCE(rs.state_count, 0) * 5))) AS exposure_score
        FROM consultants c
        LEFT JOIN relationship_stats rs ON rs.consultant_id = c.id
      )
      SELECT * FROM scored
      ORDER BY influence_score DESC, total_amount DESC
    `,
    [cycle, battlegroundStates]
  );

  let updated = 0;

  for (const row of result.rows) {
    const totalScore = Math.round(
      (num(row.influence_score) * 0.35) +
        (num(row.battleground_score) * 0.25) +
        (num(row.overlap_score) * 0.2) +
        (num(row.exposure_score) * 0.2)
    );

    const label = riskLabel(totalScore);
    const summary = buildRiskSummary(row);

    await pool.query(
      `
        UPDATE consultants
        SET
          influence_score = $2,
          battleground_score = $3,
          overlap_score = $4,
          exposure_score = $5,
          risk_label = $6,
          risk_summary = $7,
          last_risk_scored_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        row.id,
        row.influence_score,
        row.battleground_score,
        row.overlap_score,
        row.exposure_score,
        label,
        summary,
      ]
    );

    await pool.query(
      `
        INSERT INTO consultant_risk_snapshots (
          consultant_id,
          cycle,
          influence_score,
          battleground_score,
          overlap_score,
          exposure_score,
          total_score,
          risk_label,
          risk_summary,
          source_payload,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      `,
      [
        row.id,
        cycle,
        row.influence_score,
        row.battleground_score,
        row.overlap_score,
        row.exposure_score,
        totalScore,
        label,
        summary,
        JSON.stringify(row),
      ]
    );

    updated += 1;
  }

  return {
    ok: true,
    cycle,
    updated,
    battleground_states: battlegroundStates,
  };
}

export async function getConsultantRiskDashboard(options = {}) {
  await ensureConsultantRiskSchema();

  const cycle = num(options.cycle, getDefaultCycle());
  const limit = Math.min(Math.max(num(options.limit, 25), 1), 100);

  const [summary, topInfluence, topExposure, recentRelationships] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total_consultants,
        COUNT(*) FILTER (WHERE source = 'fec_schedule_b')::int AS fec_consultants,
        ROUND(AVG(COALESCE(influence_score, 0))::numeric, 2) AS avg_influence,
        ROUND(AVG(COALESCE(exposure_score, 0))::numeric, 2) AS avg_exposure,
        COUNT(*) FILTER (WHERE risk_label = 'High Exposure')::int AS high_exposure,
        COUNT(*) FILTER (WHERE risk_label = 'Watch Closely')::int AS watch_closely
      FROM consultants
    `),
    pool.query(`
      SELECT id, name, firm_name, category, state, influence_score, battleground_score, overlap_score, exposure_score, risk_label, risk_summary, total_fec_disbursements, clients_count
      FROM consultants
      ORDER BY COALESCE(influence_score, 0) DESC, COALESCE(total_fec_disbursements, 0) DESC
      LIMIT $1
    `, [limit]),
    pool.query(`
      SELECT id, name, firm_name, category, state, influence_score, battleground_score, overlap_score, exposure_score, risk_label, risk_summary
      FROM consultants
      ORDER BY COALESCE(exposure_score, 0) DESC, COALESCE(overlap_score, 0) DESC
      LIMIT $1
    `, [limit]),
    pool.query(`
      SELECT
        r.*,
        c.name AS consultant_name,
        c.influence_score,
        c.risk_label
      FROM consultant_candidate_relationships r
      JOIN consultants c ON c.id = r.consultant_id
      WHERE r.cycle = $1
      ORDER BY r.updated_at DESC
      LIMIT $2
    `, [cycle, limit]),
  ]);

  return {
    ok: true,
    cycle,
    summary: summary.rows[0] || {},
    top_influence: topInfluence.rows,
    top_exposure: topExposure.rows,
    recent_relationships: recentRelationships.rows,
  };
}

export async function getConsultantProfile(consultantId, options = {}) {
  await ensureConsultantRiskSchema();

  const cycle = num(options.cycle, getDefaultCycle());

  const consultant = await pool.query(
    `SELECT * FROM consultants WHERE id = $1 LIMIT 1`,
    [consultantId]
  );

  if (!consultant.rows[0]) return null;

  const relationships = await pool.query(
    `
      SELECT *
      FROM consultant_candidate_relationships
      WHERE consultant_id = $1
        AND cycle = $2
      ORDER BY total_amount DESC
    `,
    [consultantId, cycle]
  );

  const snapshots = await pool.query(
    `
      SELECT *
      FROM consultant_risk_snapshots
      WHERE consultant_id = $1
      ORDER BY created_at DESC
      LIMIT 12
    `,
    [consultantId]
  );

  const parties = [...new Set(relationships.rows.map((row) => row.candidate_party).filter(Boolean))];
  const states = [...new Set(relationships.rows.map((row) => row.candidate_state).filter(Boolean))];

  return {
    ok: true,
    cycle,
    consultant: consultant.rows[0],
    relationships: relationships.rows,
    snapshots: snapshots.rows,
    summary: {
      relationship_count: relationships.rows.length,
      total_amount: relationships.rows.reduce((sum, row) => sum + num(row.total_amount), 0),
      states,
      parties,
      has_cross_party_overlap: parties.length > 1,
    },
  };
}
