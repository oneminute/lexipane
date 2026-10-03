param(
    [switch]$Update,
    [switch]$Web,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "LexiPane Development Launcher" -ForegroundColor Magenta
Write-Host "Project: $ProjectRoot"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js was not found. Install Node.js 22 LTS or newer, then run this launcher again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm was not found. Reinstall Node.js with npm enabled."
}

$NodeVersion = (& node --version).Trim()
$NpmVersion = (& npm --version).Trim()
Write-Host "Node: $NodeVersion"
Write-Host "npm : $NpmVersion"

$MajorText = $NodeVersion.TrimStart("v").Split(".")[0]
$NodeMajor = 0
if (-not [int]::TryParse($MajorText, [ref]$NodeMajor)) {
    Fail "Could not determine the installed Node.js version."
}

if ($NodeMajor -lt 22) {
    Fail "LexiPane currently expects Node.js 22 or newer. Installed: $NodeVersion"
}

if (-not (Test-Path "package.json")) {
    Fail "package.json was not found in $ProjectRoot"
}

if (-not $SkipInstall) {
    Write-Step "Synchronizing npm dependencies"

    # npm install is intentionally used instead of npm ci here:
    # - first launch installs everything automatically;
    # - later launches bring node_modules in sync with package.json/package-lock.json;
    # - semver-compatible dependency updates can be recorded in package-lock.json.
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Fail "npm install failed with exit code $LASTEXITCODE."
    }

    if ($Update) {
        Write-Step "Updating dependencies within the versions allowed by package.json"
        & npm update --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Fail "npm update failed with exit code $LASTEXITCODE."
        }
    }
}
else {
    Write-Step "Skipping npm dependency synchronization"
}

if ($Web) {
    Write-Step "Starting LexiPane in browser development mode"
    & npm run dev
}
else {
    Write-Step "Starting LexiPane desktop application"
    & npm run tauri dev
}

if ($LASTEXITCODE -ne 0) {
    Fail "LexiPane exited with code $LASTEXITCODE."
}
