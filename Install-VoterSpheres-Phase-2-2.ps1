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

  throw "A Git merge or rebase is in progress. Complete it before installing Phase 2.2.1."

}

 

$payload = @(

  "services\pollingCycleDiagnostic.service.js",

  "tests\pollingCycleDiagnostic.contract.test.mjs"

)

 

Write-Host "VoterSpheres Phase 2.2.1 sequential database query correction"

Write-Host "Repository: $repositoryRoot"

Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'PREVIEW' })"

 

foreach ($relativePath in $payload) {

  $source = Join-Path $installerRoot $relativePath

  $destination = Join-Path $repositoryRoot $relativePath

 

  if (-not (Test-Path $source)) {

    throw "Installer payload is missing: $relativePath"

  }

  if (-not (Test-Path $destination)) {

    throw "Expected backend file is missing: $relativePath"

  }

 

  Write-Host "  $relativePath"

}

 

if (-not $Apply) {

  Write-Host "Preview complete. Re-run with -Apply to install."

  exit 0

}

 

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

$backupRoot = Join-Path $repositoryRoot "backups\phase-2-2-1-sequential-queries-$stamp"

 

foreach ($relativePath in $payload) {

  $source = Join-Path $installerRoot $relativePath

  $destination = Join-Path $repositoryRoot $relativePath

  $backup = Join-Path $backupRoot $relativePath

 

  New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null

  Copy-Item $destination $backup -Force

  Copy-Item $source $destination -Force

}

 

Write-Host "Phase 2.2.1 installed. Backup: $backupRoot"

Write-Host "No migration ran and no polling records were changed."

Write-Host "Do not rerun the Phase 2.2 remediation."

Write-Host "Next: npm run check:syntax"

Write-Host "Next: npm run test:polling-cycle-diagnostics"

Write-Host "Next: npm run test:polling-cycle-remediation"

Write-Host "Next: git diff --check"

