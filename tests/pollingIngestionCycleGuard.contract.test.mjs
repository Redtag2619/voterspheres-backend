import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertPollingResultCycle,
  classifyIncomingPollingGroup,
  pollingGroupKey,
} from "../services/pollingIngestionCycleGuard.service.js";

const cycles = new Set([2026, 2028, 2030]);

function row(overrides = {}) {
  return {
    poll_id: "poll-1",
    source: "VoteHub",
    poll_type: "governor",
    subject: "2026 Nevada",
    field_end: "2026-03-13",
    source_payload: { subject: "2026 Nevada" },
    ...overrides,
  };
}

test("accepts a complete poll group with one deterministic registered cycle", () => {
  const result = classifyIncomingPollingGroup([row(), row({ candidate_name: "Second" })], cycles);
  assert.equal(result.accepted, true);
  assert.equal(result.cycle, 2026);
  assert.deepEqual(result.rows.map((item) => item.cycle), [2026, 2026]);
});

test("quarantines a group with no deterministic cycle evidence", () => {
  const result = classifyIncomingPollingGroup([
    row({ subject: "Nevada", source_payload: { subject: "Nevada" } }),
  ], cycles);
  assert.equal(result.accepted, false);
  assert.equal(result.issue_code, "missing_deterministic_cycle");
});

test("quarantines conflicting authoritative evidence", () => {
  const result = classifyIncomingPollingGroup([
    row({ election_date: "2026-11-03" }),
    row({ election_date: "2028-11-07", subject: "2028 Nevada", source_payload: { subject: "2028 Nevada" } }),
  ], cycles);
  assert.equal(result.accepted, false);
});

test("does not infer a cycle from an opaque poll id", () => {
  const result = classifyIncomingPollingGroup([
    row({ poll_id: "gov202nob02972028", subject: "Nevada", source_payload: {} }),
  ], cycles);
  assert.equal(result.accepted, false);
});

test("uses a stable poll-group key", () => {
  assert.equal(pollingGroupKey([row()], {}), pollingGroupKey([row()], { ignored: true }));
});

test("direct writes require an even supported-format cycle", () => {
  assert.equal(assertPollingResultCycle({ temporal_scope: "election_cycle", cycle: 2028 }), 2028);
  assert.throws(() => assertPollingResultCycle({ temporal_scope: "election_cycle", cycle: null }), /requires a deterministic/);
  assert.throws(() => assertPollingResultCycle({ temporal_scope: "election_cycle", cycle: 2027 }), /requires a deterministic/);
});

test("canonical ingestion guards complete groups before any answer-row upsert", () => {
  const source = fs.readFileSync(
    new URL("../services/pollingIngestion.service.js", import.meta.url),
    "utf8"
  );
  const guardIndex = source.indexOf("const guarded = await guardIncomingPollingGroup");
  const upsertIndex = source.indexOf("const action = await upsertPollingResult", guardIndex);
  assert.ok(guardIndex >= 0);
  assert.ok(upsertIndex > guardIndex);
  assert.match(source, /assertPollingResultCycle\(row\)/);
});

test("database migration rejects cycle-less new polling rows", () => {
  const migration = fs.readFileSync(
    new URL("../db/migrations/20260928_build_7_5_polling_ingestion_cycle_enforcement.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /BEFORE INSERT ON polling_results/);
  assert.match(migration, /IF NEW\.cycle IS NULL/);
});
