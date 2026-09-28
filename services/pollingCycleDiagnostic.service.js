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

 

function walkObject(value, visitor, path = [], depth = 0) {

  if (depth > 6 || value === null || value === undefined) return;

 

  if (Array.isArray(value)) {

    value.slice(0, 100).forEach((item, index) =>

      walkObject(item, visitor, [...path, String(index)], depth + 1)

    );

    return;

  }

 

  if (typeof value !== "object") return;

 

  for (const [key, child] of Object.entries(value)) {

    const childPath = [...path, key];

    visitor(key, child, childPath);

    walkObject(child, visitor, childPath, depth + 1);

  }

}

 

export function explicitPayloadEvidence(payload, registeredCycles) {

  const evidence = [];

 

  walkObject(payload, (key, value, path) => {

    if (!EXPLICIT_CYCLE_KEYS.has(normalizedKey(key))) return;

    const cycle = registeredCycle(value, registeredCycles);

    if (cycle === null) return;

 

    evidence.push({

      source: "source_payload_explicit_cycle",

      cycle,

      field: `source_payload.${path.join(".")}`,

      value,

    });

  });

 

  return evidence;

}

 

export function explicitPayloadCycles(payload, registeredCycles) {

  return [

    ...new Set(

      explicitPayloadEvidence(payload, registeredCycles).map((item) => item.cycle)

    ),

  ].sort((a, b) => a - b);

}

 

export function payloadRunKeyEvidence(payload) {

  const evidence = [];

 

  walkObject(payload, (key, value, path) => {

    if (!RUN_KEY_KEYS.has(normalizedKey(key))) return;

    const normalized = String(value || "").trim();

    if (!normalized) return;

 

    evidence.push({

      key: normalized,

      field: `source_payload.${path.join(".")}`,

      value,

    });

  });

 

  return evidence;

}

 

export function payloadRunKeys(payload) {

  return [...new Set(payloadRunKeyEvidence(payload).map((item) => item.key))];

}

 

function leadingRegisteredYear(value, registeredCycles) {

  const match = String(value || "").match(/^\s*((?:19|20|21)\d{2})\b/);

  return match ? registeredCycle(match[1], registeredCycles) : null;

}

 

export function providerSubjectEvidence(row, registeredCycles) {

  const candidates = [

    { field: "subject", value: row.subject },

    { field: "source_payload.subject", value: row.source_payload?.subject },

  ];

 

  const evidence = [];

  for (const candidate of candidates) {

    const cycle = leadingRegisteredYear(candidate.value, registeredCycles);

    if (cycle === null) continue;

    evidence.push({

      source: "provider_subject",

      cycle,

      field: candidate.field,

      value: candidate.value,

    });

  }

 

  return evidence;

}

 

function embeddedRegisteredYears(value, registeredCycles) {

  const years = new Set();

  const matches = String(value || "").match(/(?:19|20|21)\d{2}/g) || [];

  for (const match of matches) {

    const cycle = registeredCycle(match, registeredCycles);

    if (cycle !== null) years.add(cycle);

  }

  return [...years];

}

 

export function raceIdentifierEvidence(row, registeredCycles) {

  const fields = [

    { field: "race_name", value: row.race_name },

    { field: "source_payload.race.name", value: row.source_payload?.race?.name },

  ];

 

  const evidence = [];

  for (const item of fields) {

    for (const cycle of embeddedRegisteredYears(item.value, registeredCycles)) {

      evidence.push({

        source: "race_identifier",

        cycle,

        field: item.field,

        value: item.value,

      });

    }

  }

  return evidence;

}

 

export function raceIdentifierCycles(row, registeredCycles) {

  return [

    ...new Set(raceIdentifierEvidence(row, registeredCycles).map((item) => item.cycle)),

  ].sort((a, b) => a - b);

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

 

function evidenceCycles(evidence) {

  return [...new Set(evidence.map((item) => item.cycle))];

}

 

function resultBase(row, authoritative, supporting) {

  return {

    polling_result_id: row.id,

    poll_id: row.poll_id || null,

    authoritative_evidence: authoritative,

    supporting_evidence: supporting,

  };

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

  if (electionDateCycle !== null) {

    authoritative.push({

      source: "election_date",

      cycle: electionDateCycle,

      field: "election_date",

      value: row.election_date,

    });

  }

 

  authoritative.push(...explicitPayloadEvidence(row.source_payload, registeredCycles));

  authoritative.push(...providerSubjectEvidence(row, registeredCycles));

 

  for (const run of payloadRunKeyEvidence(row.source_payload)) {

    const cycle = ingestionRunCycles.get(run.key) || null;

    if (cycle === null) continue;

    authoritative.push({

      source: "ingestion_run",

      cycle,

      field: run.field,

      value: run.value,

    });

  }

 

  supporting.push(...raceIdentifierEvidence(row, registeredCycles));

 

  const candidateKey = String(row.candidate_id || "").trim();

  if (candidateKey) {

    const cycle = candidateCycles.get(candidateKey) || null;

    if (cycle !== null) {

      supporting.push({

        source: "candidate_identifier",

        cycle,

        field: "candidate_id",

        value: candidateKey,

      });

    }

  }

 

  const authoritativeCycles = evidenceCycles(authoritative);

  const supportingCycles = evidenceCycles(supporting);

  const base = resultBase(row, authoritative, supporting);

 

  if (authoritativeCycles.length > 1) {

    return {

      ...base,

      classification: "conflict",

      inferred_cycle: null,

      reason: "authoritative_evidence_conflicts",

      chronology: null,

    };

  }

 

  if (authoritativeCycles.length === 0) {

    return {

      ...base,

      classification: "unresolved",

      inferred_cycle: null,

      reason: supportingCycles.length ? "supporting_evidence_only" : "no_cycle_evidence",

      chronology: null,

    };

  }

 

  const inferredCycle = authoritativeCycles[0];

  const dateCheck = chronology(inferredCycle, row);

  if (!dateCheck.plausible) {

    return {

      ...base,

      classification: "conflict",

      inferred_cycle: null,

      reason: "poll_date_conflicts_with_cycle",

      chronology: dateCheck,

    };

  }

 

  if (supportingCycles.some((cycle) => cycle !== inferredCycle)) {

    return {

      ...base,

      classification: "conflict",

      inferred_cycle: null,

      reason: "supporting_evidence_conflicts",

      chronology: dateCheck,

    };

  }

 

  return {

    ...base,

    classification: "deterministic",

    inferred_cycle: inferredCycle,

    reason: [...new Set(authoritative.map((item) => item.source))].sort().join("+"),

    chronology: dateCheck,

  };

}

 

function pollGroupKey(row) {

  const pollId = String(row.poll_id || "").trim();

  if (!pollId) return null;

  const source = String(row.source_dataset || row.source || "unknown").trim().toLowerCase();

  const fieldEnd = String(row.field_end || "").slice(0, 10);

  return `${source}|${pollId}|${fieldEnd}`;

}

 

export function enforcePollGroupConsistency(rows, results) {

  const groups = new Map();

 

  rows.forEach((row, index) => {

    const key = pollGroupKey(row);

    if (!key) return;

    if (!groups.has(key)) groups.set(key, []);

    groups.get(key).push(index);

  });

 

  const adjusted = results.map((item) => ({ ...item }));

 

  for (const indexes of groups.values()) {

    if (indexes.length < 2) continue;

 

    const groupResults = indexes.map((index) => adjusted[index]);

    const deterministicCycles = [

      ...new Set(

        groupResults

          .filter((item) => item.classification === "deterministic")

          .map((item) => item.inferred_cycle)

      ),

    ];

    const allDeterministic = groupResults.every(

      (item) => item.classification === "deterministic"

    );

 

    if (allDeterministic && deterministicCycles.length === 1) continue;

 

    const classification = deterministicCycles.length > 1 ? "conflict" : "unresolved";

    const reason =

      deterministicCycles.length > 1

        ? "poll_group_cycle_conflict"

        : "poll_group_incomplete";

 

    for (const index of indexes) {

      adjusted[index] = {

        ...adjusted[index],

        classification,

        inferred_cycle: null,

        reason,

        group_consistency: {

          members: indexes.length,

          deterministic_cycles: deterministicCycles,

        },

      };

    }

  }

 

  return adjusted;

}

 

function cycleFromRun(run, registeredCycles) {

  const payloadCycles = explicitPayloadCycles(run.diagnostics, registeredCycles);

  return payloadCycles.length === 1 ? payloadCycles[0] : null;

}

 

export async function diagnosePollingElectionCycles({ client = pool } = {}) {

  // A supplied client can be a dedicated transaction client. Run these reads

  // sequentially so pg never receives overlapping queries on one connection.

  const cycleResult = await client.query(

    "SELECT cycle_year FROM election_cycles WHERE is_selectable = TRUE ORDER BY cycle_year"

  );

  const pollingResult = await client.query(`

    SELECT id, poll_id, source, source_dataset, poll_type, subject, state,

           district, office, race_name, candidate_name, candidate_id,

           field_start, field_end, published_at, election_date, source_payload

    FROM polling_results

    WHERE cycle IS NULL

    ORDER BY id

  `);

  const runResult = await client.query(

    "SELECT run_key, diagnostics, started_at, completed_at FROM polling_ingestion_runs ORDER BY started_at"

  );

  const candidateResult = await client.query(`

    SELECT id::text AS internal_id, fec_candidate_id, election_year

    FROM candidates

    WHERE election_year IS NOT NULL

  `);

 

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

 

  const individualResults = pollingResult.rows.map((row) =>

    diagnosePollingRecord(row, { registeredCycles, ingestionRunCycles, candidateCycles })

  );

  const results = enforcePollGroupConsistency(pollingResult.rows, individualResults);

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

      diagnostic_version: "2.2.1",

      generated_at: new Date().toISOString(),

      null_cycle_records: results.length,

      deterministic: deterministic.length,

      conflicts: conflicts.length,

      unresolved: unresolved.length,

      by_cycle: byCycle,

      by_reason: byReason,

      policy:

        "No database records were changed. Opaque poll IDs never provide cycle evidence. Only authoritative, non-conflicting evidence shared consistently across a poll group is deterministic.",

    },

    deterministic,

    conflicts,

    unresolved,

  };

}

