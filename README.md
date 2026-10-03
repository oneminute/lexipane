# LexiPane

LexiPane is a cross-platform AI-assisted ebook reader for deep reading and language learning.

The product keeps the book as the primary surface and places structured AI assistance beside it: difficult words and phrases, contextual meanings, sentence grammar, passage explanations, region/image analysis, notes, and eventually a personal reading model that adapts to what the user actually knows.

## Current foundation

The repository now contains the initial application scaffold:

- Tauri 2 desktop/mobile shell
- React + TypeScript frontend
- Rust native layer
- SQLite schema v1
- Library, Reader, Notebook and AI/Models UI surfaces
- Ollama provider adapter
- generic OpenAI-compatible provider adapter
- provider catalog covering major local, global-cloud and China-cloud model families
- responsive split-reader concept
- baseline tests and CI

The PDF rendering engine is the next implementation slice.

## Planned formats

- PDF first
- EPUB
- MOBI
- AZW / AZW3
- additional common ebook formats through the Document Engine abstraction

## AI philosophy

LexiPane is model-agnostic.

Local targets include Ollama, LM Studio, llama.cpp server, vLLM and LocalAI. Cloud targets include OpenAI, Anthropic Claude, Google Gemini, xAI Grok, OpenRouter, Alibaba Qwen, DeepSeek, Kimi, GLM, MiniMax, Doubao, ERNIE and Hunyuan.

The provider layer is separate from reading features, so changing a model does not change reader UI.

A typical setup can use local Qwen for vocabulary, phrases and sentence grammar while using a cloud vision model only when needed.

## Architecture

~~~text
LexiPane
├─ Document Engine
├─ Annotation Engine
├─ Notebook Engine
├─ AI Platform
│  ├─ Provider Registry
│  ├─ Model Registry
│  ├─ Task Router
│  ├─ Prompt Templates
│  ├─ Structured Output
│  ├─ Usage / Cost
│  └─ Privacy Policy
└─ Personal Reading Model
~~~

See docs/architecture.md, docs/roadmap.md and docs/ai-providers.md.

## Development

Prerequisites:

- Node.js 22+
- npm
- Rust stable
- Tauri 2 platform prerequisites for your OS

### Windows one-click launcher

After cloning the repository, double-click:

~~~text
start-lexipane.cmd
~~~

The launcher:

1. checks that Node.js 22+ and npm are available;
2. runs `npm install --no-audit --no-fund` to install missing packages and synchronize dependencies;
3. starts the Tauri desktop application with `npm run tauri dev`;
4. keeps the console open if startup fails so the error can be read.

Optional command-line modes:

~~~powershell
# Explicitly update packages within the semver ranges allowed by package.json
.\start-lexipane.cmd -Update

# Start only the browser/Vite UI
.\start-lexipane.cmd -Web

# Skip dependency synchronization when you know node_modules is current
.\start-lexipane.cmd -SkipInstall
~~~

The launcher does not silently upgrade dependencies across breaking major versions. Major-version upgrades should remain deliberate code changes reviewed through Git.

### Manual commands

Install frontend dependencies:

~~~bash
npm install
~~~

Run browser UI during frontend work:

~~~bash
npm run dev
~~~

Run the desktop application:

~~~bash
npm run tauri dev
~~~

Run checks:

~~~bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
~~~

## Data and privacy

Book metadata, positions, annotations, notes, provider configuration and usage records are designed to live in local SQLite.

Cloud API keys must not be stored in plaintext SQLite. A platform SecretStore abstraction will use the operating system secure credential facility.

Privacy modes are planned as Local only, Prefer local, Automatic and Cloud only.

## License

MIT
