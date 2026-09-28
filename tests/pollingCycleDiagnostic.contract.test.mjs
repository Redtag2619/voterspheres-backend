import test from "node:test";

import assert from "node:assert/strict";

import {

  diagnosePollingRecord,

  enforcePollGroupConsistency,

  explicitPayloadCycles,

  providerSubjectEvidence,

  raceIdentifierCycles,

} from "../services/pollingCycleDiagnostic.service.js";

 

const registeredCycles = new Set([2026, 2028, 2030]);

 

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
