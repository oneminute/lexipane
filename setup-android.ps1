param([switch]$Doctor,[switch]$AcceptLicenses)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
function Need($name) { if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "$name is missing. Install Node.js 22 / Rust (rustup) before running this script." } }
function SetUser($name,$value) {
  [Environment]::SetEnvironmentVariable($name,$value,'User')
  Set-Item "Env:$name" $value
}
$javaCandidates = @($env:JAVA_HOME,'C:\Program Files\Android\Android Studio\jbr','C:\Program Files\Eclipse Adoptium\jdk-17*','C:\Program Files\Eclipse Adoptium\jdk-21*') | Where-Object { $_ }
$java = $javaCandidates | ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1 -ExpandProperty FullName
if ($Doctor) {
  foreach($name in @('node','npm','rustup','java')) { Write-Host "$name : $([bool](Get-Command $name -ErrorAction SilentlyContinue))" }
  Write-Host "JAVA_HOME candidate: $java"
  Write-Host "ANDROID_HOME: $sdk"
  Write-Host "sdkmanager: $(Test-Path (Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'))"
  Write-Host "adb: $(Test-Path (Join-Path $sdk 'platform-tools\adb.exe'))"
  Write-Host "NDK: $(@(Get-ChildItem (Join-Path $sdk 'ndk') -Directory -ErrorAction SilentlyContinue).Count -gt 0)"
  exit 0
}
Need node; Need npm; Need rustup
if (-not $java) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'No JDK found and winget unavailable. Install Temurin JDK 17 or Android Studio JBR.' }
  & winget install --id EclipseAdoptium.Temurin.17.JDK -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw 'JDK installation failed.' }
  $java = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -Last 1 -ExpandProperty FullName
  if (-not $java) { throw 'JDK was installed but not detected. Restart VS Code and rerun.' }
}
SetUser 'JAVA_HOME' $java
SetUser 'ANDROID_HOME' $sdk
New-Item -ItemType Directory -Force -Path $sdk | Out-Null
$manager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $manager)) {
  Write-Host 'Downloading official Android SDK command-line tools...'
  $zip = Join-Path $env:TEMP 'lexipane-android-cmdline.zip'
  $extract = Join-Path $env:TEMP 'lexipane-android-cmdline-extract'
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  # Version published on developer.android.com/studio at authoring time.
  Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -OutFile $zip
  Expand-Archive $zip -DestinationPath $extract -Force
  $destination = Join-Path $sdk 'cmdline-tools\latest'
  New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
  Move-Item (Join-Path $extract 'cmdline-tools') $destination
}
$env:PATH = "$java\bin;$sdk\platform-tools;$sdk\cmdline-tools\latest\bin;$env:PATH"
if ($AcceptLicenses) { ('y' * 120).ToCharArray() | & $manager "--sdk_root=$sdk" --licenses | Out-Host }
else { Write-Host 'Android SDK license acceptance may prompt for your confirmation.'; & $manager "--sdk_root=$sdk" --licenses }
if ($LASTEXITCODE -ne 0) { throw 'Android SDK licenses not accepted.' }
& $manager "--sdk_root=$sdk" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 'ndk;27.2.12479018'
if ($LASTEXITCODE -ne 0) { throw 'SDK package installation failed.' }
$ndk = Join-Path $sdk 'ndk\27.2.12479018'
if (-not (Test-Path $ndk)) { throw 'NDK installation missing.' }
SetUser 'NDK_HOME' $ndk
& rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
if ($LASTEXITCODE -ne 0) { throw 'Rust Android targets failed.' }
Push-Location $root
try {
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  if (-not (Test-Path 'src-tauri\gen\android')) {
    & npm run tauri -- android init
    if ($LASTEXITCODE -ne 0) { throw 'Tauri Android init failed.' }
  }
} finally { Pop-Location }
Write-Host 'Android toolchain bootstrap completed. Run .\start-lexipane-android.ps1 -Doctor to verify.'
