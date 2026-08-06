<#
.SYNOPSIS
    Full build pipeline: type-check, test, and package VSIX.

.DESCRIPTION
    Runs the complete build process for Zoo-Code:
    1. TypeScript type-check across all packages
    2. Unit tests via turbo
    3. VSIX packaging

    Stops on first failure with a clear error message.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -SkipTests
    .\build.ps1 -SkipTypes
#>

param(
    [switch]$SkipTypes,
    [switch]$SkipTests,
    [switch]$SkipVsix,
    [int]$TimeoutSec = 300
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

    # 1. Type-check
    if (-not $SkipTypes) {
        Invoke-BuildStep "TypeScript Type-Check" {
            pnpm check-types
        }
    } else {
        Write-Host "[SKIP] TypeScript type-check" -ForegroundColor DarkYellow
    }

    # 2. Tests
    if (-not $SkipTests) {
        Invoke-BuildStep "Unit Tests" {
            pnpm test
        }
    } else {
        Write-Host "[SKIP] Unit tests" -ForegroundColor DarkYellow
    }

    # 3. VSIX
    if (-not $SkipVsix) {
        Invoke-BuildStep "VSIX Packaging" {
            pnpm vsix
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
            Write-Host "`nOutput: bin\$($vsix.Name) ($sizeMB MB)" -ForegroundColor Green
        }
    }
}
finally {
    Pop-Location
}