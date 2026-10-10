param([switch]$Doctor,[switch]$Build,[switch]$Install,[switch]$Dev)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not ($Doctor -or $Build -or $Install -or $Dev)) { $Doctor=$true }
$sdk=if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$java=if ($env:JAVA_HOME) { $env:JAVA_HOME } else { [Environment]::GetEnvironmentVariable('JAVA_HOME','User') }
$ndk=if ($env:NDK_HOME) { $env:NDK_HOME } else { [Environment]::GetEnvironmentVariable('NDK_HOME','User') }
$env:ANDROID_HOME=$sdk
if ($java) { $env:JAVA_HOME=$java; $env:PATH="$java\bin;$env:PATH" }
if ($ndk) { $env:NDK_HOME=$ndk }
$env:PATH="$sdk\platform-tools;$sdk\cmdline-tools\latest\bin;$env:PATH"
if ($Doctor) { & (Join-Path $root 'setup-android.ps1') -Doctor; exit $LASTEXITCODE }
if (-not (Test-Path (Join-Path $sdk 'platform-tools\adb.exe'))) { throw 'Android SDK not installed. Run .\setup-android.ps1 first.' }
Push-Location $root
try {
  if ($Build -or $Install) {
    & npm run tauri -- android build --debug --apk --target aarch64
    if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed.' }
  }
  if ($Install) {
    $adb=Join-Path $sdk 'platform-tools\adb.exe'
    & $adb devices
    $devices=@(& $adb devices | Select-String '\tdevice$')
    if ($devices.Count -ne 1) { throw 'Connect exactly one authorized Android device with USB debugging enabled.' }
    $apks=@(Get-ChildItem 'src-tauri\gen\android\app\build\outputs\apk' -Filter '*.apk' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if (-not $apks) { throw 'APK not found after build.' }
    & $adb install -r $apks[0].FullName
    if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
  }
  if ($Dev) {
    & npm run tauri -- android dev
    if ($LASTEXITCODE -ne 0) { throw 'Android dev failed.' }
  }
} finally { Pop-Location }
