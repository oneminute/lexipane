param(
    [switch]$Update,
    [switch]$Web,
    [switch]$SkipInstall,
    [switch]$Bootstrap
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

function Add-CargoToCurrentPath {
    $CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

    if ((Test-Path $CargoBin) -and
        -not (($env:PATH -split ";") -contains $CargoBin)) {
        $env:PATH = "$CargoBin;$env:PATH"
    }
}

function Ensure-RustToolchain {
    Add-CargoToCurrentPath

    if ((Get-Command cargo -ErrorAction SilentlyContinue) -and
        (Get-Command rustc -ErrorAction SilentlyContinue)) {
        return
    }

    if (-not $Bootstrap) {
        Fail @"
Rust/Cargo was not found.

LexiPane desktop mode requires the Rust toolchain because Tauri has a Rust backend.

Run this once from PowerShell:

    .\start-lexipane.cmd -Bootstrap

The launcher will install Rust through Windows Package Manager when available.

If you prefer to install Rust manually, install rustup from:
    https://rustup.rs

Then open a NEW PowerShell window and run:
    cargo --version
    rustc --version
    .\start-lexipane.cmd
"@
    }

    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $Winget) {
        Fail @"
Rust/Cargo is missing and Windows Package Manager (winget) was not found.

Install Rust manually from https://rustup.rs, then open a NEW PowerShell
window and run .\start-lexipane.cmd again.
"@
    }

    Write-Step "Installing Rust toolchain with rustup"

    $WingetArgs = @(
        "install",
        "--id", "Rustlang.Rustup",
        "-e",
        "--source", "winget",
        "--accept-source-agreements",
        "--accept-package-agreements"
    )

    & winget @WingetArgs

    if ($LASTEXITCODE -ne 0) {
        Fail "Rust installation failed with exit code $LASTEXITCODE."
    }

    Add-CargoToCurrentPath

    if (Get-Command rustup -ErrorAction SilentlyContinue) {
        Write-Step "Ensuring the stable Rust toolchain is installed"
        & rustup default stable
        if ($LASTEXITCODE -ne 0) {
            Fail "rustup could not configure the stable Rust toolchain."
        }
    }

    Add-CargoToCurrentPath

    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Fail @"
Rustup finished, but Cargo is not visible in this PowerShell process.

Close this window, open a NEW PowerShell window, then run:
    cd "$ProjectRoot"
    .\start-lexipane.cmd

Cargo is normally installed under:
    $env:USERPROFILE\.cargo\bin
"@
    }
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

if (-not $Web) {
    Ensure-RustToolchain

    $CargoVersion = (& cargo --version).Trim()
    $RustVersion = (& rustc --version).Trim()
    Write-Host "cargo: $CargoVersion"
    Write-Host "rustc: $RustVersion"

    Write-Step "Checking Tauri Rust workspace"
    & cargo metadata --manifest-path "src-tauri\Cargo.toml" --no-deps --format-version 1 *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail @"
Cargo is installed, but the Tauri Rust workspace could not be read.

Try:
    cargo metadata --manifest-path src-tauri\Cargo.toml --no-deps --format-version 1

If the error mentions MSVC, linker.exe, or Visual Studio Build Tools,
install "Desktop development with C++" from Visual Studio Build Tools.
"@
    }
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
