import { pool } from "../db/pool.js";

const EXPLICIT_CYCLE_KEYS = new Set([
  "cycle",
  "election_cycle",
  "electioncycle",
  "election_year",
  "electionyear",
]);

const RUN_KEY_KEYS = new Set([
  "run_key",
  "runkey",
  "ingestion_run_key",
  "ingestionrunkey",
]);

function normalizedKey(value) {
  return String(value || "").replace(/[^a-z0-9_]/gi, "").toLowerCase();
}

function integer(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function registeredCycle(value, registeredCycles) {
  const cycle = integer(value);
  return cycle !== null && registeredCycles.has(cycle) ? cycle : null;
}

function walkObject(value, visitor, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) walkObject(item, visitor, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child);
    walkObject(child, visitor, depth + 1);
  }
}

export function explicitPayloadCycles(payload, registeredCycles) {
  const cycles = new Set();
  walkObject(payload, (key, value) => {
    if (!EXPLICIT_CYCLE_KEYS.has(normalizedKey(key))) return;
    const cycle = registeredCycle(value, registeredCycles);
    if (cycle !== null) cycles.add(cycle);
  });
  return [...cycles].sort((a, b) => a - b);
}

export function payloadRunKeys(payload) {
  const keys = new Set();
  walkObject(payload, (key, value) => {
    if (!RUN_KEY_KEYS.has(normalizedKey(key))) return;
    const normalized = String(value || "").trim();
    if (normalized) keys.add(normalized);
  });
  return [...keys];
}

function yearsInIdentifier(value, registeredCycles) {
  const years = new Set();
  const matches = String(value || "").match(/(?:19|20|21)\d{2}/g) || [];
  for (const match of matches) {
    const cycle = registeredCycle(match, registeredCycles);
    if (cycle !== null) years.add(cycle);
  }
  return years;
}

export function raceIdentifierCycles(row, registeredCycles) {
  const cycles = new Set();
  const identifiers = [
    row.race_name,
    row.poll_id,
    row.source_payload?.race_id,
    row.source_payload?.raceId,
    row.source_payload?.election_id,
    row.source_payload?.electionId,
    row.source_payload?.race?.id,
    row.source_payload?.race?.name,
  ];
  for (const identifier of identifiers) {
    for (const cycle of yearsInIdentifier(identifier, registeredCycles)) cycles.add(cycle);
  }
  return [...cycles].sort((a, b) => a - b);
}

function dateYear(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

function pollDate(row) {
  return row.field_end || row.field_start || row.published_at || null;
}

function chronology(cycle, row) {
  const year = dateYear(pollDate(row));
  if (year === null) return { poll_year: null, plausible: true, reason: "no_poll_date" };
  const gap = cycle - year;
  return {
    poll_year: year,
    plausible: gap >= 0 && gap <= 4,
    reason: gap >= 0 && gap <= 4 ? "within_four_year_window" : "outside_four_year_window",
  };
}

function addEvidence(target, source, cycle, detail = null) {
  if (cycle === null) return;
  target.push({ source, cycle, detail });
}

export function diagnosePollingRecord(
  row,
  {
    registeredCycles,
    ingestionRunCycles = new Map(),
    candidateCycles = new Map(),
  }
) {
  const authoritative = [];
  const supporting = [];

  const electionDateCycle = registeredCycle(dateYear(row.election_date), registeredCycles);
  addEvidence(authoritative, "election_date", electionDateCycle, row.election_date || null);

  for (const cycle of explicitPayloadCycles(row.source_payload, registeredCycles)) {
    addEvidence(authoritative, "source_payload", cycle);
  }

  for (const cycle of raceIdentifierCycles(row, registeredCycles)) {
    addEvidence(authoritative, "race_identifier", cycle, row.race_name || row.poll_id || null);
  }

  for (const runKey of payloadRunKeys(row.source_payload)) {
    const cycle = ingestionRunCycles.get(runKey) || null;
    addEvidence(authoritative, "ingestion_run", cycle, runKey);
  }

  const candidateKey = String(row.candidate_id || "").trim();
  if (candidateKey) {
    addEvidence(supporting, "candidate_identifier", candidateCycles.get(candidateKey) || null, candidateKey);
  }

  const authoritativeCycles = [...new Set(authoritative.map((item) => item.cycle))];
  const supportingCycles = [...new Set(supporting.map((item) => item.cycle))];

  if (authoritativeCycles.length > 1) {
    return {
      polling_result_id: row.id,
      classification: "conflict",
      inferred_cycle: null,
      reason: "authoritative_evidence_conflicts",
      authoritative_evidence: authoritative,
      supporting_evidence: supporting,
      chronology: null,
    };
  }

  if (authoritativeCycles.length === 0) {
    return {
      polling_result_id: row.id,
      classification: "unresolved",
      inferred_cycle: null,
      reason: supportingCycles.length ? "supporting_evidence_only" : "no_cycle_evidence",
      authoritative_evidence: authoritative,
      supporting_evidence: supporting,
      chronology: null,
    };
  }

  const inferredCycle = authoritativeCycles[0];
  const dateCheck = chronology(inferredCycle, row);
  if (!dateCheck.plausible) {
    return {
      polling_result_id: row.id,
      classification: "conflict",
      inferred_cycle: null,
      reason: "poll_date_conflicts_with_cycle",
      authoritative_evidence: authoritative,
      supporting_evidence: supporting,
      chronology: dateCheck,
    };
  }

  if (supportingCycles.length && supportingCycles.some((cycle) => cycle !== inferredCycle)) {
    return {
      polling_result_id: row.id,
      classification: "conflict",
      inferred_cycle: null,
      reason: "candidate_evidence_conflicts",
      authoritative_evidence: authoritative,
      supporting_evidence: supporting,
      chronology: dateCheck,
    };
  }

  return {
    polling_result_id: row.id,
    classification: "deterministic",
    inferred_cycle: inferredCycle,
    reason: authoritative.map((item) => item.source).sort().join("+") || "authoritative_evidence",
    authoritative_evidence: authoritative,
    supporting_evidence: supporting,
    chronology: dateCheck,
  };
}

function cycleFromRun(run, registeredCycles) {
  const payloadCycles = explicitPayloadCycles(run.diagnostics, registeredCycles);
  return payloadCycles.length === 1 ? payloadCycles[0] : null;
}

export async function diagnosePollingElectionCycles({ client = pool } = {}) {
  const [cycleResult, pollingResult, runResult, candidateResult] = await Promise.all([
    client.query("SELECT cycle_year FROM election_cycles WHERE is_selectable = TRUE ORDER BY cycle_year"),
    client.query(`
      SELECT id, poll_id, source, source_dataset, race_name, candidate_id,
             field_start, field_end, published_at, election_date, source_payload
      FROM polling_results
      WHERE cycle IS NULL
      ORDER BY id
    `),
    client.query("SELECT run_key, diagnostics, started_at, completed_at FROM polling_ingestion_runs ORDER BY started_at"),
    client.query(`
      SELECT id::text AS internal_id, fec_candidate_id, election_year
      FROM candidates
      WHERE election_year IS NOT NULL
    `),
  ]);

  const registeredCycles = new Set(cycleResult.rows.map((row) => Number(row.cycle_year)));
  const ingestionRunCycles = new Map();
  for (const run of runResult.rows) {
    const cycle = cycleFromRun(run, registeredCycles);
    if (cycle !== null) ingestionRunCycles.set(String(run.run_key), cycle);
  }

  const candidateCycles = new Map();
  for (const candidate of candidateResult.rows) {
    const cycle = registeredCycle(candidate.election_year, registeredCycles);
    if (cycle === null) continue;
    candidateCycles.set(String(candidate.internal_id), cycle);
    if (candidate.fec_candidate_id) candidateCycles.set(String(candidate.fec_candidate_id), cycle);
  }

  const results = pollingResult.rows.map((row) =>
    diagnosePollingRecord(row, { registeredCycles, ingestionRunCycles, candidateCycles })
  );
  const deterministic = results.filter((item) => item.classification === "deterministic");
  const conflicts = results.filter((item) => item.classification === "conflict");
  const unresolved = results.filter((item) => item.classification === "unresolved");

  const byCycle = {};
  const byReason = {};
  for (const item of results) {
    const cycleKey = item.inferred_cycle ? String(item.inferred_cycle) : item.classification;
    byCycle[cycleKey] = (byCycle[cycleKey] || 0) + 1;
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  }

  return {
    summary: {
      generated_at: new Date().toISOString(),
      null_cycle_records: results.length,
      deterministic: deterministic.length,
      conflicts: conflicts.length,
      unresolved: unresolved.length,
      by_cycle: byCycle,
      by_reason: byReason,
      policy: "No database records were changed. Only authoritative, non-conflicting evidence is classified as deterministic.",
    },
    deterministic,
    conflicts,
    unresolved,
  };
}
