# Android development on Windows

Status: ANDROID-001 bootstrap scripts added, **native Android build not yet verified**.

## Quick start in VS Code PowerShell

```powershell
.\setup-android.ps1 -Doctor
.\setup-android.ps1
.\start-lexipane-android.ps1 -Doctor
.\start-lexipane-android.ps1 -Build
.\start-lexipane-android.ps1 -Install
.\start-lexipane-android.ps1 -Dev
```

Setup uses Android's official command-line tools archive, SDK Manager, Rustup, and winget for a JDK when missing. Downloads take several GB. SDK licenses must be accepted by the developer. `-AcceptLicenses` supplies affirmative answers, use only after reviewing the Android SDK terms. Node and Rust are prerequisites already used by the desktop project.

Android SDK packages are installed under `%LOCALAPPDATA%\Android\Sdk` by default; user-scoped environment variables are persisted. Close and reopen VS Code if tools are not detected.

Use USB debugging and authorize the development computer on the phone; `-Install` needs exactly one connected authorized device. Debug APKs are for local tests only.

The current desktop resource downloader/aMule/Torrent bindings are not portable to Android as-is. Full Android Rust/UI portability and build verification remain tasks before shipping a usable reader.

The planned Android Ollama URL is `http://10.0.0.99:12000`. The phone must have network access to that IP and the Android app must be configured for local-network cleartext HTTP access; this is a separate pending implementation task.

## OpenSSL cross-compilation fix

Android excludes desktop-only `ssh2` (which links native libssh2/OpenSSL) and `librqbit`, and uses a mobile Tauri entrypoint without desktop resource/OCR commands. The desktop entrypoint remains unchanged. The fix has not yet been validated by an actual Windows-to-Android build; after pulling the branch rerun `./start-lexipane-android.ps1 -Build`. Do not set host `OPENSSL_DIR` or `PKG_CONFIG_ALLOW_CROSS` as a workaround.
