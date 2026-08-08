<#
.SYNOPSIS
  Mark upstream sync point - updates lastSyncDate in STATE.json.
.DESCRIPTION
  After reviewing commits with upstream-check.ps1 and deciding what to keep,
  run this script to advance the sync date. Prevents those commits from
  appearing in future checks.
  
  Does NOT merge or cherry-pick. Only updates the date marker.
.EXAMPLE
  ./scripts/upstream-import.ps1
#>

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$StateFile = Join-Path $RepoRoot ".upstream\STATE.json"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  UPSTREAM IMPORT - Advance Sync Date" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $StateFile)) {
    Write-Host "[!] STATE.json not found. Run upstream-check.ps1 first." -ForegroundColor Yellow
    exit 1
}

$State = Get-Content $StateFile | ConvertFrom-Json
$OldDate = $State.lastSyncDate
$UpstreamHead = (git rev-parse upstream/main 2>&1).Trim()
$UpstreamHeadShort = $UpstreamHead.Substring(0, 9)
$Now = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

Write-Host ""
Write-Host "Previous sync date : $OldDate" -ForegroundColor Yellow
Write-Host "New sync date      : $Now" -ForegroundColor Green
Write-Host "Upstream HEAD      : $UpstreamHeadShort" -ForegroundColor Green
Write-Host ""

$State.lastSyncDate = $Now
$State.lastSyncCommit = $UpstreamHeadShort
$State.lastCheckedDate = $Now
$State.upstreamHead = $UpstreamHeadShort

$State | ConvertTo-Json | Set-Content $StateFile

Write-Host "[OK] STATE.json updated. Sync date advanced to: $Now" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "   1. git add .upstream/STATE.json" -ForegroundColor White
Write-Host "   2. git commit -m 'chore: upstream sync up to $UpstreamHeadShort'" -ForegroundColor White
Write-Host "   3. git push origin integration" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
