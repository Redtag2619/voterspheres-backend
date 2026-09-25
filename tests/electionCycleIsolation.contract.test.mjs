import test from "node:test";
import assert from "node:assert/strict"; 
import fs from "node:fs";

const migration = fs.readFileSync("db/migrations/20260925_build_7_3_cycle_isolation.sql", "utf8");
const routes = fs.readFileSync("routes/electionCycleIsolation.routes.js", "utf8");
const service = fs.readFileSync("services/electionCycleIsolation.service.js", "utf8");
const remediation = fs.readFileSync("scripts/remediateCandidateCycles.mjs", "utf8");

test("unresolved candidates are quarantined rather than defaulted", () => {
  assert.match(migration, /legacy_unresolved/);
  assert.match(migration, /WHERE c\.election_year IS NULL/);
  assert.doesNotMatch(migration, /SET election_year\s*=\s*2026/i);
});

test("cycle-bearing tables reference the election-cycle registry", () => {
  assert.match(migration, /candidates_election_year_registry_fk/);
  assert.match(migration, /workspaces_election_cycle_year_registry_fk/);
  assert.match(migration, /fundraising_live_election_year_registry_fk/);
  assert.match(migration, /polling_results_cycle_registry_fk/);
});

test("remediation endpoints require a platform operator", () => {
  const protectedRoutes = routes.match(/requirePlatformOperator/g) || [];
  assert.ok(protectedRoutes.length >= 4);
});

test("manual remediation only updates unresolved candidates", () => {
  assert.match(service, /AND election_year IS NULL/);
  assert.match(service, /status = 'pending'/);
  assert.match(remediation, /Preview only/);
  assert.match(remediation, /--apply/);
});
