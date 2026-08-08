<#
.SYNOPSIS
  Check upstream for new commits since last sync date.
.DESCRIPTION
  Date-wise sync system. Shows ONLY commits after lastSyncDate.
  Previously skipped commits never appear again.
.EXAMPLE
  ./scripts/upstream-check.ps1
#>

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$StateFile = Join-Path $RepoRoot ".upstream\STATE.json"
$UpstreamUrl = "https://github.com/Zoo-Code-Org/Zoo-Code.git"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  UPSTREAM CHECK - Date-wise Sync" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Ensure upstream remote
$Remotes = git remote -v 2>&1
if ($Remotes -notmatch "upstream") {
    Write-Host "[+] Adding upstream remote..." -ForegroundColor Yellow
    git remote add upstream $UpstreamUrl 2>&1 | Out-Null
}

# Fetch
Write-Host "[~] Fetching upstream..." -ForegroundColor Cyan
git fetch upstream main 2>&1 | ForEach-Object { "   $_" }

# Read or create state
if (-not (Test-Path $StateFile)) {
    Write-Host "[!] STATE.json not found. Creating..." -ForegroundColor Yellow
    $State = @{
        lastSyncDate    = "2026-06-17T00:00:00Z"
        lastSyncCommit  = ""
        lastCheckedDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        upstreamHead    = ""
        note            = "Date-wise sync. lastSyncDate = all commits before this date are done."
    }
    $State | ConvertTo-Json | Set-Content $StateFile
}

$State = Get-Content $StateFile | ConvertFrom-Json
$LastSyncDate = $State.lastSyncDate
$UpstreamHead = (git rev-parse upstream/main 2>&1).Trim()
$UpstreamHeadShort = $UpstreamHead.Substring(0, 9)

Write-Host ""
Write-Host "Last synced up to : $LastSyncDate" -ForegroundColor Gray
Write-Host "Upstream HEAD     : $UpstreamHeadShort" -ForegroundColor Gray
Write-Host ""

# Get commits AFTER lastSyncDate
if ($LastSyncDate) {
    $Commits = git log upstream/main --after="$LastSyncDate" --format="%H %ci %s" 2>&1
} else {
    $Commits = git log upstream/main -30 --format="%H %ci %s" 2>&1
}

# Filter
$CommitLines = @()
if ($Commits -is [array]) {
    $CommitLines = $Commits | Where-Object { $_ -and $_ -notmatch "^fatal" -and $_ -notmatch "^error" -and $_.Trim() -ne "" }
} elseif ($Commits -and $Commits -notmatch "^fatal") {
    $CommitLines = @($Commits)
}

$Count = $CommitLines.Count

Write-Host "[REPORT]" -ForegroundColor Cyan
if ($Count -gt 0) {
    Write-Host "   New commits since $LastSyncDate : $Count" -ForegroundColor Yellow
} else {
    Write-Host "   New commits since $LastSyncDate : 0" -ForegroundColor Green
}

if ($Count -gt 0) {
    Write-Host ""
    Write-Host "--- New Commits ---" -ForegroundColor Gray
    $i = 0
    foreach ($Line in $CommitLines) {
        $i++
        $Parts = $Line -split ' ', 4
        $Sha = $Parts[0].Substring(0, 9)
        $Date = "$($Parts[1]) $($Parts[2])"
        $Msg = if ($Parts.Length -gt 3) { $Parts[3] } else { "" }
        Write-Host "   $i. [$Sha] $Date - $Msg" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "To sync: run ./scripts/upstream-import.ps1" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[OK] No new commits. Fork is up-to-date." -ForegroundColor Green
}

# Update lastCheckedDate
$State.lastCheckedDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
$State.upstreamHead = $UpstreamHeadShort
$State | ConvertTo-Json | Set-Content $StateFile

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
