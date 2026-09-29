import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertPollingResultCycle,
  classifyIncomingPollingGroup,
  classifyPollingTemporalScope,
} from "../services/pollingIngestionCycleGuard.service.js";

const registeredCycles = new Set([2026, 2028, 2030]);

test("classifies approval and favorability as continuous tracking", () => {
  assert.equal(classifyPollingTemporalScope([{ poll_type: "approval" }]), "continuous_tracking");
  assert.equal(classifyPollingTemporalScope([{ poll_type: "favorability" }]), "continuous_tracking");
});

test("accepts continuous tracking without fabricating a cycle", () => {
  const result = classifyIncomingPollingGroup([
    { poll_type: "approval", poll_id: "approval-1", field_end: "2025-01-20" },
    { poll_type: "approval", poll_id: "approval-1", field_end: "2025-01-20" },
  ], registeredCycles);
  assert.equal(result.accepted, true);
  assert.equal(result.temporal_scope, "continuous_tracking");
  assert.equal(result.cycle, null);
  assert.ok(result.rows.every((row) => row.cycle === null));
});

test("keeps election polling cycle-bound", () => {
  const result = classifyIncomingPollingGroup([
    { poll_type: "governor", poll_id: "race-1", subject: "2028 Nevada", field_end: "2027-10-01" },
  ], registeredCycles);
  assert.equal(result.accepted, true);
  assert.equal(result.temporal_scope, "election_cycle");
  assert.equal(result.cycle, 2028);
});

test("quarantines unsupported poll types", () => {
  const result = classifyIncomingPollingGroup([
    { poll_type: "mystery-index", poll_id: "unknown-1" },
  ], registeredCycles);
  assert.equal(result.accepted, false);
  assert.equal(result.temporal_scope, "unresolved");
  assert.equal(result.issue_code, "unsupported_temporal_scope");
});

test("direct writes enforce scope and cycle consistency", () => {
  assert.equal(assertPollingResultCycle({ temporal_scope: "continuous_tracking", cycle: null }), null);
  assert.equal(assertPollingResultCycle({ temporal_scope: "election_cycle", cycle: 2028 }), 2028);
  assert.throws(
    () => assertPollingResultCycle({ temporal_scope: "continuous_tracking", cycle: 2028 }),
    { code: "CONTINUOUS_POLLING_CYCLE_FORBIDDEN" }
  );
  assert.throws(
    () => assertPollingResultCycle({ temporal_scope: "unresolved", cycle: null }),
    { code: "POLLING_TEMPORAL_SCOPE_REQUIRED" }
  );
});

test("migration backfills only exact continuous types and preserves unresolved records", () => {
  const sql = fs.readFileSync(
    new URL("../db/migrations/20260929_build_7_6_polling_temporal_scope.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /IN \('approval', 'favorability'\)/);
  assert.match(sql, /ELSE 'unresolved'/);
  assert.match(sql, /Unresolved polling must be quarantined/);
});

test("election intelligence reads default to election-cycle scope", () => {
  const polling = fs.readFileSync(
    new URL("../services/pollingIntelligence.service.js", import.meta.url),
    "utf8"
  );
  const executive = fs.readFileSync(
    new URL("../services/executivePollingIntelligence.service.js", import.meta.url),
    "utf8"
  );
  const voice = fs.readFileSync(
    new URL("../services/executiveVoiceLiveSources.service.js", import.meta.url),
    "utf8"
  );
  assert.match(polling, /temporalScope = "election_cycle"/);
  assert.match(executive, /query\.temporal_scope \|\| "election_cycle"/);
  assert.match(voice, /temporalScope = "election_cycle"/);
});
