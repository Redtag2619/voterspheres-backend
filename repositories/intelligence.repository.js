import { pool } from "../db/pool.js";

export async function getIntelligenceInputs() {
  const [candidateResult, consultantResult, vendorResult, stateResult, officeResult, partyResult] =
    await Promise.all([
      pool.query(`
        SELECT
          c.id,
          c.name AS full_name,
          c.name,
          c.slug,
          c.party,
          c.bio,
          c.photo,
          c.election AS office_name,
          c.election,
          c.election_date,
          c.updated_at,
          c.state AS state_name,
          c.state
        FROM candidates c
        ORDER BY c.name
      `),
      pool.query(`
        SELECT *
        FROM consultants
        ORDER BY id DESC
      `).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT *
        FROM vendors
        ORDER BY id DESC
      `).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT DISTINCT state AS name
        FROM candidates
        WHERE state IS NOT NULL AND state <> ''
        ORDER BY state
      `),
      pool.query(`
        SELECT DISTINCT election AS name
        FROM candidates
        WHERE election IS NOT NULL AND election <> ''
        ORDER BY election
      `),
      pool.query(`
        SELECT DISTINCT party AS name
        FROM candidates
        WHERE party IS NOT NULL AND party <> ''
        ORDER BY party
      `)
    ]);

  return {
    candidateRows: candidateResult.rows,
    consultantRows: consultantResult.rows,
    vendorRows: vendorResult.rows,
    stateRows: stateResult.rows,
    officeRows: officeResult.rows,
    partyRows: partyResult.rows
  };
}
