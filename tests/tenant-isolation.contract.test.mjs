import test from "node:test";
import assert from "node:assert/strict"; 
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("authentication uses database firm only", () => {
  const source = read("middleware/auth.middleware.js");
  assert.match(source, /resolvedFirmId\s*=\s*databaseFirmId\s*\|\|\s*null/);
  assert.doesNotMatch(source, /firmIdFromToken/);
});

test("role guards use the current database-backed user", () => {
  const source = read("middleware/roles.middleware.js");
  assert.match(source, /requireCurrentRoles/);
  assert.doesNotMatch(source, /jwt\.verify/);
});

test("task mutations scope records to authenticated firm", () => {
  const source = read("routes/tasks.routes.js");
  assert.match(source, /WHERE id = \$1 AND firm_id = \$2/);
  assert.match(source, /WHERE id = \$1 AND firm_id = \$19/);
  assert.doesNotMatch(source, /req\.body\.firm_id/);
});

test("shared data mutations require platform operator", () => {
  for (const file of ["routes/endorsements.routes.js", "routes/vendors.routes.js", "routes/fec.routes.js", "routes/candidates.routes.js"]) {
    assert.match(read(file), /requirePlatformOperator/, file);
  }
});

test("billing webhook fails closed", () => {
  const source = read("routes/billing.routes.js");
  const service = read("services/billingPlan.service.js");
  assert.match(source, /Stripe webhook is not configured/);
  assert.match(source, /Missing Stripe signature/);
  assert.doesNotMatch(source, /event = JSON\.parse\(rawBody\)/);
  assert.match(source, /claimStripeWebhookEvent/);
  assert.match(service, /ON CONFLICT \(event_id\)/);
});

test("campaign and workspace boundaries are mandatory", () => {
  assert.match(read("routes/campaignCommand.routes.js"), /campaigns WHERE id = \$1 AND firm_id = \$2/);
  const source = read("services/campaignWorkspaces.service.js");
  assert.doesNotMatch(source, /\$\d+::int IS NULL OR/);
  assert.match(source, /assertWorkspace\(workspaceId, firmId\)/);
});
