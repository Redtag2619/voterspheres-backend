import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFederalElectionCycles,
  isFederalElectionCycle,
  normalizeFederalElectionCycle,
  optionalFederalElectionCycle,
} from "../utils/electionCycle.js";

test("accepts supported even federal election cycles", () => {
  for (const year of [2026, 2028, 2030, 2040]) {
    assert.equal(isFederalElectionCycle(year), true);
    assert.equal(normalizeFederalElectionCycle(String(year)), year);
  }
});

test("rejects odd malformed and out-of-range cycles", () => {
  for (const value of [2025, 2027, 2029, 0, "abc", 2202]) {
    assert.throws(() => normalizeFederalElectionCycle(value), /even-numbered federal election cycle/);
  }
});

test("uses a controlled fallback and supports optional filters", () => {
  assert.equal(normalizeFederalElectionCycle(undefined, { fallback: 2028 }), 2028);
  assert.equal(optionalFederalElectionCycle(undefined), null);
  assert.equal(optionalFederalElectionCycle("2030"), 2030);
});

test("generates future cycles in two-year increments", () => {
  assert.deepEqual(buildFederalElectionCycles({ startYear: 2026, count: 4 }), [2026, 2028, 2030, 2032]);
});
