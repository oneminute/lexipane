# LexiPane iOS foundation

The Windows desktop version remains the primary development environment. GitHub Actions performs iOS compilation on a macOS runner.

## Current status

- IOS-001: iOS platform build scaffold (in progress; CI not yet verified).
- IOS-002: local-network Ollama support (pending).
- IOS-003: iPhone reader and document picker (pending).
- IOS-004: Apple signing and TestFlight (pending).

## Settings

- Desktop Ollama default: `http://127.0.0.1:12000`
- Planned iPhone Ollama default: `http://10.0.0.99:12000`
- On iPhone, `127.0.0.1` refers to the phone, not the Windows PC.
- Ensure the LLM server is reachable on the LAN and firewall rules are restricted to trusted devices.

## Workflow

The workflow `.github/workflows/ios.yml` checks the unsigned iOS build on GitHub-hosted macOS. Successful execution has not yet been verified. A signed IPA and TestFlight deployment require an Apple Developer Program membership, signing assets and App Store Connect credentials. Never commit private keys, certificates or API keys.

## Platform constraints

Bundled aMule desktop runtime is excluded from iOS configuration. Resource-transfer features need mobile-specific gating before iOS can be considered supported. The first mobile scope is reading, EPUB/PDF import, AI explanation, caching, bookmarks and reading position.
