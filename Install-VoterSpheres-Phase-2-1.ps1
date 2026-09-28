param([switch]$Apply)

 

$ErrorActionPreference = "Stop"

$repositoryRoot = (Get-Location).Path

$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

 

if (-not (Test-Path (Join-Path $repositoryRoot "package.json"))) {

  throw "Run this script from the VoterSpheres backend repository root."

}

 

$gitDirectory = Join-Path $repositoryRoot ".git"

if ((Test-Path (Join-Path $gitDirectory "MERGE_HEAD")) -or

    (Test-Path (Join-Path $gitDirectory "rebase-merge")) -or

    (Test-Path (Join-Path $gitDirectory "rebase-apply"))) {

  throw "A Git merge or rebase is in progress. Complete it before installing Phase 2.1.1."

}

 

$payload = @(

  "services\pollingCycleDiagnostic.service.js",

  "scripts\diagnosePollingElectionCycles.mjs",

  "tests\pollingCycleDiagnostic.contract.test.mjs"

)

 

Write-Host "VoterSpheres Phase 2.1.1 polling-cycle diagnostic correction"

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

$backupRoot = Join-Path $repositoryRoot "backups\phase-2-1-1-polling-cycle-$stamp"

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

 

& npm pkg set "scripts.diagnose:polling-cycles=node scripts/diagnosePollingElectionCycles.mjs"

& npm pkg set "scripts.test:polling-cycle-diagnostics=node --test tests/pollingCycleDiagnostic.contract.test.mjs"

 

Write-Host "Phase 2.1.1 installed. Backup: $backupRoot"

Write-Host "This correction is diagnostic-only and does not update polling_results."

Write-Host "Next: npm run check:syntax"

Write-Host "Next: npm run test:polling-cycle-diagnostics"

Write-Host "Next: npm run test:election-cycles"

Write-Host "Next: npm run test:cycle-isolation"

Write-Host "Next: npm run test:tenant-isolation"

Write-Host "Next: npm run diagnose:polling-cycles -- --output=.\diagnostics\polling-cycles"
