param(
    [switch]$Force,
    [switch]$KeepArchive
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RuntimeDir = Join-Path $ProjectRoot "src-tauri\runtime\amule"
$ManifestPath = Join-Path $RuntimeDir "runtime.json"
$CacheRoot = Join-Path $ProjectRoot ".cache\third-party\amule"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    throw $Message
}

if (-not (Test-Path $ManifestPath)) {
    Fail "aMule runtime manifest was not found: $ManifestPath"
}

$Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
if (-not $Manifest.artifacts.windowsX64) {
    Fail "runtime.json does not define artifacts.windowsX64."
}

$Artifact = $Manifest.artifacts.windowsX64
$AssetName = [string]$Artifact.asset
$AssetUrl = [string]$Artifact.url
$ExpectedSha256 = ([string]$Artifact.sha256).ToLowerInvariant()
$Version = [string]$Manifest.version

if ([string]::IsNullOrWhiteSpace($AssetName) -or
    [string]::IsNullOrWhiteSpace($AssetUrl) -or
    $ExpectedSha256 -notmatch "^[0-9a-f]{64}$") {
    Fail "The Windows x64 aMule runtime pin in runtime.json is incomplete or invalid."
}

$CacheDir = Join-Path $CacheRoot $Version
$ArchivePath = Join-Path $CacheDir $AssetName
$ExtractDir = Join-Path $CacheDir "extracted"

New-Item -ItemType Directory -Force $CacheDir | Out-Null
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Test-ArchiveHash([string]$Path) {
    if (-not (Test-Path $Path)) {
        return $false
    }

    $Actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -eq $ExpectedSha256) {
        return $true
    }

    Write-Host "Expected SHA-256: $ExpectedSha256" -ForegroundColor Yellow
    Write-Host "Actual   SHA-256: $Actual" -ForegroundColor Yellow
    return $false
}

if ($Force -and (Test-Path $ArchivePath)) {
    Remove-Item $ArchivePath -Force
}

if (-not (Test-ArchiveHash $ArchivePath)) {
    if (Test-Path $ArchivePath) {
        Remove-Item $ArchivePath -Force
    }

    Write-Step "Downloading aMule $Version Windows x64 portable runtime"
    Invoke-WebRequest -Uri $AssetUrl -OutFile $ArchivePath -UseBasicParsing

    if (-not (Test-ArchiveHash $ArchivePath)) {
        Remove-Item $ArchivePath -Force -ErrorAction SilentlyContinue
        Fail "Downloaded aMule archive failed SHA-256 verification."
    }
}
else {
    Write-Host "Using verified cached archive: $ArchivePath"
}

Write-Step "Extracting verified aMule archive"
Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

$Daemon = Get-ChildItem -Path $ExtractDir -Filter "amuled.exe" -File -Recurse |
    Select-Object -First 1
$Command = Get-ChildItem -Path $ExtractDir -Filter "amulecmd.exe" -File -Recurse |
    Select-Object -First 1

if (-not $Daemon) {
    Fail "The verified aMule archive does not contain amuled.exe."
}
if (-not $Command) {
    Fail "The verified aMule archive does not contain amulecmd.exe."
}

$DaemonDir = $Daemon.Directory.FullName
$CommandDir = $Command.Directory.FullName
if (-not [string]::Equals(
    $DaemonDir,
    $CommandDir,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    Fail "amuled.exe and amulecmd.exe were found in different directories; refusing to stage an unknown archive layout."
}

Write-Step "Staging aMule runtime into LexiPane Tauri resources"
$Preserve = @("README.md", "runtime.json")
Get-ChildItem -Path $RuntimeDir -Force |
    Where-Object { $Preserve -notcontains $_.Name } |
    Remove-Item -Recurse -Force

Copy-Item -Path (Join-Path $DaemonDir "*") -Destination $RuntimeDir -Recurse -Force

$License = Get-ChildItem -Path $ExtractDir -File -Recurse |
    Where-Object { $_.Name -in @("LICENSE.md", "LICENSE", "COPYING") } |
    Select-Object -First 1

if ($License) {
    Copy-Item $License.FullName (Join-Path $RuntimeDir "AMULE-LICENSE.md") -Force
}
else {
    $LicenseUrl = "https://raw.githubusercontent.com/amule-org/amule/$Version/LICENSE.md"
    Invoke-WebRequest -Uri $LicenseUrl -OutFile (Join-Path $RuntimeDir "AMULE-LICENSE.md") -UseBasicParsing
}

foreach ($Required in @("amuled.exe", "amulecmd.exe")) {
    $RequiredPath = Join-Path $RuntimeDir $Required
    if (-not (Test-Path $RequiredPath)) {
        Fail "Runtime staging completed but $Required is missing."
    }
}

$StagedFiles = Get-ChildItem -Path $RuntimeDir -File
$StagedBytes = ($StagedFiles | Measure-Object -Property Length -Sum).Sum
if ($null -eq $StagedBytes) {
    $StagedBytes = 0
}

Write-Host ""
Write-Host "aMule runtime ready." -ForegroundColor Green
Write-Host "Version : $Version"
Write-Host "Source  : $AssetUrl"
Write-Host "SHA-256 : $ExpectedSha256"
Write-Host "Runtime : $RuntimeDir"
Write-Host ("Files   : {0}" -f $StagedFiles.Count)
Write-Host ("Size    : {0:N1} MiB" -f ($StagedBytes / 1MB))

if (-not $KeepArchive) {
    Remove-Item $ArchivePath -Force -ErrorAction SilentlyContinue
}
Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue
