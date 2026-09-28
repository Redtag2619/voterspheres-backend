import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosePollingRecord,
  explicitPayloadCycles,
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
  assert.deepEqual(explicitPayloadCycles({ cycle: 2028, sample_year: 2026 }, registeredCycles), [2028]);
});

test("recognizes a registered cycle embedded in a race identifier", () => {
  assert.deepEqual(raceIdentifierCycles({ race_name: "LA-GOV-2026", source_payload: {} }, registeredCycles), [2026]);
});

test("quarantines conflicting authoritative evidence", () => {
  const result = diagnosePollingRecord(
    {
      id: 2,
      election_date: "2026-11-03",
      field_end: "2026-08-01",
      race_name: "Governor-2028",
      source_payload: {},
    },
    { registeredCycles }
  );
  assert.equal(result.classification, "conflict");
  assert.equal(result.inferred_cycle, null);
});

test("candidate cycle alone is not sufficient to classify a poll", () => {
  const result = diagnosePollingRecord(
    { id: 3, candidate_id: "H0XX00001", field_end: "2026-08-01", source_payload: {} },
    { registeredCycles, candidateCycles: new Map([["H0XX00001", 2026]]) }
  );
  assert.equal(result.classification, "unresolved");
  assert.equal(result.reason, "supporting_evidence_only");
});

test("poll dates validate chronology but never assign a cycle by themselves", () => {
  const result = diagnosePollingRecord(
    { id: 4, field_end: "2026-08-01", source_payload: {} },
    { registeredCycles }
  );
  assert.equal(result.classification, "unresolved");
});

test("rejects a cycle that predates the poll", () => {
  const result = diagnosePollingRecord(
    { id: 5, election_date: "2026-11-03", field_end: "2028-01-01", source_payload: {} },
    { registeredCycles }
  );
  assert.equal(result.classification, "conflict");
});
