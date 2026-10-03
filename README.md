# LexiPane

LexiPane is a cross-platform AI-assisted ebook reader for deep reading and language learning.

The book remains the primary reading surface. AI assistance sits beside it and stays tied to the exact reading context instead of becoming a separate chat workflow.

## What works now

The current desktop build now includes PDF, EPUB, and Kindle-family reading flows rather than only a PDF-first prototype:

- Tauri 2 + React + TypeScript + Rust desktop shell
- local SQLite bookshelf
- bookshelf favorites, finished state, search, recent filter, covers, and reading progress
- open books through the native file picker
- drag supported ebook files into the application
- real PDF.js rendering with metadata, contents navigation, protected-PDF handling, lazy rendering, and quote-recoverable highlights
- continuous multi-page PDF reading
- zoom controls
- selectable PDF text layer
- reading-position persistence and restore
- persistent user highlights
- EPUB.js reading with CFI position/highlights, typography controls, AI assistance, and Notebook anchors
- MOBI/AZW/AZW3 reading with local chapter navigation, highlights, AI assistance, and Notebook anchors
- versioned PDF text anchors containing page, exact quote, quote context, and normalized highlight rectangles
- local Ollama model discovery
- automatic difficult-word and phrase detection with A2/B1/B2/C1 reader levels
- Known / Remove / Difficult feedback and the first personalized reading profile
- automatic preference for an installed Qwen 3.5/Qwen model when no model was chosen
- contextual explanation of selected PDF text
- grammar/structure analysis of selected text
- questions about selected text with surrounding page context
- double-click sentence selection with automatic grammar/structure analysis
- persistent Notebook entries containing source text, AI explanation, and editable user notes
- provider registry covering major local, global-cloud, and China-cloud AI families
- secure cloud/provider credentials in the native OS credential store
- per-task local/cloud routing, privacy modes, streaming responses, and multimodal region analysis

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
- runtime model discovery
- local model selection
- contextual reading analysis

### Adapter foundation already present

- generic OpenAI-compatible provider adapter

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

Catalog presence does not mean every provider is fully configured in the UI yet. Cloud credential storage and provider-native integrations are still under development.

## Architecture

~~~text
LexiPane
├─ Document Engine
│  └─ PDF.js                 live
├─ Annotation Engine
│  └─ PDF text-range anchors live
├─ Notebook Engine           live foundation
├─ AI Platform
│  ├─ Provider Registry
│  ├─ Model Registry
│  ├─ Ollama Runtime         live
│  ├─ Task Router            in progress
│  ├─ Structured Output      planned
│  ├─ Usage / Cost           planned
│  └─ Privacy Policy
└─ Personal Reading Model    planned
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
~~~

`-Bootstrap` uses Windows Package Manager to install the official Rustup package, then configures the stable Rust toolchain. It is explicit rather than automatic so the normal launcher never installs system-level developer tooling without being asked.

If Rust was installed separately but the current terminal still says `cargo` is missing, open a new PowerShell window. Cargo normally lives in `%USERPROFILE%\\.cargo\\bin`.

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

Current live reader:

- PDF

Library recognition already includes:

- EPUB
- MOBI
- AZW
- AZW3

Those formats will connect to the shared Document Engine in later phases.

DRM-protected content is outside the initial scope.

## Local data and privacy

SQLite stores local application data including:

- bookshelf metadata
- reading positions
- annotations
- highlights
- notes
- model preferences
- future provider configuration and usage data

The current Ollama reading path runs locally. Cloud API keys must not be stored as plaintext SQLite values; platform secure credential storage will be added before cloud-provider configuration is considered complete.

## License

MIT
