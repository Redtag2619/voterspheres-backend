import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getExecutivePollingDashboard,
  normalizePollingTemporalScope,
  POLLING_TEMPORAL_SCOPES,
} from "../services/executivePollingIntelligence.service.js";

test("normalizes the two public polling scopes", () => {
  assert.equal(normalizePollingTemporalScope(), POLLING_TEMPORAL_SCOPES.election);
  assert.equal(
    normalizePollingTemporalScope("continuous_tracking"),
    POLLING_TEMPORAL_SCOPES.continuous
  );
});

test("rejects unknown temporal-scope values", () => {
  assert.throws(
    () => normalizePollingTemporalScope("approval-cycle"),
    { code: "INVALID_POLLING_TEMPORAL_SCOPE", statusCode: 400 }
  );
});

test("normal users cannot request unresolved or combined records", async () => {
  await assert.rejects(
    () => getExecutivePollingDashboard({ query: { temporal_scope: "unresolved" } }),
    { code: "POLLING_SCOPE_FORBIDDEN", statusCode: 403 }
  );
  await assert.rejects(
    () => getExecutivePollingDashboard({ query: { temporal_scope: "all" } }),
    { code: "POLLING_SCOPE_FORBIDDEN", statusCode: 403 }
  );
});

test("continuous tracking cannot accept an election-cycle filter", async () => {
  await assert.rejects(
    () => getExecutivePollingDashboard({
      query: { temporal_scope: "continuous_tracking", cycle: "2026" },
    }),
    { code: "POLLING_SCOPE_CYCLE_CONFLICT", statusCode: 400 }
  );
});

test("service filters election cycle independently from temporal scope", () => {
  const source = fs.readFileSync(
    new URL("../services/executivePollingIntelligence.service.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /temporal_scope = \$\{push\(filters\.temporalScope\)\}/);
  assert.match(source, /cycle = \$\{push\(filters\.cycle\)\}/);
  assert.match(source, /POLLING_SCOPE_FORBIDDEN/);
});

test("only platform roles receive unresolved scope visibility", () => {
  const controller = fs.readFileSync(
    new URL("../controllers/executivePollingIntelligence.controller.js", import.meta.url),
    "utf8"
  );
  assert.match(controller, /platform_admin/);
  assert.match(controller, /super_admin/);
  assert.match(controller, /platform_operator/);
  assert.match(controller, /includeUnresolved: canViewUnresolvedPolling\(req\)/);
});

test("authenticated clients can load explicit scope options", () => {
  const routes = fs.readFileSync(
    new URL("../routes/executivePollingIntelligence.routes.js", import.meta.url),
    "utf8"
  );
  assert.match(routes, /"\/scopes",\s*requireAuth,\s*getExecutivePollingScopesController/s);
});
