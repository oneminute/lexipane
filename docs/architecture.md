# LexiPane architecture

## Design principles

LexiPane is a contextual reading system, not a chat window attached to a document viewer. The source document remains the primary surface; annotations, AI results, Notebook entries, and personal-reading feedback remain tied to stable book locations.

The application separates five concerns:

1. **Document Engine** — format-native PDF, EPUB, and Kindle-family readers behind shared reading operations.
2. **Annotation Engine** — stable format-specific anchors for user and automatic annotations.
3. **Notebook Engine** — source text, AI analysis, user notes, tags, and navigation targets.
4. **AI Platform** — provider/model abstraction, routing, privacy, structured output, execution policy, usage, and cost.
5. **Personal Reading Model** — Known / Difficult / Removed feedback that adapts future assistance.

## Runtime stack

- Tauri 2
- React + TypeScript
- Rust native boundary
- SQLite local persistence
- PDF.js
- EPUB.js
- local MOBI/AZW/AZW3 engine

Android and iOS should reuse the same domain services rather than becoming separate products.

## Document Engine

Format rendering remains native to each document type rather than forcing PDF and reflowable books into one render tree.

~~~text
Document layer
├─ PDF   -> PDF.js
├─ EPUB  -> EPUB.js
└─ MOBI / AZW / AZW3 -> Kindle-family reader
        ↓
Shared reading operations
metadata / contents / position / selection / annotation / note / AI context
~~~

Current stable locations include:

- PDF: page + exact quote + prefix/suffix quote context + normalized rectangles
- EPUB: EPUB CFI + exact selected text/context
- Kindle-family: chapter/spine location + selected text/context

PDF quote context is used to recover highlight geometry if text-layer segmentation or layout changes.

DRM-protected books are outside the initial scope.

## AI Platform

Reader features call semantic tasks rather than vendor APIs:

- automatic difficulty detection
- contextual explanation
- grammar/structure analysis
- reader questions
- region/image analysis

### Providers

Live provider families include:

- Ollama
- generic OpenAI-compatible endpoints
- native Anthropic
- native Gemini

The registry also catalogs additional local, global-cloud, and China-cloud families that can use compatibility adapters or future provider-native adapters.

### Structured output

Core reading tasks validate typed JSON before rendering:

~~~text
Explain -> meaning / natural Chinese / expressions / usage
Grammar -> translation / structure / grammar points / difficult expressions
Ask -> answer / key points / evidence
Region -> content type / summary / extracted text / key points / visual details
~~~

Invalid structured output is a route failure and may trigger the next configured fallback.

### Routing and execution

Each task has:

~~~text
Primary
  ↓ failure
Fallback 1
  ↓ failure
Fallback 2
~~~

Each task also has an execution policy:

- timeout
- transient retry count
- retry delay policy

Authentication/schema errors do not retry blindly. Timeouts, rate limits, selected transient HTTP failures, and network failures may retry before moving to the next route.

### Model capabilities

Capabilities include:

- text
- vision
- structured output
- streaming
- tools
- embeddings
- context window

Ollama is probed with its model inspection API. Native providers use provider model metadata where available. Generic compatible endpoints use explicit/inferred capability information and the real request remains the final authority.

### Privacy and provider policy

Global privacy modes:

- Local only
- Prefer local
- Automatic
- Cloud only

A book can override the global privacy mode.

A book can additionally apply:

- all providers allowed by privacy mode
- allow only selected providers
- deny selected providers

Privacy is evaluated before provider policy and before book content is sent.

### Secrets

Provider configuration is stored in SQLite. API keys are not.

Native secure storage is used:

- Windows Credential Manager
- macOS / iOS Keychain
- Linux native keyring
- Android secure storage is validated during the Android phase

### Usage and cost

LexiPane records locally:

- task
- model
- provider configuration
- input/output tokens when supplied by the provider
- latency
- estimated cost

Cloud pricing is an optional user-configurable input/output price per one million tokens. This avoids silently depending on stale pricing tables. The UI reports total, current-day, and current-month estimated cost plus local/cloud request counts.

## SQLite

The schema is versioned and migrated incrementally for existing databases. Fresh databases are created directly at the newest schema version instead of replaying historical ALTER statements.

Persistent domains include:

- books and book-level privacy/provider policy
- reading positions
- annotations
- Notebook notes
- personal reading feedback
- provider configuration
- AI usage/cache
- application settings and route/execution policy

## UI composition

Desktop uses a split reader: document on the left and structured contextual assistance on the right.

The AI settings surface manages:

- Ollama and configured providers
- secure credentials
- model discovery/capability inspection
- task routing and fallbacks
- timeout/retry policies
- global privacy
- pricing and usage estimates

The Reader surface owns per-book privacy/provider restrictions so those controls are visible where sensitive content is actually being read.

## Mobile boundary

Mobile will reuse the same Document/Annotation/Notebook/AI domain layers with touch-first selection and an AI bottom sheet instead of a permanent desktop split pane.
