import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPollingCycleRemediationPlan,
  normalizePollingCycleMapping,
  pollingGroupKey,
} from "../services/pollingCycleRemediation.service.js";

function deterministic(id, cycle = 2026) {
  return {
    polling_result_id: String(id),
    classification: "deterministic",
    inferred_cycle: cycle,
    reason: "provider_subject",
    authoritative_evidence: [
      { source: "provider_subject", cycle, field: "subject", value: String(cycle) },
    ],
  };
}

function row(id, overrides = {}) {
  return {
    id: String(id),
    poll_id: "poll-1",
    source: "VoteHub",
    source_dataset: "votehub-polling-api",
    field_end: "2026-03-13",
    cycle: null,
    ...overrides,
  };
}

test("normalizes mapping records and rejects duplicate ids", () => {
  assert.deepEqual(normalizePollingCycleMapping([
    { polling_result_id: 10, cycle: 2026 },
  ]), [{ polling_result_id: "10", cycle: 2026 }]);

  assert.throws(() => normalizePollingCycleMapping([
    { polling_result_id: 10, cycle: 2026 },
    { polling_result_id: "10", cycle: 2026 },
  ]), /Duplicate polling_result_id/);
});

test("does not treat an opaque poll id as cycle evidence", () => {
  assert.equal(pollingGroupKey(row(1, { poll_id: "gov202nob02972028" })),
    "votehub-polling-api|gov202nob02972028|2026-03-13");
});

test("builds a deterministic complete-group plan", () => {
  const plan = buildPollingCycleRemediationPlan({
    mappingRows: [
      { polling_result_id: 1, cycle: 2026 },
      { polling_result_id: 2, cycle: 2026 },
    ],
    diagnosticResults: [deterministic(1), deterministic(2)],
    pollingRows: [row(1), row(2)],
  });

  assert.equal(plan.records, 2);
  assert.equal(plan.groups, 1);
  assert.deepEqual(plan.cycle_counts, { 2026: 2 });
  assert.match(plan.mapping_sha256, /^[a-f0-9]{64}$/);
});

test("rejects a mapping that omits an answer row from a poll group", () => {
  assert.throws(() => buildPollingCycleRemediationPlan({
    mappingRows: [{ polling_result_id: 1, cycle: 2026 }],
    diagnosticResults: [deterministic(1)],
    pollingRows: [row(1), row(2)],
  }), /group .* is incomplete/i);
});

test("rejects stale or changed deterministic evidence", () => {
  assert.throws(() => buildPollingCycleRemediationPlan({
    mappingRows: [{ polling_result_id: 1, cycle: 2026 }],
    diagnosticResults: [deterministic(1, 2028)],
    pollingRows: [row(1, { poll_id: null })],
  }), /currently resolves to 2028/);
});

test("rejects records that are already classified", () => {
  assert.throws(() => buildPollingCycleRemediationPlan({
    mappingRows: [{ polling_result_id: 1, cycle: 2026 }],
    diagnosticResults: [deterministic(1)],
    pollingRows: [row(1, { poll_id: null, cycle: 2026 })],
  }), /already classified/);
});

test("requires every member of a poll group to resolve to one cycle", () => {
  assert.throws(() => buildPollingCycleRemediationPlan({
    mappingRows: [
      { polling_result_id: 1, cycle: 2026 },
      { polling_result_id: 2, cycle: 2028 },
    ],
    diagnosticResults: [deterministic(1, 2026), deterministic(2, 2028)],
    pollingRows: [row(1), row(2)],
  }), /does not resolve to one cycle/);
});

test("uses a stable confirmation hash independent of mapping order", () => {
  const args = {
    diagnosticResults: [deterministic(1), deterministic(2)],
    pollingRows: [row(1), row(2)],
  };
  const first = buildPollingCycleRemediationPlan({
    ...args,
    mappingRows: [
      { polling_result_id: 1, cycle: 2026 },
      { polling_result_id: 2, cycle: 2026 },
    ],
  });
  const second = buildPollingCycleRemediationPlan({
    ...args,
    mappingRows: [
      { polling_result_id: 2, cycle: 2026 },
      { polling_result_id: 1, cycle: 2026 },
    ],
  });
  assert.equal(first.mapping_sha256, second.mapping_sha256);
});

test("apply path is serializable locked audited and explicitly confirmed", () => {
  const source = fs.readFileSync(
    new URL("../services/pollingCycleRemediation.service.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /LOCK TABLE polling_results/);
  assert.match(source, /confirmCount/);
  assert.match(source, /confirmSha256/);
  assert.match(source, /polling_cycle_remediation_items/);
});

test("installer and preview do not invoke remediation apply", () => {
  const installer = fs.readFileSync(
    new URL("../Install-VoterSpheres-Phase-2-2.ps1", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(installer, /remediate:polling-cycles.*--apply/);
  assert.match(installer, /No polling records were changed by this installer/);
});
