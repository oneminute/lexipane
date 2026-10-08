# Bundled aMule runtime

This directory is the Tauri resource root for LexiPane's managed aMule runtime.

Pinned runtime release: **aMule 3.1.0**.

LexiPane expects the extracted runtime to place these executables directly in this
folder on desktop builds:

- `amuled(.exe)`
- `amulecmd(.exe)`

Any DLLs or other runtime dependencies distributed with the official portable
archive should remain beside those executables.

The binaries themselves are intentionally not committed by this bootstrap
change. A packaging step will populate this directory from the official aMule
release archive before producing a distributable LexiPane bundle.

Runtime state is not stored here. LexiPane launches the daemon with an isolated
configuration under its own application-data directory:

`ed2k/amule-runtime/{config,incoming,temp}`

aMule is GPLv2+. Keep its license and required source-offer information with any
redistributed runtime package.
