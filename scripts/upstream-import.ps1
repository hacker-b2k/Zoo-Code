<#
.SYNOPSIS
  Cherry-pick a specific upstream commit into our fork
.DESCRIPTION
  Stage 2 of the upstream sync system: cherry-pick a specific commit
  and mark it as imported in STATE.json
.PARAMETER Sha
  The full SHA of the upstream commit to cherry-pick
.EXAMPLE
  ./scripts/upstream-import.ps1 abc123def456
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Sha
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$UpstreamDir = Join-Path $RepoRoot ".upstream"
$StateFile = Join-Path $UpstreamDir "STATE.json"

$Cyan = "Cyan"
$Green = "Green"
$Yellow = "Yellow"
$Gray = "Gray"
$Red = "Red"
$White = "White"

if ($Sha.Length -lt 7) {
    Write-Host "[ERR] SHA too short. Provide at least 7 characters." -ForegroundColor $Red
    exit 1
}

# Resolve full SHA
$FullSha = git rev-parse "$Sha^{commit}" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] Commit $Sha not found. Did you run 'pnpm upstream:check' first?" -ForegroundColor $Red
    exit 1
}

Write-Host "[INFO] Commit details:" -ForegroundColor $Cyan
git log --oneline -1 $FullSha 2>&1 | ForEach-Object { Write-Host "   $_" -ForegroundColor $Yellow }
$CommitMsg = git log --format="%s" -1 $FullSha 2>&1
$AuthorDate = git log --format="%ai" -1 $FullSha 2>&1

Write-Host "   Author date: $AuthorDate" -ForegroundColor $Gray

# Check if already imported
$State = Get-Content $StateFile | ConvertFrom-Json
$AlreadyImported = $State.importedCommits | Where-Object { $_.sha -eq $FullSha }
if ($AlreadyImported) {
    Write-Host "[WARN] Commit $($FullSha.Substring(0,9)) is already imported!" -ForegroundColor $Red
    exit 0
}

# Do the cherry-pick
Write-Host "[ACT] Cherry-picking $($FullSha.Substring(0,9))..." -ForegroundColor $Cyan
$PickResult = git cherry-pick $FullSha 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Cherry-pick had conflicts!" -ForegroundColor $Yellow
    Write-Host "   Fix conflicts manually, then run:" -ForegroundColor $White
    Write-Host "   git add <files> ; git cherry-pick --continue" -ForegroundColor $White
    Write-Host "   Then mark as imported:" -ForegroundColor $White
    Write-Host "   ./scripts/upstream-import.ps1 $FullSha" -ForegroundColor $White
    exit 1
}

# Mark as imported in state
$ImportRecord = @{
    sha = $FullSha
    message = $CommitMsg
    authorDate = $AuthorDate
    importedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    status = "imported"
}

$State.importedCommits += $ImportRecord

# Remove from pending if present
$State.pendingCommits = @($State.pendingCommits | Where-Object { $_.sha -ne $FullSha })

# Update last sync info
$State.lastSyncCommit = $FullSha
$State.lastSyncAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

$State | ConvertTo-Json -Depth 5 | Set-Content $StateFile

Write-Host "[OK] Successfully imported $($FullSha.Substring(0,9))" -ForegroundColor $Green
Write-Host "   Marked as IMPORTED in STATE.json" -ForegroundColor $Green
