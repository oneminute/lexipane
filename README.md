# LexiPane

LexiPane is a cross-platform AI-assisted ebook reader for deep reading and language learning.

The book remains the primary reading surface. AI assistance sits beside it and stays tied to the exact reading context instead of becoming a separate chat workflow.

## What works now

The current desktop build now includes PDF, EPUB, and Kindle-family reading flows rather than only a PDF-first prototype:

- Tauri 2 + React + TypeScript + Rust desktop shell
- local SQLite bookshelf
- bookshelf favorites, finished state, search, recent filter, covers, and reading progress
- SHA-256 book identity with moved/renamed-file recovery and relinking
- optional content-addressed managed copies inside the LexiPane app-data library
- open books through the native file picker
- drag supported ebook files into the application
- real PDF.js rendering with metadata, contents navigation, protected-PDF handling, lazy rendering, and quote-recoverable highlights
- continuous multi-page PDF reading
- zoom controls
- selectable PDF text layer
- reading-position persistence and restore
- persistent user highlights
- EPUB.js reading with CFI position/highlights, invalid-CFI recovery, persisted font controls, Light/Sepia/Dark themes, scrolled/paginated modes, cover extraction, AI assistance, and Notebook anchors
- MOBI/AZW/AZW3 reading with local chapter/internal-link navigation, shared reading themes/font controls, cover extraction, highlights, AI assistance, and Notebook anchors
- versioned PDF text anchors containing page, exact quote, quote context, and normalized highlight rectangles
- local Ollama model discovery
- automatic difficult-word and phrase detection with A2/B1/B2/C1 reader levels
- Known / Remove / Difficult feedback and the first personalized reading profile
- automatic preference for an installed Qwen 3.5/Qwen model when no model was chosen
- contextual explanation of selected text with structured reading-result cards
- structured grammar/structure analysis
- structured reader questions with key points and text-grounded evidence
- ordered Primary → Fallback 1 → Fallback 2 routing per AI task
- per-book AI privacy override that can inherit or override the global policy
- double-click sentence selection with automatic grammar/structure analysis
- persistent Notebook entries containing source text, AI explanation, editable user notes, and durable region/image attachments
- provider registry covering major local, global-cloud, and China-cloud AI families
- secure cloud/provider credentials in the native OS credential store
- per-task local/cloud routing, ordered fallbacks, timeout/retry policy, privacy modes, streaming responses, and structured multimodal region analysis
- per-book provider allow/deny controls
- model capability probing and provider readiness diagnostics
- optional cloud token pricing with total/today/month cost estimates

The first live AI path is intentionally local: Ollama at `http://127.0.0.1:11434`.

## Current reading workflow

1. Open or drag in a PDF.
2. LexiPane adds it to the local bookshelf.
3. Read continuously and zoom as needed.
4. Select a word or phrase for contextual help, or double-click inside a sentence for automatic sentence grammar analysis.
5. Use **Explain** or **Analyze grammar** in the AI pane.
6. Ask a custom question about the selection.
7. Use **Highlight** to keep the selection visually attached to the PDF.
8. Use **Save note** to store the source text and optional AI explanation.
9. Open **Notebook** to add your own notes.
10. Close and reopen the book; LexiPane restores the saved reading page.

## AI architecture

LexiPane is model-agnostic.

### Live now

- Ollama local runtime
- generic OpenAI-compatible provider adapter
- native Anthropic provider
- native Gemini provider
- runtime model discovery and capability inspection
- structured contextual reading analysis
- Primary / Fallback 1 / Fallback 2 routing
- per-task timeout and transient retry policy
- global and per-book privacy controls
- per-book provider allow/deny policy
- secure provider credentials
- token/latency usage and optional cost estimates

### Provider catalog

Local targets:

- Ollama
- LM Studio
- llama.cpp server
- vLLM
- LocalAI
- custom OpenAI-compatible local endpoints

Cloud targets:

- OpenAI
- Anthropic Claude
- Google Gemini
- xAI Grok
- OpenRouter
- Mistral
- Alibaba Qwen / Model Studio
- DeepSeek
- Moonshot / Kimi
- Zhipu / GLM
- MiniMax
- ByteDance / Doubao
- Baidu ERNIE / Qianfan
- Tencent Hunyuan

Catalog presence does not mean every cataloged provider has a dedicated native adapter. Configurable compatible endpoints plus native Anthropic/Gemini are live, and cloud credentials use native secure storage.

## Architecture

~~~text
LexiPane
├─ Document Engine          PDF / EPUB / Kindle-family live
├─ Annotation Engine        stable format-specific anchors live
├─ Notebook Engine          persistent notes/tags/navigation live
├─ AI Platform
│  ├─ Provider / Model Registry
│  ├─ Ollama / Compatible / Anthropic / Gemini
│  ├─ Capability Probing
│  ├─ Primary + Fallback Routing
│  ├─ Timeout / Retry Policy
│  ├─ Structured Output
│  ├─ Usage / Cost
│  └─ Global + Per-book Privacy / Provider Policy
└─ Personal Reading Model   feedback-driven foundation live
~~~

See:

- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/ai-providers.md`

## Development

Prerequisites:

- Node.js 22+
- npm
- Rust stable
- Tauri 2 platform prerequisites for your OS

### Windows one-click development launcher

After cloning or pulling the repository, double-click:

~~~text
start-lexipane.cmd
~~~

The launcher:

1. checks Node.js and npm;
2. requires Node.js 22 or newer;
3. checks Rust/Cargo before desktop startup;
4. automatically adds `%USERPROFILE%\\.cargo\\bin` to the current PATH when Rust is already installed;
5. validates the Tauri Rust workspace with `cargo metadata`;
6. runs `npm install --no-audit --no-fund`;
7. installs missing JavaScript dependencies and synchronizes `node_modules`;
8. starts the desktop app with `npm run tauri dev`;
9. keeps the console open with a targeted diagnostic if startup fails.

Optional modes:

~~~powershell
# Update packages within the version ranges allowed by package.json
.\start-lexipane.cmd -Update

# Start only the browser/Vite UI
.\start-lexipane.cmd -Web

# Skip npm dependency synchronization
.\start-lexipane.cmd -SkipInstall

# Install optional local Tesseract OCR on Windows, then start
.\start-lexipane.cmd -Ocr
~~~

`-Bootstrap` uses Windows Package Manager to install the official Rustup package, then configures the stable Rust toolchain. It is explicit rather than automatic so the normal launcher never installs system-level developer tooling without being asked.

If Rust was installed separately but the current terminal still says `cargo` is missing, open a new PowerShell window. Cargo normally lives in `%USERPROFILE%\\.cargo\\bin`.

The optional `-Ocr` switch installs a local Tesseract OCR engine through Windows Package Manager. Normal startup only detects OCR and never installs it silently.

Breaking major dependency upgrades remain deliberate project changes rather than happening silently at startup.

### Manual commands

~~~bash
npm install
npm run tauri dev
~~~

Checks:

~~~bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
~~~

## Ollama

Start Ollama before starting LexiPane and make sure at least one model is installed.

LexiPane connects to:

~~~text
http://127.0.0.1:11434
~~~

Open **AI & Models** inside LexiPane to see connection status and discovered models.

If no model has been selected, LexiPane prefers:

1. an installed model whose name contains `qwen3.5`;
2. another installed Qwen model;
3. otherwise the first available local model.

The reader never hard-codes one exact Qwen model identifier.

## Formats

Current live readers:

- PDF
- EPUB
- MOBI
- AZW
- AZW3

DRM-protected content is outside the initial scope.

## Local data and privacy

SQLite stores local application data including:

- bookshelf metadata
- reading positions
- annotations
- highlights
- notes
- model preferences
- provider configuration and AI usage data
- per-book privacy/provider policy

Ollama can keep reading tasks local. Cloud API keys are stored in native OS credential storage rather than plaintext SQLite values.

## License

MIT
