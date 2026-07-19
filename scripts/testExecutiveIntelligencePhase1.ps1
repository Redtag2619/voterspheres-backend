param(
  [string]$BaseUrl = "http://localhost:10000/api",
  [Parameter(Mandatory = $true)][string]$Token
)

$headers = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }

Write-Host "Checking Build 4 config..." -ForegroundColor Cyan
Invoke-RestMethod -Method Get -Uri "$BaseUrl/executive-intelligence-orchestrator/config" -Headers $headers | ConvertTo-Json -Depth 8

$body = @{
  question = "What are the most important political developments in Georgia?"
  state = "GA"
  workspace_id = 1
  limit = 12
} | ConvertTo-Json

Write-Host "Running Build 4 briefing..." -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "$BaseUrl/executive-intelligence-orchestrator/brief" -Headers $headers -Body $body | ConvertTo-Json -Depth 15
