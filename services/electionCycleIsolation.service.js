
import { pool } from "../db/pool.js";
import { normalizeFederalElectionCycle } from "../utils/electionCycle.js";

const SUPPORTED_ENTITIES = Object.freeze({
  candidates: { table: "candidates", id: "id", cycle: "election_year" },
  workspaces: { table: "workspaces", id: "id", cycle: "election_cycle_year" },
  fundraising_live: { table: "fundraising_live", id: "id", cycle: "election_year" },
  polling_results: { table: "polling_results", id: "id", cycle: "cycle" },
});

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function tableExists(client, tableName) {
  const result = await client.query("SELECT to_regclass($1) AS relation", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.relation);
}

async function auditEntity(client, entityName, definition) {
  if (!(await tableExists(client, definition.table))) {
    return { entity: entityName, available: false, total: 0, missing_cycle: 0, invalid_cycle: 0, unregistered_cycle: 0, by_cycle: [] };
  }

  const cycleColumn = definition.cycle;
  const result = await client.query(`
    SELECT
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE ${cycleColumn} IS NULL)::integer AS missing_cycle,
      COUNT(*) FILTER (
        WHERE ${cycleColumn} IS NOT NULL
          AND (${cycleColumn} < 2026 OR ${cycleColumn} > 2200 OR ${cycleColumn} % 2 <> 0)
      )::integer AS invalid_cycle,
      COUNT(*) FILTER (
        WHERE ${cycleColumn} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM election_cycles ec WHERE ec.cycle_year = ${definition.table}.${cycleColumn}
          )
      )::integer AS unregistered_cycle
    FROM ${definition.table}
  `);

  const byCycle = await client.query(`
    SELECT COALESCE(${cycleColumn}::text, '[null]') AS cycle, COUNT(*)::integer AS records
    FROM ${definition.table}
    GROUP BY ${cycleColumn}
    ORDER BY ${cycleColumn} NULLS LAST
  `);

  return { entity: entityName, available: true, ...result.rows[0], by_cycle: byCycle.rows };
}

export async function auditElectionCycleIsolation({ client = pool } = {}) {
  const entities = [];
  for (const [name, definition] of Object.entries(SUPPORTED_ENTITIES)) {
    entities.push(await auditEntity(client, name, definition));
  }

  const queue = await client.query(`
    SELECT status, entity_table, COUNT(*)::integer AS records
    FROM election_cycle_remediation_queue
    GROUP BY status, entity_table
    ORDER BY status, entity_table
  `);

  return {
    generated_at: new Date().toISOString(),
    safe_to_enable_strict_reads: entities.every(
      (item) => !item.available || (item.invalid_cycle === 0 && item.unregistered_cycle === 0)
    ),
    entities,
    remediation_queue: queue.rows,
  };
}

export async function listElectionCycleRemediation({ status = "pending", entityTable, limit = 100, offset = 0 } = {}) {
  const values = [];
  const where = [];

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  if (entityTable) {
    values.push(entityTable);
    where.push(`entity_table = $${values.length}`);
  }

  values.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const limitIndex = values.length;
  values.push(Math.max(Number(offset) || 0, 0));
  const offsetIndex = values.length;

  const result = await pool.query(
    `SELECT * FROM election_cycle_remediation_queue
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at ASC, id ASC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values
  );

  return result.rows;
}

export async function resolveCandidateElectionCycle({ remediationId, cycle, userId, note = "" }) {
  const id = positiveId(remediationId);
  if (!id) throw Object.assign(new Error("Invalid remediation id."), { statusCode: 400 });
  const normalizedCycle = normalizeFederalElectionCycle(cycle, { fieldName: "cycle" });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const registered = await client.query(
      "SELECT cycle_year FROM election_cycles WHERE cycle_year = $1 AND is_selectable = TRUE LIMIT 1",
      [normalizedCycle]
    );
    if (!registered.rows.length) {
      throw Object.assign(new Error("The selected election cycle is not registered and selectable."), { statusCode: 400 });
    }

    const queued = await client.query(
      `SELECT * FROM election_cycle_remediation_queue
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [id]
    );
    const item = queued.rows[0];
    if (!item) throw Object.assign(new Error("Pending remediation item not found."), { statusCode: 404 });
    if (item.entity_table !== "candidates") {
      throw Object.assign(new Error("Phase 2 manual resolution currently supports candidate records only."), { statusCode: 400 });
    }

    const updated = await client.query(
      `UPDATE candidates
       SET election_year = $1, cycle_resolution_status = 'confirmed', updated_at = NOW()
       WHERE id::text = $2 AND election_year IS NULL
       RETURNING *`,
      [normalizedCycle, item.entity_id]
    );
    if (!updated.rows.length) {
      throw Object.assign(new Error("Candidate was not found or already has an election cycle."), { statusCode: 409 });
    }

    await client.query(
      `UPDATE election_cycle_remediation_queue
       SET status = 'resolved', resolved_cycle = $1, resolved_by_user_id = $2,
           resolution_note = $3, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [normalizedCycle, positiveId(userId), String(note || "").trim() || null, id]
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
