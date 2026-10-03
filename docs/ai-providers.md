# AI provider strategy

LexiPane is model-agnostic by design.

## Adapter categories

### Ollama

Ollama is the first-class local adapter using the native Ollama API.

Default development endpoint:

http://127.0.0.1:11434

The model name is discovered at runtime. LexiPane must never hard-code a Qwen model identifier, so a user can install or remove local models without updating the app.

### OpenAI-compatible

One configurable adapter covers many local and cloud runtimes.

Configuration fields:

- display name
- base URL
- API key reference
- optional custom headers
- selected model
- capability overrides

The same adapter can serve compatible cloud products as well as self-hosted servers.

### Native adapters

Native adapters remain appropriate when a provider exposes functionality that does not map cleanly to compatibility endpoints, especially prompt caching, multimodal content formats, structured output differences, reasoning controls, file APIs and provider-specific token accounting.

## Model registry

Provider identity and model identity are separate.

The future model registry records capabilities such as text, vision, embeddings, structured output, streaming, tool use, context length, local or cloud placement, and optional pricing metadata.

Routing should use capabilities instead of checking model names in feature code.

## Local Qwen workflow

A typical development configuration is:

1. Ollama running locally.
2. A Qwen-family model installed in Ollama.
3. LexiPane calls the Ollama tags endpoint to discover installed models.
4. The user assigns one of those models to vocabulary, phrase and sentence-analysis tasks.

No Qwen-specific branch is needed inside the reader.

## Privacy contract

Local-only mode must prevent reading content from being sent to a cloud provider.

Prefer-local mode may suggest escalation when a required capability is unavailable locally, but the user must be able to see that selected content would leave the device.

Cloud credentials must never be stored in plaintext SQLite.
