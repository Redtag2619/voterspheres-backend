import { pool } from "../db/pool.js";

export async function ensureFecTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fec_candidates (
      id SERIAL PRIMARY KEY,
      candidate_id TEXT UNIQUE NOT NULL,
      name TEXT,
      party TEXT,
      office TEXT,
      office_full TEXT,
      state TEXT,
      district TEXT,
      incumbent_challenge_full TEXT,
      principal_committees JSONB DEFAULT '[]'::jsonb,
      raw_payload JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fundraising_snapshots (
      id SERIAL PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      candidate_name TEXT,
      state TEXT,
      office TEXT,
      party TEXT,
      cycle INT,
      receipts NUMERIC DEFAULT 0,
      disbursements NUMERIC DEFAULT 0,
      cash_on_hand NUMERIC DEFAULT 0,
      debt NUMERIC DEFAULT 0,
      coverage_start_date DATE,
      coverage_end_date DATE,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_candidate_id
    ON fundraising_snapshots(candidate_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fundraising_fetched_at
    ON fundraising_snapshots(fetched_at DESC)
  `);
}

export async function upsertFecCandidate(candidate) {
  const result = await pool.query(
    `
    INSERT INTO fec_candidates (
      candidate_id,
      name,
      party,
      office,
      office_full,
      state,
      district,
      incumbent_challenge_full,
      principal_committees,
      raw_payload,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,NOW())
    ON CONFLICT (candidate_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      party = EXCLUDED.party,
      office = EXCLUDED.office,
      office_full = EXCLUDED.office_full,
      state = EXCLUDED.state,
      district = EXCLUDED.district,
      incumbent_challenge_full = EXCLUDED.incumbent_challenge_full,
      principal_committees = EXCLUDED.principal_committees,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING *
    `,
    [
      candidate.candidate_id,
      candidate.name || null,
      candidate.party_full || candidate.party || null,
      candidate.office || null,
      candidate.office_full || null,
      candidate.state || null,
      candidate.district || null,
      candidate.incumbent_challenge_full || null,
      JSON.stringify(candidate.principal_committees || []),
      JSON.stringify(candidate)
    ]
  );

  return result.rows[0];
}

export async function insertFundraisingSnapshot({
  candidate_id,
  candidate_name,
  state,
  office,
  party,
  cycle,
  receipts,
  disbursements,
  cash_on_hand,
  debt,
  coverage_start_date,
  coverage_end_date
}) {
  const result = await pool.query(
    `
    INSERT INTO fundraising_snapshots (
      candidate_id,
      candidate_name,
      state,
      office,
      party,
      cycle,
      receipts,
      disbursements,
      cash_on_hand,
      debt,
      coverage_start_date,
      coverage_end_date,
      fetched_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    RETURNING *
    `,
    [
      candidate_id,
      candidate_name || null,
      state || null,
      office || null,
      party || null,
      cycle || null,
      Number(receipts || 0),
      Number(disbursements || 0),
      Number(cash_on_hand || 0),
      Number(debt || 0),
      coverage_start_date || null,
      coverage_end_date || null
    ]
  );

  return result.rows[0];
}

export async function getLatestStoredCandidates(limit = 100) {
  const result = await pool.query(
    `
    SELECT *
    FROM fec_candidates
    ORDER BY updated_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

export async function getLatestStoredFundraising(limit = 100) {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (candidate_id)
      candidate_id,
      candidate_name,
      state,
      office,
      party,
      cycle,
      receipts,
      disbursements,
      cash_on_hand,
      debt,
      coverage_start_date,
      coverage_end_date,
      fetched_at
    FROM fundraising_snapshots
    ORDER BY candidate_id, fetched_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}
