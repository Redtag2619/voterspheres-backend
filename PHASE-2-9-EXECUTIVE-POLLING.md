# Phase 2.9 — Executive polling evidence integration

Integrates polling scope, election cycle, freshness and coverage into candidate-intelligence bundle data and summary. This package patches the existing candidateIntelligenceBundle.service.js in place after checking the integration points. It does not replace the large service wholesale or modify the polling provider, orchestrator, database, authorization roles or frontend.

## Behavior

- Direct race records require explicit election_cycle scope and the requested cycle. The existing candidate/race grouping remains responsible for candidate and geographic relevance.
- Candidate/state context remains separate from direct race evidence. Approval and favorability never count as direct race evidence.
- Continuous tracking remains in continuous_tracking_records with cycle null and is excluded from election records.
- Unresolved/missing scope and missing/wrong cycle records are excluded. No election cycle is inferred from a survey date.
- Survey freshness uses field_end, end_date, poll_date or published_at (in that order), never ingestion/update/cache times. The default stale threshold is 30 days; undated records are unknown, future-dated records are excluded. This is a reporting threshold, not a prediction-quality guarantee.
- Bundle summary gains a polling coverage paragraph, structured polling gains freshness/limitations, and limitations join the existing warnings. Raw provider payloads are not carried through the filtered polling object.
- Counts refer to returned records, which may be answer rows. They do not represent distinct surveys or total database coverage. Exclusions refer only to supplied provider results; the 335 quarantined records are not presented as a candidate-specific count.

## Compatibility and limits

The candidate bundle source available for review was dated August 18, 2026; the live-source review archive was dated September 29. The installer requires the expected pollingGroups(pollingResult, resolvedContext, identities, normalizedLimit) call, exported bundle function and warnings array. If your current source differs, preview fails before changing anything. Send the current candidateIntelligenceBundle.service.js for an adjusted integration rather than forcing the patch.

Strict exclusion may reduce available evidence if external providers omit scope or cycle metadata. Those records remain excluded until their provenance is classified upstream; do not label them by guesswork. Unknown-date records remain visible with explicit warnings.

The bundle's summary is updated, but some orchestrator/frontend flows may assemble their own answer rather than use bundle.summary. Verify the actual /brief response after deployment. If the answer omits the new paragraph, a current orchestrator source review is needed to integrate that separate answer builder. This package does not certify every downstream prose renderer or prediction engine.

Phase 2.8 operator validation and Render commit verification remain separate outstanding checks. This package does not change admin into platform_operator or relax protected polling access.

## Install

Extract the ZIP to a new Downloads directory. Run from the backend root and locate the installer recursively to avoid nested ZIP path assumptions:

```powershell
cd C:\Users\sas26\voterspheres-backend-production-ready
$zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter 'VoterSpheres-Phase-2-9-Executive-Polling-Integration*.zip' -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw 'Download the Phase 2.9 ZIP first.' }
$extract = Join-Path "$env:USERPROFILE\Downloads" ('VoterSpheres-Phase-2-9-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Expand-Archive -LiteralPath $zip.FullName -DestinationPath $extract
$installers = @(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'installExecutivePollingIntegration.mjs')
if ($installers.Count -ne 1) { throw 'Expected one installer.' }
$installer = $installers[0].FullName
node $installer
if ($LASTEXITCODE -ne 0) { throw 'Preview failed; no install. Send current bundle source for review.' }
node $installer --apply
if ($LASTEXITCODE -ne 0) { throw 'Installation failed.' }
npm run check:syntax
if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed.' }
npm run test:executive-polling-evidence
if ($LASTEXITCODE -ne 0) { throw 'Evidence tests failed.' }
npm run test:tenant-isolation
if ($LASTEXITCODE -ne 0) { throw 'Tenant tests failed.' }
npm run test:polling-operations-monitor
if ($LASTEXITCODE -ne 0) { throw 'Monitoring tests failed.' }
git diff --check
```

## Local bundle smoke check

With the existing backend database/provider configuration, invoke the updated bundle using an existing authenticated user object through your normal application path. Reuse the Jasmine Crockett TX House 2026 briefing request from previous validation. Confirm data.polling (or the equivalent returned bundle polling section) includes evidence_version 2.9.0, freshness, excluded_record_counts and executive_summary. Continuous tracking must never appear in direct_records or records. A different-office poll remains contextual. A March poll must be stale in September, even if reingested today.

Check that bundle.summary includes the new paragraph and inspect the endpoint's answer separately. No direct-race evidence is a data gap, not a zero percentage. If polling is now absent, inspect excluded_record_counts rather than broadening eligibility.

## Commit and deployment

After checks and source diff review:

```powershell
git diff -- services/candidateIntelligenceBundle.service.js package.json
git add -- services/candidateIntelligenceBundle.service.js services/executivePollingEvidence.service.js tests/executivePollingEvidence.contract.test.mjs PHASE-2-9-EXECUTIVE-POLLING.md package.json
git diff --cached --check
git diff --cached --stat
git commit -m 'Integrate executive polling scope and freshness evidence'
```

Verify remote/branch, then push through the established backend deployment workflow. Confirm Render is Live at that new commit before using production briefing results as acceptance evidence. No frontend deployment is required for the bundle contract addition. Do not claim endpoint-level prose integration until the returned answer is checked.

## Rollback

Installer prints a backup directory containing the original package.json and candidate bundle service. Restore those two originals and remove services/executivePollingEvidence.service.js, tests/executivePollingEvidence.contract.test.mjs and this installed guide. Preserve diagnostics and existing Phase 2.8 files. If committed, revert the Phase 2.9 commit instead. No data migration or role rollback is needed.

## Validation performed during package build

Pure evidence contract tests and source-transform/installer fixture tests run without database credentials. Syntax is checked on the patched reference bundle. Live database/provider responses, current-source compatibility and deployed orchestrator prose require verification in your environment.
