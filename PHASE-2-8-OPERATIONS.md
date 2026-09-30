# Phase 2.8 — Polling operational monitoring

Adds a report-only assessment of the existing Phase 2.6 production validation and Phase 2.7 quarantine audit. Preserves all existing service, route, database and audit code. No dependencies or migrations are added. Monitoring is invoked manually; this package does not install a scheduler or send notifications.

The recorded Phase 2.7 baseline is 335 unresolved answer rows in 154 groups, zero deterministic corrections, all retained for missing_deterministic_cycle. These numbers are context, not hard-coded acceptance criteria. The actual baseline comes from fresh reports. Phase 2.7.1 remediation is unnecessary while there are no deterministic mappings.

## Install

Extract this ZIP to Downloads. From the backend repository:

```powershell
cd C:\Users\sas26\voterspheres-backend-production-ready
$installer = "$env:USERPROFILE\Downloads\VoterSpheres-Phase-2-8-Polling-Operations\Install-VoterSpheres-Phase-2-8.ps1"
Unblock-File -LiteralPath $installer
& $installer
& $installer -Apply
npm run check:syntax
if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed' }
npm run test:polling-operations-monitor
if ($LASTEXITCODE -ne 0) { throw 'Monitoring tests failed' }
npm run test:tenant-isolation
if ($LASTEXITCODE -ne 0) { throw 'Tenant isolation tests failed' }
git diff --check
```

Installer previews by default, refuses existing Phase 2.8 files/script names, and backs up package.json before adding two scripts. Existing scripts/dependencies are preserved. It does not rewrite the Phase 2.7 audit (including your ingestion_run_id schema fix).

## Refresh evidence and assess

Use a new directory per run. Configure PHASE_2_6_BASE_URL and PHASE_2_6_USER_TOKEN in the current shell before running. Optionally set PHASE_2_6_OPERATOR_TOKEN for operator coverage. Do not paste tokens into commands or commit them. The Phase 2.6 validator reads environment variables directly; it does not load .env. The Phase 2.7 audit uses the existing backend database configuration: confirm it points to the same deployment being validated.

```powershell
cd C:\Users\sas26\voterspheres-backend-production-ready
if (-not $env:PHASE_2_6_BASE_URL -or -not $env:PHASE_2_6_USER_TOKEN) {
  throw 'Set the API base URL and user token environment variables first.'
}
$run = Join-Path (Get-Location).Path ('diagnostics\phase-2-8\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $run | Out-Null
node .\scripts\validatePollingTemporalScopeDeployment.mjs "--output=$run"
if ($LASTEXITCODE -ne 0) { throw 'Production validation failed; inspect its report before proceeding.' }
node .\scripts\auditPollingQuarantineCloseout.mjs "--output=$run"
if ($LASTEXITCODE -ne 0) { throw 'Quarantine audit failed; do not reuse old evidence.' }
$validation = @(Get-ChildItem -LiteralPath $run -Filter 'phase-2-6-production-validation-*.json' -File)
$closeout = @(Get-ChildItem -LiteralPath $run -Filter 'polling-quarantine-closeout-*.json' -File)
if ($validation.Count -ne 1 -or $closeout.Count -ne 1) { throw 'Expected one fresh report of each type.' }
npm run monitor:polling-operations -- "--validation=$($validation[0].FullName)" "--closeout=$($closeout[0].FullName)" "--output=$run"
if ($LASTEXITCODE -ne 0) { throw 'Monitoring needs attention; inspect the report.' }
```

Review the generated polling-operations-*.json. If status is healthy or healthy_with_quarantine, and the evidence is from the correct deployment, retain a copy as the explicit baseline:

```powershell
$report = @(Get-ChildItem -LiteralPath $run -Filter 'polling-operations-*.json' -File)
if ($report.Count -ne 1) { throw 'Expected exactly one monitoring report.' }
$baselinePath = Join-Path (Get-Location).Path 'diagnostics\phase-2-8\baseline.json'
if (Test-Path -LiteralPath $baselinePath) { throw 'Baseline exists. Review changes before choosing a replacement.' }
Copy-Item -LiteralPath $report[0].FullName -Destination $baselinePath
```

On subsequent runs, refresh both evidence reports into a NEW $run directory using the commands above, then invoke monitoring with the retained baseline:

```powershell
npm run monitor:polling-operations -- "--validation=$($validation[0].FullName)" "--closeout=$($closeout[0].FullName)" "--baseline=$baselinePath" "--output=$run"
```

You can also assess a failed Phase 2.6 report explicitly to produce a validation_failed alert. Do not bypass the refresh command's failure automatically.

## Status and response

| Result | Meaning | Next step |
|---|---|---|
| healthy | Validation passes, no unresolved records | Retain evidence and continue routine checks |
| healthy_with_quarantine | Validation passes, ambiguous quarantine remains | Keep records quarantined and compare subsequent runs |
| attention_required / quarantine_drift | Added, removed or changed record IDs, group keys or issue codes | Compare reports and ingestion logs; removals are review events too |
| attention_required / deterministic_correction_available | Guard now identifies complete deterministic groups | Review the Phase 2.7 mapping before building remediation |
| attention_required / validation_failed | Production checks failed | Resolve indicated API/auth/scope regression |
| attention_required / stale_evidence or future_evidence | Evidence older than 24 hours or timestamp over five minutes ahead | Refresh reports or correct clock |
| Exit 1 | Invalid arguments, malformed evidence or I/O error | Correct input; no healthy assessment was produced |
| Exit 2 | Valid assessment requiring attention | Inspect alerts; do not advance baseline automatically |

The report includes only record IDs/group metadata from closeout plus validation check labels, counts, timestamps and hashes. It does not copy API response bodies or tokens. Treat diagnostic files as operator material. Hashes detect accidental inconsistency; they are not digital signatures or proof of authenticity. The Phase 2.7 format lacks database identity, so the monitor cannot prove API/database environment alignment. Operator coverage is recorded separately and optional. A passing contract test is not a live cross-tenant authorization test.

The package detects quarantine drift and validation regressions; it does not measure provider freshness, ingestion throughput or forecast quality. Stable quarantine does not certify polling coverage is complete.

## Commit and deployment

After local checks pass, review and stage only this package's files:

```powershell
git status --short
git diff -- package.json
git add -- package.json scripts/monitorPollingOperations.mjs tests/pollingOperationsMonitor.contract.test.mjs PHASE-2-8-OPERATIONS.md
git diff --cached --check
git diff --cached --stat
git commit -m "Add polling operational monitoring"
```

Verify the intended remote/branch and deploy configuration before pushing. If your Render service is configured to deploy this repository's main branch automatically, the push command is:

```powershell
git remote -v
git branch --show-current
git push origin main
```

No application deployment is necessary to run these local operator scripts. No frontend changes are included. Production deployment was not executed or verified here.

## Rollback

Restore package.json from the installer-reported backup and remove only the three newly installed Phase 2.8 files. Preserve diagnostics and the existing Phase 2.6/2.7 files. If already committed, use a reviewed git revert of the Phase 2.8 commit instead. Do not run db:init, db:seed or a polling remediation command for this package.

## Verification

Node contract tests cover stable quarantine, empty quarantine, unchanged baselines, same-count ID replacement, issue changes, failed validation, stale/future evidence, malformed totals and hashes, complete deterministic mappings, baseline environment/integrity, input immutability and CLI argument rejection. PowerShell installer execution and live deployment validation must be run on your machine; they were not available in the build environment.
