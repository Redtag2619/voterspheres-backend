import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  countSnapshot,
  normalizeBaseUrl,
  publicScopeNames,
  stableHash,
  VALIDATOR_VERSION,
} from "../scripts/validatePollingTemporalScopeDeployment.mjs";

test("identifies the Phase 2.6 validator", () => {
  assert.equal(VALIDATOR_VERSION, "2.6.0");
});

test("normalizes Render and API base URLs", () => {
  assert.equal(normalizeBaseUrl("https://example.test"), "https://example.test/api");
  assert.equal(normalizeBaseUrl("https://example.test/api/"), "https://example.test/api");
  assert.throws(() => normalizeBaseUrl("example.test"));
});

test("distinguishes public and protected scope names", () => {
  assert.deepEqual(publicScopeNames({ temporal_scopes: [
    { temporal_scope: "election_cycle" },
    { temporal_scope: "continuous_tracking" },
  ] }), ["election_cycle", "continuous_tracking"]);
  assert.deepEqual(publicScopeNames({ scopes: ["unresolved", "all"] }), ["unresolved", "all"]);
});

test("produces a stable count hash independent of key order", () => {
  assert.equal(stableHash({ election_cycle: 4, continuous_tracking: 2 }),
    stableHash({ continuous_tracking: 2, election_cycle: 4 }));
  assert.notEqual(stableHash({ election_cycle: 4 }), stableHash({ election_cycle: 5 }));
});

test("extracts supported count response shapes", () => {
  assert.deepEqual(countSnapshot({ temporal_scopes: [
    { temporal_scope: "election_cycle", polls: "4", answer_rows: "7", freshest_record: "ignored" },
  ] }), { election_cycle: { polls: 4, answer_rows: 7 } });
  assert.deepEqual(countSnapshot({ scope_counts: { a: 1 } }), { a: 1 });
  assert.deepEqual(countSnapshot({ summary: { counts: { b: 2 } } }), { b: 2 });
});

test("validator contains no database or HTTP mutation operations", () => {
  const source = fs.readFileSync(new URL("../scripts/validatePollingTemporalScopeDeployment.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.match(source, /method:\s*"GET"/);
});

test("validator exercises public and protected temporal scopes", () => {
  const source = fs.readFileSync(new URL("../scripts/validatePollingTemporalScopeDeployment.mjs", import.meta.url), "utf8");
  for (const scope of ["election_cycle", "continuous_tracking", "unresolved", "all"]) {
    assert.match(source, new RegExp(scope));
  }
  assert.match(source, /Polling scope counts unchanged/);
});
