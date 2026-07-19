param(
  [string]$BaseUrl = "http://127.0.0.1:10000/api",
  [string]$Token = "",
  [string]$Question = "What is the latest verified political intelligence about Donald Trump?",
  [int]$WorkspaceId = 1
)

$headers = @{ "Content-Type" = "application/json" }
if ($Token) { $headers.Authorization = "Bearer $Token" }

Write-Host "`n1. Checking orchestrator configuration..." -ForegroundColor Cyan
Invoke-RestMethod -Method Get `
  -Uri "$BaseUrl/executive-intelligence-orchestrator/config" `
  -Headers $headers | ConvertTo-Json -Depth 20

$body = @{
  question = $Question
  workspace_id = $WorkspaceId
  limit = 10
} | ConvertTo-Json

Write-Host "`n2. Inspecting tool plan..." -ForegroundColor Cyan
Invoke-RestMethod -Method Post `
  -Uri "$BaseUrl/executive-intelligence-orchestrator/plan" `
  -Headers $headers `
  -Body $body | ConvertTo-Json -Depth 30

Write-Host "`n3. Running complete executive intelligence brief..." -ForegroundColor Cyan
Invoke-RestMethod -Method Post `
  -Uri "$BaseUrl/executive-intelligence-orchestrator/brief" `
  -Headers $headers `
  -Body $body | ConvertTo-Json -Depth 50

