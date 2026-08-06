<#
.SYNOPSIS
  Check upstream (Zoo-Code-Org/Zoo-Code) for new changes
.DESCRIPTION
  Fetches upstream commits since last check and logs them in .upstream/STATE.json
  This is the READ-ONLY check step. No merging is done automatically.
.EXAMPLE
  ./scripts/upstream-check.ps1
  ./scripts/upstream-check.ps1 -UpdateState $false
#>

param(
    [bool]$UpdateState = $true
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$UpstreamDir = Join-Path $RepoRoot ".upstream"
$StateFile = Join-Path $UpstreamDir "STATE.json"
$UpstreamUrl = "https://github.com/Zoo-Code-Org/Zoo-Code.git"

$Cyan = "Cyan"
$Green = "Green"
$Yellow = "Yellow"
$Gray = "Gray"
$Red = "Red"
$White = "White"

Write-Host "========================================" -ForegroundColor $Cyan
Write-Host "  UPSTREAM CHECK - Zoo-Code-Org/Zoo-Code" -ForegroundColor $Cyan
Write-Host "========================================" -ForegroundColor $Cyan

# Ensure upstream remote exists
$Remotes = git remote -v 2>&1
if ($Remotes -notmatch "upstream") {
    Write-Host "[+] Adding upstream remote..." -ForegroundColor $Yellow
    git remote add upstream $UpstreamUrl 2>&1 | Out-Null
} else {
    Write-Host "[+] Upstream remote already exists" -ForegroundColor $Green
}

# Fetch upstream (no merge, no rebase -- just fetch)
Write-Host "[~] Fetching upstream..." -ForegroundColor $Cyan
git fetch upstream --no-tags 2>&1 | ForEach-Object { "   $_" }

# Get the state
$State = Get-Content $StateFile | ConvertFrom-Json

$LastFetched = $State.lastFetchedCommit
$UpstreamHead = (git rev-parse upstream/main 2>&1).Trim()
$UpstreamHeadShort = $UpstreamHead.Substring(0, 9)

# Count new commits since last fetch
$LogRange = if ($LastFetched) { "$LastFetched..$UpstreamHead" } else { "HEAD..$UpstreamHead" }
$NewCommits = git log --oneline $LogRange 2>&1
$NewCommitCount = 0
if ($NewCommits -is [array]) { $NewCommitCount = $NewCommits.Length }
elseif ($NewCommits) { $NewCommitCount = 1 }
else { $NewCommitCount = 0 }

$Color = if ($NewCommitCount -gt 0) { $Yellow } else { $Green }

Write-Host "[REPORT]" -ForegroundColor $Cyan
Write-Host "   Last fetched commit : $LastFetched" -ForegroundColor $Gray
Write-Host "   Upstream HEAD       : $UpstreamHeadShort" -ForegroundColor $Gray
Write-Host "   New upstream commits: $NewCommitCount" -ForegroundColor $Color

if ($NewCommitCount -gt 0 -and $NewCommitCount -lt 500) {
    Write-Host "[LIST] New upstream commits:" -ForegroundColor $Cyan
    $CommitsList = @()
    if ($NewCommits -is [array]) { $CommitsList = $NewCommits }
    else { $CommitsList = @($NewCommits) }
    $CommitsList | ForEach-Object { Write-Host "   [NEW] $_" -ForegroundColor $Yellow }

    # Categorize commits
    $PendingList = @()
    $AlreadyOursList = @()
    foreach ($Line in $CommitsList) {
        $Sha = ($Line -split ' ')[0]
        $Message = ($Line -replace '^[a-f0-9]+\s*', '')

        $InFork = git cat-file -e "$Sha" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $AlreadyOursList += @{ sha = $Sha; message = $Message }
        } else {
            $PendingList += @{ sha = $Sha; message = $Message }
        }
    }

    Write-Host "[ANALYSIS]" -ForegroundColor $Cyan
    Write-Host "   Pending (not in fork) : $($PendingList.Count)" -ForegroundColor $Yellow
    Write-Host "   Already in fork       : $($AlreadyOursList.Count)" -ForegroundColor $Green

    if ($PendingList.Count -gt 0) {
        Write-Host "   Pending commits:" -ForegroundColor $Yellow
        foreach ($C in $PendingList) {
            $ShortSha = $C.sha.Substring(0, 9)
            Write-Host "      [PENDING] $ShortSha - $($C.message)" -ForegroundColor $Yellow
        }
    }

    if ($UpdateState) {
        if ($State.pendingCommits -isnot [array]) { $State.pendingCommits = @() }
        if ($State.skippedCommits -isnot [array]) { $State.skippedCommits = @() }
        if ($State.importedCommits -isnot [array]) { $State.importedCommits = @() }

        foreach ($C in $PendingList) {
            $AlreadyPending = $State.pendingCommits | Where-Object { $_.sha -eq $C.sha }
            if (-not $AlreadyPending) {
                $State.pendingCommits += @{
                    sha = $C.sha
                    message = $C.message
                    discoveredAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
                    status = "pending"
                }
            }
        }

        $State.lastFetchedCommit = $UpstreamHead
        $State.lastFetchedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        $State.lastFetchedMessage = ($CommitsList[-1] -replace '^[a-f0-9]+\s*', '')
        $State.upstreamHead = $UpstreamHead
        $State.upstreamHeadAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

        $State | ConvertTo-Json -Depth 5 | Set-Content $StateFile
        Write-Host "[OK] STATE.json updated" -ForegroundColor $Green
    }
} elseif ($NewCommitCount -ge 500) {
    Write-Host "[WARN] Many new commits ($NewCommitCount) - consider a full fetch" -ForegroundColor $Yellow
} else {
    Write-Host "[OK] No new commits since last check. Fork is up-to-date." -ForegroundColor $Green
}

Write-Host "========================================" -ForegroundColor $Cyan
Write-Host "  NEXT STEPS" -ForegroundColor $Cyan
Write-Host "========================================" -ForegroundColor $Cyan
Write-Host "   Review pending commits : .upstream/STATE.json" -ForegroundColor $White
Write-Host "   Cherry-pick manually   : git cherry-pick <SHA>" -ForegroundColor $White
Write-Host "   Mark as imported       : scripts/upstream-import.ps1 <SHA>" -ForegroundColor $White
Write-Host "   Mark as skipped        : scripts/upstream-skip.ps1 <SHA> <reason>" -ForegroundColor $White
