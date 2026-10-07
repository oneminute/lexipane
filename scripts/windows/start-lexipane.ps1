param(
    [switch]$Update,
    [switch]$Web,
    [switch]$SkipInstall,
    [switch]$Bootstrap,
    [switch]$Ocr
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


function Get-TesseractExecutable {
    $Command = Get-Command tesseract -ErrorAction SilentlyContinue
    if ($Command) {
        return $Command.Source
    }

    $Candidates = @(
        "C:\Program Files\Tesseract-OCR\tesseract.exe",
        "C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
    )

    foreach ($Candidate in $Candidates) {
        if (Test-Path $Candidate) {
            return $Candidate
        }
    }

    return $null
}

function Ensure-LocalOcr {
    $Executable = Get-TesseractExecutable

    if ($Executable) {
        Write-Host "OCR : $Executable"
        return
    }

    if (-not $Ocr) {
        Write-Host "OCR : optional Tesseract not installed (use -Ocr to install)" -ForegroundColor DarkGray
        return
    }

    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $Winget) {
        Fail "Local OCR was requested, but winget is unavailable. Install Tesseract OCR manually, then restart LexiPane."
    }

    Write-Step "Installing optional local Tesseract OCR"

    $OcrWingetArgs = @(
        "install",
        "--id", "UB-Mannheim.TesseractOCR",
        "-e",
        "--source", "winget",
        "--accept-source-agreements",
        "--accept-package-agreements"
    )

    & winget @OcrWingetArgs

    if ($LASTEXITCODE -ne 0) {
        Fail "Tesseract OCR installation failed with exit code $LASTEXITCODE."
    }

    $Executable = Get-TesseractExecutable
    if (-not $Executable) {
        Fail "Tesseract installation finished, but the executable was not found. Open a new PowerShell window and run the launcher again."
    }

    Write-Host "OCR : $Executable"
}

function Test-LoopbackTcpPort([int]$Port) {
    $Listener = $null
    try {
        $Listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Loopback,
            $Port
        )
        $Listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $Listener) {
            try {
                $Listener.Stop()
            }
            catch {
                # Best-effort cleanup only.
            }
        }
    }
}

function Get-AvailableLoopbackTcpPort {
    if ($env:TAURI_DEV_PORT) {
        $RequestedPort = 0
        if (-not [int]::TryParse($env:TAURI_DEV_PORT, [ref]$RequestedPort) -or
            $RequestedPort -lt 1 -or
            $RequestedPort -gt 65535) {
            Fail "TAURI_DEV_PORT must be an integer between 1 and 65535."
        }

        if (-not (Test-LoopbackTcpPort $RequestedPort)) {
            Fail "Requested TAURI_DEV_PORT $RequestedPort is unavailable or reserved by Windows."
        }

        return $RequestedPort
    }

    # Keep the historical port when it is usable so direct URLs remain
    # predictable. Windows can reserve large TCP ranges for Hyper-V/WSL/
    # containers, so do not assume a different hard-coded port is safer.
    if (Test-LoopbackTcpPort 1420) {
        return 1420
    }

    $Listener = $null
    try {
        $Listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Loopback,
            0
        )
        $Listener.Start()
        return ([System.Net.IPEndPoint]$Listener.LocalEndpoint).Port
    }
    catch {
        Fail "Windows could not allocate a free loopback TCP port for the LexiPane dev server: $($_.Exception.Message)"
    }
    finally {
        if ($null -ne $Listener) {
            try {
                $Listener.Stop()
            }
            catch {
                # Best-effort cleanup only.
            }
        }
    }
}

function New-TauriDevConfig([int]$Port) {
    $ConfigPath = Join-Path $env:TEMP "lexipane-tauri-dev-$PID.json"
    $Config = @{
        build = @{
            devUrl = "http://127.0.0.1:$Port"
        }
    } | ConvertTo-Json -Depth 4

    [System.IO.File]::WriteAllText(
        $ConfigPath,
        $Config,
        [System.Text.UTF8Encoding]::new($false)
    )

    return $ConfigPath
}

function Ensure-TauriIcons {
    $IconDir = Join-Path $ProjectRoot "src-tauri\icons"
    $SourceIcon = Join-Path $IconDir "icon.png"
    $WindowsIcon = Join-Path $IconDir "icon.ico"

    if (Test-Path $WindowsIcon) {
        return
    }

    if (-not (Test-Path $SourceIcon)) {
        Fail @"
Tauri application icons are missing.

Expected at least:
    src-tauri\icons\icon.png

Restore the icon source file from Git, then run the launcher again.
"@
    }

    Write-Step "Generating Tauri application icons from icon.png"
    & npm run tauri -- icon "src-tauri/icons/icon.png"

    if ($LASTEXITCODE -ne 0) {
        Fail "Tauri icon generation failed with exit code $LASTEXITCODE."
    }

    if (-not (Test-Path $WindowsIcon)) {
        Fail @"
Tauri icon generation completed, but src-tauri\icons\icon.ico is still missing.

Try manually:
    npm run tauri -- icon src-tauri/icons/icon.png
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

if (-not $Web) {
    Ensure-LocalOcr
    Ensure-TauriIcons
}

$DevPort = Get-AvailableLoopbackTcpPort
$env:TAURI_DEV_PORT = "$DevPort"
Write-Host "Dev : http://127.0.0.1:$DevPort"

$LaunchExitCode = 0

if ($Web) {
    Write-Step "Starting LexiPane in browser development mode"
    & npm run dev
    $LaunchExitCode = $LASTEXITCODE
}
else {
    $RuntimeConfig = New-TauriDevConfig $DevPort
    try {
        Write-Step "Starting LexiPane desktop application"
        & npm run tauri -- dev --config $RuntimeConfig
        $LaunchExitCode = $LASTEXITCODE
    }
    finally {
        Remove-Item $RuntimeConfig -Force -ErrorAction SilentlyContinue
    }
}

if ($LaunchExitCode -ne 0) {
    Fail "LexiPane exited with code $LaunchExitCode."
}
