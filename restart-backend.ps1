$ErrorActionPreference = "Stop"

Set-Location "C:\Users\sas26\voterspheres-backend"

Write-Host ""
Write-Host "=== VoterSpheres Backend Restart ===" -ForegroundColor Cyan

Write-Host "Checking port 10000..." -ForegroundColor Yellow
$connections = netstat -ano | findstr :10000

if ($connections) {
  Write-Host "Existing process found on port 10000. Stopping it..." -ForegroundColor Yellow

  $pids = @()

  $connections | ForEach-Object {
    $parts = ($_ -split '\s+') | Where-Object { $_ -ne '' }
    if ($parts.Length -gt 0) {
      $pid = $parts[-1]
      if ($pid -match '^\d+$') {
        $pids += $pid
      }
    }
  }

  $pids = $pids | Sort-Object -Unique

  foreach ($pid in $pids) {
    try {
      taskkill /PID $pid /F | Out-Null
      Write-Host "Stopped PID $pid" -ForegroundColor Green
    } catch {
      Write-Host "Could not stop PID $pid (it may already be gone)." -ForegroundColor DarkYellow
    }
  }

  Start-Sleep -Seconds 1
} else {
  Write-Host "Port 10000 is already free." -ForegroundColor Green
}

Write-Host "Starting backend..." -ForegroundColor Yellow
$job = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "Set-Location 'C:\Users\sas26\voterspheres-backend'; node .\index.js" `
  -PassThru

Write-Host "Started backend in new PowerShell window. PID: $($job.Id)" -ForegroundColor Green
Start-Sleep -Seconds 3

Write-Host "Checking health endpoint..." -ForegroundColor Yellow
try {
  $health = Invoke-WebRequest "http://127.0.0.1:10000/health" -UseBasicParsing
  Write-Host "Backend is healthy: $($health.StatusCode) $($health.StatusDescription)" -ForegroundColor Green
} catch {
  Write-Host "Health check failed. The backend window may show the startup error." -ForegroundColor Red
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
