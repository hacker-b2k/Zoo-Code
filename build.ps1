<#
.SYNOPSIS
    Full build pipeline: install, type-check, test, and package VSIX.

.DESCRIPTION
    Runs the complete build process for Zoo-Code:
    1. Check prerequisites (node, pnpm, git)
    2. Install dependencies (pnpm install)
    3. TypeScript type-check
    4. Unit tests
    5. VSIX packaging
    6. Artifact verification (path, size, SHA-256)

    Stops on first failure with a clear error message.

.EXAMPLE
    .\build.ps1                          # Full pipeline
    .\build.ps1 -SkipTests               # Skip tests
    .\build.ps1 -OnlyVsix                # Just build VSIX (skip types + tests)
    .\build.ps1 -SkipInstall             # Skip pnpm install (already installed)
#>

param(
    [switch]$SkipTypes,
    [switch]$SkipTests,
    [switch]$SkipVsix,
    [switch]$SkipInstall,
    [switch]$OnlyVsix,
    [int]$TimeoutSec = 600
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# OnlyVsix shorthand
if ($OnlyVsix) {
    $SkipTypes = $true
    $SkipTests = $true
    $SkipInstall = $true
}

function Write-Step($step, $msg) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  [$step] $msg" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Invoke-BuildStep {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Step $global:stepCounter $Name
    $global:stepCounter++

    try {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
        $sw.Stop()
        Write-Host "`n[OK] $Name completed in $([math]::Round($sw.Elapsed.TotalSeconds, 1))s" -ForegroundColor Green
    }
    catch {
        $sw.Stop()
        Write-Host "`n[FAIL] $Name failed after $([math]::Round($sw.Elapsed.TotalSeconds, 1))s" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

# --- Main ---

Write-Host "Zoo-Code Build Pipeline" -ForegroundColor Yellow
Write-Host "Working directory: $scriptDir`n" -ForegroundColor DarkGray

Push-Location $scriptDir

try {
    $global:stepCounter = 1

    # 0. Prerequisites
    Invoke-BuildStep "Check Prerequisites" {
        $nodeVer = & node --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Node.js not found. Install Node.js 20.x" }
        Write-Host "  Node.js: $nodeVer" -ForegroundColor DarkGray

        $pnpmVer = & pnpm --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  pnpm not found, enabling via corepack..." -ForegroundColor DarkYellow
            & corepack enable 2>&1
            $pnpmVer = & pnpm --version 2>&1
            if ($LASTEXITCODE -ne 0) { throw "pnpm not available. Run: corepack enable" }
        }
        Write-Host "  pnpm: $pnpmVer" -ForegroundColor DarkGray

        $gitVer = & git --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Git not found" }
        Write-Host "  Git: $gitVer" -ForegroundColor DarkGray
    }

    # 1. Install dependencies
    if (-not $SkipInstall) {
        Invoke-BuildStep "Install Dependencies" {
            & pnpm install --frozen-lockfile
        }
    } else {
        Write-Host "[SKIP] Install dependencies" -ForegroundColor DarkYellow
    }

    # 2. Type-check
    if (-not $SkipTypes) {
        Invoke-BuildStep "TypeScript Type-Check" {
            Push-Location src
            try { & pnpm run check-types }
            finally { Pop-Location }
        }
    } else {
        Write-Host "[SKIP] TypeScript type-check" -ForegroundColor DarkYellow
    }

    # 3. Tests
    if (-not $SkipTests) {
        Invoke-BuildStep "Unit Tests" {
            & pnpm test
        }
    } else {
        Write-Host "[SKIP] Unit tests" -ForegroundColor DarkYellow
    }

    # 4. VSIX
    if (-not $SkipVsix) {
        Invoke-BuildStep "VSIX Packaging" {
            & pnpm vsix
        }
    } else {
        Write-Host "[SKIP] VSIX packaging" -ForegroundColor DarkYellow
    }

    # Done
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "  BUILD COMPLETE" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green

    if (-not $SkipVsix) {
        $vsix = Get-ChildItem -Path "bin\*.vsix" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($vsix) {
            $sizeMB = [math]::Round($vsix.Length / 1MB, 2)
            $hash = (Get-FileHash -Path $vsix.FullName -Algorithm SHA256).Hash
            Write-Host "`nArtifact Details:" -ForegroundColor Green
            Write-Host "  Path:   $($vsix.FullName)" -ForegroundColor White
            Write-Host "  Size:   $($vsix.Length) bytes ($sizeMB MB)" -ForegroundColor White
            Write-Host "  SHA256: $hash" -ForegroundColor White
        } else {
            Write-Host "`n[WARN] No VSIX found in bin/" -ForegroundColor DarkYellow
        }
    }
}
finally {
    Pop-Location
}
