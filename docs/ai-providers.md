# AI provider strategy

LexiPane is model-agnostic by design.

## Provider boundary

Reader features call semantic reading tasks rather than vendor APIs directly.

Examples:

- explain selected text in context
- analyze grammar and sentence structure
- detect difficult vocabulary
- explain a phrase or collocation
- analyze a selected image/region
- answer a question about the current reading context

The task layer selects a configured model through the provider/model registry.

## Ollama — live local path

Ollama is the first fully connected runtime.

Default endpoint:

`http://127.0.0.1:11434`

The desktop application uses Tauri's Rust-backed HTTP client for this connection, so the reader does not depend on WebView CORS behavior.

The application currently allows only the default local Ollama origin through the Tauri HTTP capability.

At startup or when AI & Models is opened:

1. LexiPane checks Ollama.
2. It requests the installed model list.
3. It restores the user's saved model choice when available.
4. Otherwise it prefers an installed Qwen 3.5 model.
5. Otherwise it prefers another Qwen model.
6. Otherwise it uses the first available model.

The exact Qwen model identifier is never hard-coded.

## Context sent to local AI

For a PDF text selection, the first live reading task supplies:

- the exact selected text
- page number in application state
- normalized surrounding text from the PDF text layer
- task intent such as contextual explanation, grammar analysis, or a reader question

The local prompt asks for Simplified Chinese explanations while preserving useful English expressions and structures.

## OpenAI-compatible adapter

A generic adapter foundation exists for APIs exposing OpenAI-compatible model listing and chat-completions semantics.

It is intended to cover many local/self-hosted and cloud services without coupling reader code to each provider.

Cloud use is not considered complete until secure credential storage and explicit privacy/routing controls are implemented.

## Native adapters

Native provider adapters remain appropriate when important features do not map cleanly to compatibility APIs, especially:

- multimodal request formats
- prompt caching
- reasoning controls
- structured-output differences
- file APIs
- provider-specific token accounting
- provider-specific authentication

Planned native/provider-specific work includes OpenAI, Anthropic Claude, Google Gemini, and other providers where native functionality matters.

## Provider catalog

The registry already catalogs major families:

Local:

- Ollama
- LM Studio
- llama.cpp server
- vLLM
- LocalAI
- custom local endpoints

Global cloud:

- OpenAI
- Anthropic Claude
- Google Gemini
- xAI Grok
- OpenRouter
- Mistral
- custom cloud endpoints

China cloud:

- Alibaba Qwen / Model Studio
- DeepSeek
- Moonshot / Kimi
- Zhipu / GLM
- MiniMax
- ByteDance / Doubao
- Baidu ERNIE / Qianfan
- Tencent Hunyuan

Catalog presence means the architecture knows about the provider family; it does not imply that provider credentials and every native feature are already implemented.

## Model registry

Provider identity and model identity are separate.

Model capabilities will track fields such as:

- text
- vision
- embeddings
- structured output
- streaming
- tool use
- context length
- local/cloud placement
- optional pricing metadata

Routing should depend on capabilities rather than hard-coded model-name branches.

## Privacy contract

Target modes:

- Local only
- Prefer local
- Automatic
- Cloud only

Local-only mode must prevent reading content from reaching a cloud provider.

Prefer-local mode may offer escalation when a required capability is unavailable locally, but the user must be told when selected content would leave the device.

Cloud API credentials must never be persisted as plaintext SQLite values.
