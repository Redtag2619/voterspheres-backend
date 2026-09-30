# Phase 2.10: future-cycle propagation and evidence isolation

## Behavior
The copilot's two orchestrator calls use the already resolved server temporalScope.cycle_year. Existing server-authoritative date validation and repair-then-reject behavior remain. Both active monolithic and modular platform-context boundaries filter recommendations, signals, tasks, reports and workspaces by explicit cycle metadata when strict_temporal is enabled. Records with missing, conflicting, unresolved, legacy-unresolved or continuous-tracking scope cannot become election-cycle evidence. Donors, vendors and CRM remain shared operational context with an explicit policy label. Aggregated all-cycle summaries are withheld. Matching counts describe source entries, not deduplicated sources or surveys.

The existing SQL for reports does not select cycle metadata, so those reports are withheld from strict-cycle evidence. No schema columns are assumed and no queries or migrations are added. A later source-specific integration can carry verified cycle metadata. This change does not prove that every platform endpoint, database table or saved deliverable is cycle-isolated. Candidate bundle polling retains the previously installed Phase 2.9 boundary. Historical shared data must not be interpreted as verified 2028 evidence.

Studio strategy and asset generation both request strict temporal validation. Changing campaign/state/office/cycle clears the active conversation display and starts a separate thread without deleting saved sessions. Late responses for a previous scope are rejected. Display/export defaults no longer invent 2026 when no cycle is selected. The browser describes its requested window; server validation remains authoritative.

The polling dashboard resolves the API's current registered cycle before its first election-data request, instead of querying all cycles. Users can then choose 2028, 2030 and other API-provided cycles. Cross-cycle aggregate selection is removed. Approval/favorability remains continuous tracking. Late responses cannot overwrite a newer selection.

Federal cycle generation accepts integer counts 1–50 and truncates output at 2200. State/local odd-year scheduling rules are preserved.

## Install and validate
Install backend first, then frontend using the scripts in this ZIP. Each installer previews by default, applies only with --apply, checks localized source hooks and backs up originals. Current package dependencies and other scripts are retained. Backups reside in backups/phase-2-10-*. Installer tests and contract tests do not contact providers or databases. Source files supplied inside backend/services and frontend/src/pages are review copies; installers patch current files through scripts/patches.mjs.

Backend: npm run check:syntax; npm run test:future-cycle-evidence; npm run test:tenant-isolation; npm run test:executive-polling-evidence; npm run test:executive-polling-prose; npm run test:polling-operations-monitor; npm run test:election-cycles. Frontend: npm run test:future-cycle-ui; node --test tests/pollingTemporalScopeUi.contract.test.mjs; npm run build. Run git diff --check in each repository. Inspect package.json staging carefully: the pre-existing Nodemailer/dependency update must not be inadvertently included.

A full Vite build requires the actual frontend repository dependencies and is a user-side acceptance step. Verify that the frontend API environment points to the intended Render backend: its API client fallback still names voterspheres-backend-2pap.onrender.com, while the observed deployment log named voterspheres-backend.onrender.com. This patch does not switch hosts or change credentials.

## Acceptance
Select TX / U.S. House / 2028 in Studio. Confirm request cycle=2028 and strict_temporal=true for strategy and asset generation. Change to 2030 during a pending request; previous response must not be displayed as new-cycle output. Confirm platform recommendations without explicit matching cycle metadata are absent or disclosed as unavailable, rather than described as verified future-cycle intelligence. Verify server temporal_scope.cycle_year and date window in the response.

In polling select 2028, then 2030; confirm requests carry that cycle and no 2026 election records appear. No matching polls should be an empty data state, not proof of a provider outage or an inferred election estimate. Verify continuous tracking still works separately. Backend authorization/tenant guards are unchanged. No record remediation, cycle activation or production data writes are part of installation.

Deploy backend before frontend after reviewed commits. Confirm each provider deployed the appropriate commit and repeat authenticated production acceptance. Keep the unrelated FEC cron issue separate.

## Rollback
Use the displayed backup to restore only modified source files and package.json. Remove only the new helper/test/doc files listed by that installer. Do not overwrite unrelated changes made after installation. Restoring code does not alter database data or recover previously overwritten FEC evidence.
