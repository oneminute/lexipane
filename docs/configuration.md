# Configuration

LexiPane deliberately separates application defaults, user settings, secrets,
and development-process environment variables.

## Application defaults

Source-controlled defaults live in:

`src/config/appDefaults.ts`

Current defaults include:

- Ollama base URL
- preferred local-model name hints
- global AI privacy mode
- per-task AI timeout/retry defaults
- default reading level
- ebook font scale
- ebook theme
- EPUB flow mode
- local OCR language

These values are fallbacks. A saved user preference takes precedence when a
corresponding runtime setting exists.

For local development, the source-controlled Ollama default is
`http://127.0.0.1:12000`. LexiPane also probes Ollama's standard
`http://127.0.0.1:11434` endpoint when the preferred endpoint is unavailable,
then stores the working endpoint in `app_meta`.

## Runtime user settings

Mutable application settings belong in the local SQLite database, primarily
through `app_meta` and provider configuration tables.

Examples:

- Ollama server URL
- selected Ollama model
- reading level
- ebook font scale/theme/flow
- AI privacy mode
- per-task route plans
- per-task timeout/retry policies
- provider base URL/model/pricing
- per-book privacy/provider policy

This keeps normal user configuration editable from LexiPane rather than
requiring source-code or environment-file changes.

## Secrets

Provider API keys are stored in the operating system credential store through
LexiPane's secure-store abstraction.

They must not be placed in:

- `.env`
- SQLite
- committed JSON
- TypeScript source files

## Development environment

`.env.example` is intentionally minimal.

`TAURI_DEV_HOST` is a Tauri/Vite development-process variable. It is normally
provided by the Tauri toolchain and is not part of LexiPane application
configuration.

When adding a new setting, use this rule:

1. Stable product default -> `src/config/appDefaults.ts`
2. User-changeable preference -> SQLite / `app_meta`
3. Secret -> native OS secure store
4. Build/dev-process setting -> environment variable
