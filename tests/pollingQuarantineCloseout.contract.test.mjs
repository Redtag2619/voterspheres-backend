import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildCloseoutPlan,
  groupUnresolvedRows,
  stableMappingHash,
  unresolvedGroupKey,
} from "../scripts/auditPollingQuarantineCloseout.mjs";

const registeredCycles = new Set([2026, 2028, 2030]);

test("uses provider and poll id as the stable group boundary", () => {
  assert.equal(unresolvedGroupKey({ source: "VoteHub", poll_id: "abc" }), "votehub|abc");
  const groups = groupUnresolvedRows([
    { id: 1, source: "VoteHub", poll_id: "abc" },
    { id: 2, source: "VoteHub", poll_id: "abc" },
    { id: 3, source: "Other", poll_id: "abc" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].members.length, 2);
});

test("classifies approval groups as deterministic continuous tracking", () => {
  const rows = [
    { id: 1, source: "Provider", poll_id: "approval-1", poll_type: "approval" },
    { id: 2, source: "Provider", poll_id: "approval-1", poll_type: "approval" },
  ];
  const plan = buildCloseoutPlan(rows, registeredCycles);
  assert.equal(plan.summary.deterministic_records, 2);
  assert.equal(plan.mapping[0].temporal_scope, "continuous_tracking");
  assert.equal(plan.mapping[0].cycle, null);
});

test("accepts election groups only with deterministic shared evidence", () => {
  const rows = [
    { id: 10, source: "Provider", poll_id: "race-1", poll_type: "governor", subject: "2028 Nevada", field_end: "2027-11-01" },
    { id: 11, source: "Provider", poll_id: "race-1", poll_type: "governor", subject: "2028 Nevada", field_end: "2027-11-01" },
  ];
  const plan = buildCloseoutPlan(rows, registeredCycles);
  assert.equal(plan.summary.deterministic_records, 2);
  assert.equal(plan.mapping[0].temporal_scope, "election_cycle");
  assert.equal(plan.mapping[0].cycle, 2028);
});

test("leaves incomplete or unsupported groups quarantined", () => {
  const rows = [
    { id: 20, source: "Provider", poll_id: "issue-1", poll_type: "issue", subject: "Policy" },
    { id: 21, source: "Provider", poll_id: "race-2", poll_type: "governor", subject: "Nevada" },
  ];
  const plan = buildCloseoutPlan(rows, registeredCycles);
  assert.equal(plan.summary.deterministic_records, 0);
  assert.equal(plan.summary.quarantined_records, 2);
});

test("mapping confirmation hash is independent of record order", () => {
  const first = [
    { polling_result_id: "2", temporal_scope: "election_cycle", cycle: 2028, group_key: "b" },
    { polling_result_id: "1", temporal_scope: "continuous_tracking", cycle: null, group_key: "a" },
  ];
  assert.equal(stableMappingHash(first), stableMappingHash([...first].reverse()));
});

test("closeout implementation is diagnostic-only", () => {
  const source = fs.readFileSync(new URL("../scripts/auditPollingQuarantineCloseout.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i);
  assert.match(source, /WHERE temporal_scope = 'unresolved'/);
  assert.match(source, /Diagnostic only; polling_results was not modified/);
});
