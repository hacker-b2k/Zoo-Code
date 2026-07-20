<#
.SYNOPSIS
  Mark an upstream commit as SKIPPED (not importing)
.DESCRIPTION
  Stage for commits we deliberately choose NOT to import.
  Marks the commit in STATE.json with a reason.
.PARAMETER Sha
  The full SHA of the upstream commit to skip
.PARAMETER Reason
  Why we're skipping this commit
.EXAMPLE
  ./scripts/upstream-skip.ps1 abc123def456 "Only relevant for original repo's CI setup"
  ./scripts/upstream-skip.ps1 abc123def456 -Reason "Not applicable to our fork"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Sha,
    [Parameter(Mandatory=$true)]
    [string]$Reason
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$UpstreamDir = Join-Path $RepoRoot ".upstream"
$StateFile = Join-Path $UpstreamDir "STATE.json"

$Cyan = "Cyan"
$Green = "Green"
$Yellow = "Yellow"
$Gray = "Gray"
$Red = "Red"

if ($Sha.Length -lt 7) {
    Write-Host "[ERR] SHA too short. Provide at least 7 characters." -ForegroundColor $Red
    exit 1
}

$FullSha = git rev-parse "$Sha^{commit}" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] Commit $Sha not found in local history." -ForegroundColor $Red
    exit 1
}

$State = Get-Content $StateFile | ConvertFrom-Json

# Check if already skipped
$AlreadySkipped = $State.skippedCommits | Where-Object { $_.sha -eq $FullSha }
if ($AlreadySkipped) {
    Write-Host "[WARN] Already skipped. Updating reason..." -ForegroundColor $Yellow
    $State.skippedCommits = @($State.skippedCommits | Where-Object { $_.sha -ne $FullSha })
}

$SkipRecord = @{
    sha = $FullSha
    message = (git log --format="%s" -1 $FullSha 2>&1)
    reason = $Reason
    skippedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    status = "skipped"
}

$State.skippedCommits += $SkipRecord

# Remove from pending
$State.pendingCommits = @($State.pendingCommits | Where-Object { $_.sha -ne $FullSha })

$State | ConvertTo-Json -Depth 5 | Set-Content $StateFile

Write-Host "[OK] Marked $($FullSha.Substring(0,9)) as SKIPPED" -ForegroundColor $Yellow
Write-Host "   Reason: $Reason" -ForegroundColor $Gray
