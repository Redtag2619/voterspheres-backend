param([switch]$Apply)

 

$ErrorActionPreference = "Stop"

$repositoryRoot = (Get-Location).Path

$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

 

if (-not (Test-Path (Join-Path $repositoryRoot "package.json"))) {

  throw "Run this installer from the VoterSpheres backend repository root."

}

 

$gitDirectory = Join-Path $repositoryRoot ".git"

if ((Test-Path (Join-Path $gitDirectory "MERGE_HEAD")) -or

    (Test-Path (Join-Path $gitDirectory "rebase-merge")) -or

    (Test-Path (Join-Path $gitDirectory "rebase-apply"))) {

  throw "A Git merge or rebase is in progress. Complete it before installing Phase 2.2."

}

 

$requiredBaseline = @(

  "services\pollingCycleDiagnostic.service.js",

  "scripts\diagnosePollingElectionCycles.mjs",

  "utils\electionCycle.js"

)

foreach ($relativePath in $requiredBaseline) {

  if (-not (Test-Path (Join-Path $repositoryRoot $relativePath))) {

    throw "Required Phase 2.1.1 baseline file is missing: $relativePath"

  }

}

 

$payload = @(

  "db\migrations\20260928_build_7_4_polling_cycle_remediation.sql",

  "services\pollingCycleRemediation.service.js",

  "scripts\remediatePollingCycles.mjs",

  "scripts\rollbackPollingCycleRemediation.mjs",

  "tests\pollingCycleRemediation.contract.test.mjs"

)

 

Write-Host "VoterSpheres Phase 2.2 controlled polling-cycle remediation"

Write-Host "Repository: $repositoryRoot"

Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'PREVIEW' })"

foreach ($relativePath in $payload) {

  if (-not (Test-Path (Join-Path $installerRoot $relativePath))) {

    throw "Installer payload is missing: $relativePath"

  }

  Write-Host "  $relativePath"

}

 

if (-not $Apply) {

  Write-Host "Preview complete. Re-run with -Apply to install."

  exit 0

}

 

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

$backupRoot = Join-Path $repositoryRoot "backups\phase-2-2-polling-remediation-$stamp"

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

 

foreach ($relativePath in $payload) {

  $source = Join-Path $installerRoot $relativePath

  $destination = Join-Path $repositoryRoot $relativePath

  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null

  if (Test-Path $destination) {

    $backup = Join-Path $backupRoot $relativePath

    New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null

    Copy-Item $destination $backup -Force

  }

  Copy-Item $source $destination -Force

}

 

& npm pkg set "scripts.test:polling-cycle-remediation=node --test tests/pollingCycleRemediation.contract.test.mjs"

& npm pkg set "scripts.remediate:polling-cycles=node scripts/remediatePollingCycles.mjs"

& npm pkg set "scripts.rollback:polling-cycles=node scripts/rollbackPollingCycleRemediation.mjs"

 

Write-Host "Phase 2.2 installed. Backup: $backupRoot"

Write-Host "No polling records were changed by this installer."

Write-Host "Next: npm run check:syntax"

Write-Host "Next: npm run test:polling-cycle-remediation"

Write-Host "Next: npm run test:polling-cycle-diagnostics"

Write-Host "Next: npm run db:migrate"

Write-Host "Then run remediation in preview mode only."
