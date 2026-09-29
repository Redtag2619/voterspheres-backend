import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPollingIngestionCanaryReport,
  normalizeCanaryLimit,
} from "../services/pollingIngestionCanary.service.js";

const cycles = new Set([2026, 2028, 2030]);
const snapshot = {
  polling_results: 12910,
  unresolved_results: 8262,
  quarantined_groups: 0,
  ingestion_runs: 9,
};

function poll(overrides = {}) {
  return {
    id: "canary-1",
    subject: "2026 Nevada",
    poll_type: "governor",
    state: "NV",
    end_date: "2026-03-13",
    answers: [
      { choice: "Candidate A", pct: 48 },
      { choice: "Candidate B", pct: 46 },
    ],
    ...overrides,
  };
}

test("limits the provider canary to ten poll groups", () => {
  assert.equal(normalizeCanaryLimit(5), 5);
  assert.equal(normalizeCanaryLimit(100), 10);
  assert.equal(normalizeCanaryLimit(0), 5);
});

test("reports deterministic groups without changing the supplied snapshot", () => {
  const report = buildPollingIngestionCanaryReport({
    polls: [poll()],
    registeredCycles: cycles,
    before: snapshot,
    after: { ...snapshot },
  });
  assert.equal(report.mode, "read_only");
  assert.equal(report.would_accept_groups, 1);
  assert.equal(report.would_accept_answers, 2);
  assert.equal(report.would_quarantine_groups, 0);
  assert.equal(report.database_unchanged, true);
});

test("reports ambiguous groups as would-quarantine", () => {
  const report = buildPollingIngestionCanaryReport({
    polls: [poll({ subject: "Nevada" })],
    registeredCycles: cycles,
    before: snapshot,
    after: { ...snapshot },
  });
  assert.equal(report.would_accept_groups, 0);
  assert.equal(report.would_quarantine_groups, 1);
});

test("detects any database count change during the canary window", () => {
  const report = buildPollingIngestionCanaryReport({
    polls: [],
    registeredCycles: cycles,
    before: snapshot,
    after: { ...snapshot, polling_results: 12911 },
  });
  assert.equal(report.database_unchanged, false);
});

test("canary implementation contains no database mutation statements", () => {
  const service = fs.readFileSync(
    new URL("../services/pollingIngestionCanary.service.js", import.meta.url),
    "utf8"
  );
  const script = fs.readFileSync(
    new URL("../scripts/runPollingIngestionCanary.mjs", import.meta.url),
    "utf8"
  );
  const databaseMutation = /\b(INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE\s+)/i;
  assert.doesNotMatch(service, databaseMutation);
  assert.doesNotMatch(script, databaseMutation);
});
