import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import {
  diagnosePollingRecord,
  enforcePollGroupConsistency,
} from "./pollingCycleDiagnostic.service.js";

const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const clean = (value = "") => String(value ?? "").trim();

const CONTINUOUS_TRACKING_TYPES = new Set(["approval", "favorability"]);
const ELECTION_CYCLE_TYPES = new Set([
  "president",
  "generic-ballot",
  "senate",
  "us-senator",
  "house",
  "us-representative",
  "governor",
  "attorney-general",
  "mayor",
]);

export function classifyPollingTemporalScope(rows = []) {
  const types = [...new Set(
    rows.map((row) => clean(row.poll_type).toLowerCase()).filter(Boolean)
  )];
  if (types.length !== 1) return "unresolved";
  const [type] = types;
  if (CONTINUOUS_TRACKING_TYPES.has(type)) return "continuous_tracking";
  if (
    ELECTION_CYCLE_TYPES.has(type) ||
    type.startsWith("proposition-") ||
    type.startsWith("referendum-") ||
    type.startsWith("ballot-measure-")
  ) return "election_cycle";
  return "unresolved";
}

export function pollingGroupKey(rows = [], rawPayload = {}) {
  const first = rows[0] || {};
  const provider = clean(first.source || "unknown").toLowerCase();
  const pollId = clean(first.poll_id);
  if (pollId) return sha256(`${provider}|${pollId}`);

  return sha256(JSON.stringify({
    provider,
    pollster: first.pollster || null,
    subject: first.subject || null,
    state: first.state || null,
    office: first.office || null,
    field_start: first.field_start || null,
    field_end: first.field_end || null,
    payload: rawPayload || {},
  }));
}

export function classifyIncomingPollingGroup(rows = [], registeredCycles = new Set()) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { accepted: false, temporal_scope: "unresolved", issue_code: "empty_poll_group", cycle: null, rows: [], evidence: [] };
  }

  const temporalScope = classifyPollingTemporalScope(rows);
  if (temporalScope === "continuous_tracking") {
    return {
      accepted: true,
      temporal_scope: temporalScope,
      issue_code: null,
      cycle: null,
      rows: rows.map((row) => ({ ...row, cycle: null, temporal_scope: temporalScope })),
      evidence: [{ source: "poll_type", temporal_scope: temporalScope, poll_type: clean(rows[0]?.poll_type).toLowerCase() }],
    };
  }
  if (temporalScope === "unresolved") {
    return {
      accepted: false,
      temporal_scope: temporalScope,
      issue_code: "unsupported_temporal_scope",
      cycle: null,
      rows,
      evidence: [],
    };
  }

  const diagnosticRows = rows.map((row, index) => ({
    ...row,
    id: row.id || row.dedupe_key || `incoming-${index}`,
  }));
  const individual = diagnosticRows.map((row) =>
    diagnosePollingRecord(row, { registeredCycles })
  );
  const results = enforcePollGroupConsistency(diagnosticRows, individual);
  const deterministic = results.filter((item) => item.classification === "deterministic");
  const cycles = new Set(deterministic.map((item) => Number(item.inferred_cycle)));
  const accepted = deterministic.length === rows.length && cycles.size === 1;
  const cycle = accepted ? [...cycles][0] : null;
  const conflict = results.some((item) => item.classification === "conflict");

  return {
    accepted,
    temporal_scope: temporalScope,
    issue_code: accepted ? null : conflict ? "conflicting_cycle_evidence" : "missing_deterministic_cycle",
    cycle,
    rows: accepted ? rows.map((row) => ({ ...row, cycle, temporal_scope: temporalScope })) : rows,
    evidence: results,
  };
}

export async function loadSelectablePollingCycles(client = pool) {
  const result = await client.query(
    "SELECT cycle_year FROM election_cycles WHERE is_selectable = TRUE ORDER BY cycle_year"
  );
  return new Set(result.rows.map((row) => Number(row.cycle_year)));
}

export async function quarantineIncomingPollingGroup({
  rows,
  rawPayload,
  runKey = null,
  provider = "votehub",
  classification,
  client = pool,
}) {
  const first = rows[0] || {};
  const groupKey = pollingGroupKey(rows, rawPayload);
  const result = await client.query(
    `
      INSERT INTO polling_ingestion_quarantine (
        run_key, provider, poll_id, poll_group_key, issue_code,
        proposed_cycle, temporal_scope, evidence, normalized_rows, source_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
      ON CONFLICT (provider, poll_group_key, issue_code, status)
      DO UPDATE SET
        run_key = EXCLUDED.run_key,
        poll_id = EXCLUDED.poll_id,
        proposed_cycle = EXCLUDED.proposed_cycle,
        temporal_scope = EXCLUDED.temporal_scope,
        evidence = EXCLUDED.evidence,
        normalized_rows = EXCLUDED.normalized_rows,
        source_payload = EXCLUDED.source_payload,
        updated_at = NOW()
      RETURNING id
    `,
    [
      runKey,
      provider,
      first.poll_id || null,
      groupKey,
      classification.issue_code,
      classification.cycle,
      classification.temporal_scope,
      JSON.stringify(classification.evidence || []),
      JSON.stringify(rows || []),
      JSON.stringify(rawPayload || {}),
    ]
  );
  return result.rows[0]?.id || null;
}

export async function guardIncomingPollingGroup({
  rows,
  rawPayload = {},
  runKey = null,
  provider = "votehub",
  client = pool,
}) {
  const registeredCycles = await loadSelectablePollingCycles(client);
  const classification = classifyIncomingPollingGroup(rows, registeredCycles);

  if (classification.accepted) {
    return { ...classification, quarantined: false, quarantine_id: null };
  }

  const quarantineId = await quarantineIncomingPollingGroup({
    rows,
    rawPayload,
    runKey,
    provider,
    classification,
    client,
  });
  return { ...classification, quarantined: true, quarantine_id: quarantineId };
}

export function assertPollingResultCycle(row = {}) {
  const temporalScope = clean(row.temporal_scope).toLowerCase();
  if (temporalScope === "continuous_tracking") {
    if (row.cycle !== null && row.cycle !== undefined && row.cycle !== "") {
      const error = new Error("Continuous-tracking polling must not carry an election cycle.");
      error.code = "CONTINUOUS_POLLING_CYCLE_FORBIDDEN";
      throw error;
    }
    return null;
  }
  if (temporalScope !== "election_cycle") {
    const error = new Error("Polling result requires a resolved temporal scope.");
    error.code = "POLLING_TEMPORAL_SCOPE_REQUIRED";
    throw error;
  }
  const cycle = Number(row.cycle);
  if (!Number.isInteger(cycle) || cycle < 2026 || cycle > 2200 || cycle % 2 !== 0) {
    const error = new Error("Polling result requires a deterministic even election cycle.");
    error.code = "POLLING_CYCLE_REQUIRED";
    throw error;
  }
  return cycle;
}
