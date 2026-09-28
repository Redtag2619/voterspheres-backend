import { createHash } from "node:crypto";

import { pool } from "../db/pool.js";

import { diagnosePollingElectionCycles } from "./pollingCycleDiagnostic.service.js";

import { normalizeFederalElectionCycle } from "../utils/electionCycle.js";

 

function identifier(value, fieldName = "polling_result_id") {

  const normalized = String(value ?? "").trim();

  if (!/^[1-9][0-9]*$/.test(normalized)) {

    throw Object.assign(new Error(`${fieldName} must be a positive integer.`), {

      statusCode: 400,

    });

  }

  return normalized;

}

 

function operator(value) {

  const normalized = String(value || "").trim();

  return normalized ? normalized.slice(0, 200) : "cli-operator";

}

 

export function normalizePollingCycleMapping(rows) {

  if (!Array.isArray(rows) || rows.length === 0) {

    throw Object.assign(new Error("Mapping file must contain a non-empty JSON array."), {

      statusCode: 400,

    });

  }

  if (rows.length > 50000) {

    throw Object.assign(new Error("Mapping file exceeds the 50,000-record safety limit."), {

      statusCode: 400,

    });

  }

 

  const seen = new Set();

  return rows.map((row, index) => {

    const pollingResultId = identifier(row?.polling_result_id, `rows[${index}].polling_result_id`);

    if (seen.has(pollingResultId)) {

      throw Object.assign(new Error(`Duplicate polling_result_id ${pollingResultId}.`), {

        statusCode: 400,

      });

    }

    seen.add(pollingResultId);

    return {

      polling_result_id: pollingResultId,

      cycle: normalizeFederalElectionCycle(row?.cycle, {

        fieldName: `rows[${index}].cycle`,

      }),

    };

  });

}

 

export function pollingGroupKey(row) {

  const pollId = String(row?.poll_id || "").trim();

  if (!pollId) return `record:${identifier(row?.id)}`;

  const source = String(row?.source_dataset || row?.source || "unknown")

    .trim()

    .toLowerCase();

  const fieldEnd = String(row?.field_end || "").slice(0, 10);

  return `${source}|${pollId}|${fieldEnd}`;

}

 

function sha256(value) {

  return createHash("sha256").update(value).digest("hex");

}

 

function stablePlanPayload(items) {

  return items

    .map((item) => ({

      polling_result_id: item.polling_result_id,

      cycle: item.cycle,

      poll_group_key: item.poll_group_key,

    }))

    .sort((a, b) => BigInt(a.polling_result_id) < BigInt(b.polling_result_id) ? -1 : 1);

}

 

export function buildPollingCycleRemediationPlan({ mappingRows, diagnosticResults, pollingRows }) {

  const mapping = normalizePollingCycleMapping(mappingRows);

  const requested = new Map(mapping.map((item) => [item.polling_result_id, item.cycle]));

  const diagnostic = new Map(

    (diagnosticResults || []).map((item) => [String(item.polling_result_id), item])

  );

  const rowsById = new Map((pollingRows || []).map((row) => [String(row.id), row]));

  const groupMembers = new Map();

 

  for (const row of pollingRows || []) {

    const key = pollingGroupKey(row);

    if (!groupMembers.has(key)) groupMembers.set(key, []);

    groupMembers.get(key).push(row);

  }

 

  const items = [];

  const touchedGroups = new Set();

  for (const item of mapping) {

    const row = rowsById.get(item.polling_result_id);

    if (!row) throw new Error(`Polling result ${item.polling_result_id} does not exist.`);

    if (row.cycle !== null && row.cycle !== undefined) {

      throw new Error(`Polling result ${item.polling_result_id} is already classified.`);

    }

 

    const current = diagnostic.get(item.polling_result_id);

    if (!current || current.classification !== "deterministic") {

      throw new Error(`Polling result ${item.polling_result_id} is not currently deterministic.`);

    }

    if (Number(current.inferred_cycle) !== item.cycle) {

      throw new Error(

        `Polling result ${item.polling_result_id} currently resolves to ${current.inferred_cycle}, not ${item.cycle}.`

      );

    }

 

    const groupKey = pollingGroupKey(row);

    touchedGroups.add(groupKey);

    items.push({

      polling_result_id: item.polling_result_id,

      cycle: item.cycle,

      poll_group_key: groupKey,

      reason: current.reason,

      evidence: current.authoritative_evidence,

    });

  }

 

  for (const groupKey of touchedGroups) {

    const members = groupMembers.get(groupKey) || [];

    const proposedCycles = new Set();

    for (const member of members) {

      const id = String(member.id);

      if (member.cycle !== null && member.cycle !== undefined) {

        proposedCycles.add(Number(member.cycle));

        continue;

      }

      const requestedCycle = requested.get(id);

      if (!requestedCycle) {

        throw new Error(`Poll group ${groupKey} is incomplete; record ${id} is not in the mapping.`);

      }

      proposedCycles.add(requestedCycle);

    }

    if (proposedCycles.size !== 1) {

      throw new Error(`Poll group ${groupKey} does not resolve to one cycle.`);

    }

  }

 

  const stable = stablePlanPayload(items);

  const cycleCounts = {};

  for (const item of stable) cycleCounts[item.cycle] = (cycleCounts[item.cycle] || 0) + 1;

 

  return {

    records: stable.length,

    groups: touchedGroups.size,

    cycle_counts: cycleCounts,

    mapping_sha256: sha256(JSON.stringify(stable)),

    items,

  };

}

 

async function loadPlanInputs(client, mappingRows) {

  const normalized = normalizePollingCycleMapping(mappingRows);

  const ids = normalized.map((item) => item.polling_result_id);

  const diagnostic = await diagnosePollingElectionCycles({ client });

  const rows = await client.query(`

    SELECT id, poll_id, source, source_dataset, field_end, cycle

    FROM polling_results

    WHERE poll_id IN (

      SELECT poll_id FROM polling_results WHERE id = ANY($1::bigint[])

    ) OR id = ANY($1::bigint[])

    ORDER BY id

  `, [ids]);

 

  return buildPollingCycleRemediationPlan({

    mappingRows: normalized,

    diagnosticResults: diagnostic.deterministic,

    pollingRows: rows.rows,

  });

}

 

export async function previewPollingCycleRemediation({ mappingRows, client = pool } = {}) {

  return loadPlanInputs(client, mappingRows);

}

 

export async function applyPollingCycleRemediation({

  mappingRows,

  confirmCount,

  confirmSha256,

  appliedBy,

  client: suppliedClient,

} = {}) {

  const client = suppliedClient || await pool.connect();

  const ownsClient = !suppliedClient;

 

  try {

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    await client.query("SELECT pg_advisory_xact_lock($1)", [2200928]);

    await client.query("LOCK TABLE polling_results IN SHARE ROW EXCLUSIVE MODE");

    await client.query("LOCK TABLE election_cycle_remediation_queue IN SHARE ROW EXCLUSIVE MODE");

 

    const plan = await loadPlanInputs(client, mappingRows);

    if (Number(confirmCount) !== plan.records) {

      throw new Error(`Confirmation count must equal ${plan.records}.`);

    }

    if (String(confirmSha256 || "").toLowerCase() !== plan.mapping_sha256) {

      throw new Error("Confirmation SHA-256 does not match the current remediation plan.");

    }

 

    const batchResult = await client.query(`

      INSERT INTO polling_cycle_remediation_batches (

        mapping_sha256, records_planned, cycle_counts, applied_by

      ) VALUES ($1, $2, $3::jsonb, $4)

      RETURNING id

    `, [plan.mapping_sha256, plan.records, JSON.stringify(plan.cycle_counts), operator(appliedBy)]);

    const batchId = batchResult.rows[0].id;

 

    for (const item of plan.items) {

      await client.query(`

        INSERT INTO polling_cycle_remediation_items (

          batch_id, polling_result_id, poll_group_key, previous_cycle,

          applied_cycle, evidence, reason

        ) VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6)

      `, [batchId, item.polling_result_id, item.poll_group_key, item.cycle,

        JSON.stringify(item.evidence), item.reason]);

 

      const updated = await client.query(`

        UPDATE polling_results

        SET cycle = $1, updated_at = NOW()

        WHERE id = $2 AND cycle IS NULL

        RETURNING id

      `, [item.cycle, item.polling_result_id]);

      if (updated.rowCount !== 1) {

        throw new Error(`Polling result ${item.polling_result_id} changed before it could be updated.`);

      }

 

      await client.query(`

        UPDATE election_cycle_remediation_queue

        SET status = 'resolved', proposed_cycle = $1, resolved_cycle = $1,

            resolution_note = $2, resolved_at = NOW(), updated_at = NOW()

        WHERE entity_table = 'polling_results'

          AND entity_id = $3

          AND issue_code = 'missing_election_cycle'

          AND status = 'pending'

      `, [item.cycle, `Phase 2.2 deterministic remediation batch ${batchId}`, item.polling_result_id]);

    }

 

    await client.query(`

      UPDATE polling_cycle_remediation_batches

      SET status = 'applied', records_applied = records_planned,

          applied_at = NOW(), updated_at = NOW()

      WHERE id = $1

    `, [batchId]);

    await client.query("COMMIT");

    return { ...plan, batch_id: String(batchId), status: "applied" };

  } catch (error) {

    await client.query("ROLLBACK").catch(() => {});

    throw error;

  } finally {

    if (ownsClient) client.release();

  }

}

 

export async function rollbackPollingCycleRemediation({

  batchId,

  rolledBackBy,

  note,

  client: suppliedClient,

} = {}) {

  const normalizedBatchId = identifier(batchId, "batch_id");

  const client = suppliedClient || await pool.connect();

  const ownsClient = !suppliedClient;

 

  try {

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    await client.query("SELECT pg_advisory_xact_lock($1)", [2200928]);

    await client.query("LOCK TABLE polling_results IN SHARE ROW EXCLUSIVE MODE");

 

    const batch = await client.query(`

      SELECT * FROM polling_cycle_remediation_batches

      WHERE id = $1 AND status = 'applied'

      FOR UPDATE

    `, [normalizedBatchId]);

    if (!batch.rows.length) throw new Error("Applied remediation batch not found.");

 

    const items = await client.query(`

      SELECT * FROM polling_cycle_remediation_items

      WHERE batch_id = $1 AND rolled_back_at IS NULL

      ORDER BY id

      FOR UPDATE

    `, [normalizedBatchId]);

    if (items.rows.length !== Number(batch.rows[0].records_applied)) {

      throw new Error("Remediation audit item count does not match the batch record count.");

    }

 

    for (const item of items.rows) {

      const updated = await client.query(`

        UPDATE polling_results

        SET cycle = NULL, updated_at = NOW()

        WHERE id = $1 AND cycle = $2

        RETURNING id

      `, [item.polling_result_id, item.applied_cycle]);

      if (updated.rowCount !== 1) {

        throw new Error(`Polling result ${item.polling_result_id} no longer matches the applied batch.`);

      }

 

      await client.query(`

        UPDATE election_cycle_remediation_queue

        SET status = 'pending', proposed_cycle = NULL, resolved_cycle = NULL,

            resolution_note = NULL, resolved_at = NULL, updated_at = NOW()

        WHERE entity_table = 'polling_results'

          AND entity_id = $1::text

          AND issue_code = 'missing_election_cycle'

      `, [item.polling_result_id]);

    }

 

    await client.query(`

      UPDATE polling_cycle_remediation_items

      SET rolled_back_at = NOW()

      WHERE batch_id = $1 AND rolled_back_at IS NULL

    `, [normalizedBatchId]);

    await client.query(`

      UPDATE polling_cycle_remediation_batches

      SET status = 'rolled_back', rolled_back_by = $2,

          rolled_back_at = NOW(), rollback_note = $3, updated_at = NOW()

      WHERE id = $1

    `, [normalizedBatchId, operator(rolledBackBy), String(note || "").trim() || null]);

    await client.query("COMMIT");

    return { batch_id: normalizedBatchId, status: "rolled_back", records: items.rows.length };

  } catch (error) {

    await client.query("ROLLBACK").catch(() => {});

    throw error;

  } finally {

    if (ownsClient) client.release();

  }

}
