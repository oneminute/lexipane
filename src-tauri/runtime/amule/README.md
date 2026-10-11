# Bundled aMule runtime

This directory is the Tauri resource root for LexiPane's managed aMule runtime.

Pinned runtime release: **aMule 3.1.0**.

Prepare the Windows x64 runtime from the repository root with:

```powershell
.\scripts\windows\prepare-amule-runtime.ps1
```

The preparation script reads `runtime.json`, downloads the pinned official
portable ZIP, verifies its SHA-256 before extraction, locates the portable
`bin` directory through `amuled.exe` + `amulecmd.exe`, and stages that
directory here. Use `-Force` to redownload the archive or `-CleanArchive`
to remove the verified cached ZIP after staging.

LexiPane requires these executables directly in this folder after preparation:

- `amuled.exe`
- `amulecmd.exe`

The portable archive's DLLs, `ca-bundle.crt`, and other files beside those
executables are staged with them because the Windows release is self-contained.

Generated runtime files are intentionally ignored by Git. The committed
`README.md` and `runtime.json` are the reproducibility inputs; packaging
must run the preparation script before producing a distributable Windows
LexiPane bundle.

Runtime state is not stored here. LexiPane launches the daemon with isolated
state under its own application-data directory:

`ed2k/amule-runtime/{config,incoming,temp}`

aMule is GPLv2+. The preparation step also stages the upstream license beside
the runtime. Keep that license and the required source-availability information
with any redistributed LexiPane package containing aMule.
