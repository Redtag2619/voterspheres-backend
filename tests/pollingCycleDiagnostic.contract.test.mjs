
import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosePollingElectionCycles,
  diagnosePollingRecord,
  enforcePollGroupConsistency,
  explicitPayloadCycles,
  providerSubjectEvidence,
  raceIdentifierCycles,
} from "../services/pollingCycleDiagnostic.service.js";

const registeredCycles = new Set([2026, 2028, 2030]);

test("runs diagnostic queries sequentially on one database client", async () => {
  let activeQueries = 0;
  let maximumActiveQueries = 0;
  const queryOrder = [];

  const client = {
    async query(sql) {
      activeQueries += 1;
      maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);

      if (activeQueries > 1) {
        throw new Error("Overlapping query detected on a dedicated client.");
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const text = String(sql);

        if (text.includes("FROM election_cycles")) {
          queryOrder.push("election_cycles");
          return { rows: [{ cycle_year: 2026 }, { cycle_year: 2028 }] };
        }
        if (text.includes("FROM polling_results")) {
          queryOrder.push("polling_results");
          return { rows: [] };
        }
        if (text.includes("FROM polling_ingestion_runs")) {
          queryOrder.push("polling_ingestion_runs");
          return { rows: [] };
        }
        if (text.includes("FROM candidates")) {
          queryOrder.push("candidates");
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${text}`);
      } finally {
        activeQueries -= 1;
      }
    },
  };

  const report = await diagnosePollingElectionCycles({ client });

  assert.equal(maximumActiveQueries, 1);
  assert.deepEqual(queryOrder, [
    "election_cycles",
    "polling_results",
    "polling_ingestion_runs",
    "candidates",
  ]);
  assert.equal(report.summary.diagnostic_version, "2.2.1");
  assert.equal(report.summary.null_cycle_records, 0);
});

test("uses an explicit election date as deterministic evidence", () => {
  const result = diagnosePollingRecord(
    { id: 1, election_date: "2026-11-03", field_end: "2026-09-01", source_payload: {} },
    { registeredCycles }
  );
  assert.equal(result.classification, "deterministic");
  assert.equal(result.inferred_cycle, 2026);
});

test("uses explicit source metadata but ignores unrelated years", () => {
  assert.deepEqual(
    explicitPayloadCycles({ cycle: 2028, sample_year: 2026 }, registeredCycles),
    [2028]
  );
});

test("uses a leading provider subject year and preserves the exact field", () => {
  assert.deepEqual(providerSubjectEvidence(
    { subject: "2026 Nevada", source_payload: {} },
    registeredCycles
  ), [
    {
      source: "provider_subject",
      cycle: 2026,
      field: "subject",
      value: "2026 Nevada",
    },
  ]);
});

test("never extracts a cycle from an opaque poll id", () => {
  const row = {
    id: 17477,
    poll_id: "gov202nob02972028",
    subject: "2026 Nevada",
    race_name: "Nevada Governor",
    field_end: "2026-03-13",
    source_payload: { subject: "2026 Nevada" },
  };

  assert.deepEqual(raceIdentifierCycles(row, registeredCycles), []);
  const result = diagnosePollingRecord(row, { registeredCycles });
  assert.equal(result.classification, "deterministic");
  assert.equal(result.inferred_cycle, 2026);
});

test("treats a year in a semantic race name as supporting evidence only", () => {
  const result = diagnosePollingRecord(
    { id: 2, race_name: "Governor 2028", field_end: "2026-08-01", source_payload: {} },
    { registeredCycles }
  );
  assert.equal(result.classification, "unresolved");
  assert.equal(result.reason, "supporting_evidence_only");
});

test("quarantines conflicting authoritative evidence", () => {
  const result = diagnosePollingRecord(
    {
      id: 3,
      election_date: "2026-11-03",
      subject: "2028 Nevada",
      field_end: "2026-08-01",
      source_payload: {},
    },
    { registeredCycles }
  );
  assert.equal(result.classification, "conflict");
  assert.equal(result.inferred_cycle, null);
});

test("candidate cycle alone is not sufficient to classify a poll", () => {
  const result = diagnosePollingRecord(
    { id: 4, candidate_id: "H0XX00001", field_end: "2026-08-01", source_payload: {} },
    { registeredCycles, candidateCycles: new Map([["H0XX00001", 2026]]) }
  );
  assert.equal(result.classification, "unresolved");
  assert.equal(result.reason, "supporting_evidence_only");
});

test("poll dates validate chronology but never assign a cycle by themselves", () => {
  const result = diagnosePollingRecord(
    { id: 5, field_end: "2026-08-01", source_payload: {} },
    { registeredCycles }
  );
  assert.equal(result.classification, "unresolved");
});

test("rejects a cycle that predates the poll", () => {
  const result = diagnosePollingRecord(
    { id: 6, election_date: "2026-11-03", field_end: "2028-01-01", source_payload: {} },
    { registeredCycles }
  );
  assert.equal(result.classification, "conflict");
});

test("quarantines an entire poll group until every answer row agrees", () => {
  const rows = [
    { id: 7, source: "VoteHub", poll_id: "shared", field_end: "2026-03-13" },
    { id: 8, source: "VoteHub", poll_id: "shared", field_end: "2026-03-13" },
  ];
  const results = [
    { polling_result_id: 7, classification: "deterministic", inferred_cycle: 2026 },
    { polling_result_id: 8, classification: "unresolved", inferred_cycle: null },
  ];

  const adjusted = enforcePollGroupConsistency(rows, results);
  assert.deepEqual(adjusted.map((item) => item.classification), ["unresolved", "unresolved"]);
  assert.deepEqual(adjusted.map((item) => item.reason), ["poll_group_incomplete", "poll_group_incomplete"]);
});
