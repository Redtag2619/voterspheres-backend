import { pool } from "../db/pool.js";
import { normalizeFederalElectionCycle } from "../utils/electionCycle.js";

export async function listElectionCycles({ selectableOnly = false } = {}) {
  const result = await pool.query(
    `
      SELECT cycle_year, label, status, is_selectable, starts_on, ends_on, metadata, updated_at
      FROM election_cycles
      WHERE ($1::boolean = FALSE OR is_selectable = TRUE)
      ORDER BY cycle_year ASC
    `,
    [Boolean(selectableOnly)]
  );
  return result.rows || [];
}

export async function getCurrentElectionCycle() {
  const result = await pool.query(
    `SELECT * FROM election_cycles WHERE status = 'current' LIMIT 1`
  );
  return result.rows[0] || null;
}

export async function getElectionCycle(year) {
  const cycleYear = normalizeFederalElectionCycle(year);
  const result = await pool.query(
    `SELECT * FROM election_cycles WHERE cycle_year = $1 LIMIT 1`,
    [cycleYear]
  );
  return result.rows[0] || null;
}

export async function requireSelectableElectionCycle(year) {
  const cycleYear = normalizeFederalElectionCycle(year);
  const result = await pool.query(
    `SELECT * FROM election_cycles WHERE cycle_year = $1 AND is_selectable = TRUE LIMIT 1`,
    [cycleYear]
  );
  if (!result.rows[0]) {
    const error = new Error(`Election cycle ${cycleYear} is not registered or selectable.`);
    error.statusCode = 400;
    error.code = "ELECTION_CYCLE_NOT_SELECTABLE";
    throw error;
  }
  return result.rows[0];
}

export async function resolveSelectableElectionCycle(value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    return requireSelectableElectionCycle(value);
  }
  const current = await getCurrentElectionCycle();
  if (!current) {
    const error = new Error("No current election cycle is configured.");
    error.statusCode = 503;
    error.code = "CURRENT_ELECTION_CYCLE_MISSING";
    throw error;
  }
  return current;
}

export async function activateElectionCycle(year) {
  const cycleYear = normalizeFederalElectionCycle(year);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(
      `SELECT * FROM election_cycles WHERE cycle_year = $1 AND is_selectable = TRUE FOR UPDATE`,
      [cycleYear]
    );
    if (!target.rows[0]) {
      const error = new Error(`Election cycle ${cycleYear} is not registered or selectable.`);
      error.statusCode = 400;
      throw error;
    }
    await client.query(
      `UPDATE election_cycles SET status = CASE WHEN cycle_year < $1 THEN 'historical' ELSE 'future' END, updated_at = NOW() WHERE status = 'current'`,
      [cycleYear]

    );
    const activated = await client.query(
      `UPDATE election_cycles SET status = 'current', updated_at = NOW() WHERE cycle_year = $1 RETURNING *`,
      [cycleYear]
    );
    await client.query("COMMIT");
    return activated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
