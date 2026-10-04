# LexiPane roadmap

LexiPane is being built as vertical slices. Each phase should leave the application usable instead of adding disconnected infrastructure.

## Current status

Desktop development has moved beyond the prototype stage. The current main branch already contains live PDF, EPUB, MOBI/AZW/AZW3 reading paths, local/cloud AI routing, persistent annotations, Notebook, region analysis, secure provider credentials, streaming text responses, bookshelf progress, and the first personal reading model signals.

## Phase 0 — Foundation

Status: **complete for desktop development**

Implemented:

- Tauri 2 + React + TypeScript + Rust
- responsive desktop/mobile-aware shell
- versioned SQLite schema and migrations
- Library, Reader, Notebook, and AI/Models surfaces
- provider/model registry
- Ollama adapter
- generic OpenAI-compatible adapter
- native Anthropic adapter
- native Gemini adapter
- Tauri HTTP transport
- native OS credential storage for provider API keys
- GitHub Actions frontend and Rust checks
- Windows dependency-aware launcher with Rust bootstrap and icon generation

## Phase 1 — PDF reader

Status: **feature-complete for the first desktop release**

Implemented:

- PDF.js rendering
- native file picker and drag/drop
- persisted Tauri filesystem scopes
- continuous multi-page reading
- selectable text layer
- zoom controls
- current-page detection
- reading-position persistence and restore
- PDF metadata and author extraction
- table of contents navigation
- lazy rendering for large documents
- persistent user highlights
- automatic word/phrase highlights
- versioned anchors with page, exact quote, prefix/suffix context, and normalized rectangles
- quote-context anchor recovery when text-layer segmentation/layout changes
- bookshelf cover thumbnails
- protected/password PDF flow
- rectangular region capture
- real text extraction from regions when available
- multimodal region/image routing

Remaining PDF hardening:

- broader testing against damaged/encrypted/scanned PDFs
- performance profiling on very large image-heavy documents
- broader OCR accuracy testing and optional bundled OCR distribution

## Phase 2 — Contextual AI reading

Status: **desktop AI platform v1 complete**

Implemented:

- Ollama connection and installed-model discovery
- persistent local-model preference
- Qwen 3.5/Qwen preference when no local model is selected
- selected-text context extraction
- contextual word/phrase explanation
- sentence grammar and structure analysis
- double-click sentence analysis
- reader questions
- streaming text responses
- automatic difficult-word candidates
- phrase/collocation candidates
- configurable A2/B1/B2/C1 reading level
- automatic highlights
- Known / Remove / Difficult feedback
- structured JSON validation for automatic-difficulty results
- structured typed output for contextual explanations, grammar analysis, and reader questions
- dedicated structured AI result UI instead of free-form text blocks
- result cache
- per-task primary routing
- ordered per-task fallback chains
- Local only / Prefer local / Automatic / Cloud only global modes
- per-book privacy override with inheritance from the global policy
- local and cloud usage logging
- secure provider credentials
- configurable OpenAI-compatible providers
- native Anthropic and Gemini providers
- multimodal routing for region/image tasks
- structured multimodal region output
- model capability probing with provider metadata / Ollama inspection / compatible-model inference
- configurable timeout and transient-retry policy per task
- provider readiness diagnostics
- route-attempt diagnostics in reading results
- optional per-million-token pricing overrides
- total / today / monthly estimated cloud cost
- local-vs-cloud request counts
- per-book provider allow-only / deny policy in addition to privacy mode

Future AI-platform enhancements are non-blocking for desktop v0.1:

- provider-native prompt caching controls
- provider-native reasoning controls where useful
- automatic pricing catalogs with freshness/version tracking
- configurable monthly budgets and notifications
- more detailed usage breakdown by provider/model/task

## Phase 3 — Notebook and region intelligence

Status: **first full desktop workflow implemented**

Implemented:

- persistent Notebook
- source text, AI explanation, and user notes stored separately
- tags
- search
- note deletion
- jump from a note back to the exact PDF/EPUB/Kindle reading location
- Markdown export
- rectangular PDF region selection
- text-layer extraction
- local/cloud multimodal analysis for images, charts, formulas, and scanned text
- local Tesseract OCR fallback for selected regions and scanned PDF pages
- automatic OCR fallback when region vision analysis is unavailable
- durable content-addressed region/image attachments in app data
- note-asset persistence and Notebook image rendering
- shared attachment files retained until the final referencing note is deleted
- batch Markdown export of the current Notebook view
- explicit book and tag filters for targeted Markdown export

Next:

- Notebook asset cleanup/diagnostic tooling

## Phase 4 — EPUB

Status: **live**

Implemented:

- EPUB.js reader
- local EPUB loading
- metadata
- table of contents
- reflowable reading
- persisted font-size controls
- Light / Sepia / Dark reading themes
- Scrolled / Paginated reading modes
- EPUB cover extraction into the bookshelf
- CFI reading-position persistence
- CFI highlights
- selected-text AI assistance
- Notebook anchors
- automatic difficult-word/phrase assistance

Next:

- saved-CFI fallback to book start when a persisted location is invalid
- malformed saved-highlight CFI isolation so one bad anchor does not break the reader

Next:

- broader malformed-EPUB / CFI regression fixtures
- footnote / popup handling
- image zoom and richer internal-resource handling

## Phase 5 — MOBI / AZW / AZW3

Status: **live first implementation**

Implemented:

- MOBI/AZW/AZW3 parsing with local reader engine
- local chapter/spine navigation
- metadata
- reading-position persistence
- highlights
- Notebook anchors
- selected-text AI assistance
- automatic difficult-word/phrase assistance
- internal-link navigation
- shared persisted font-size controls
- Light / Sepia / Dark reading themes
- cover extraction into the bookshelf

Next:

- wider KF8/AZW3 compatibility testing
- better resource handling for unusual books

## Phase 6 — Mobile

Status: **not started beyond responsive UI architecture**

Planned:

- Android project initialization and packaging
- Android file-open/share flows
- touch selection and reading-first AI bottom sheet
- mobile secure credential validation
- mobile local/cloud model capability negotiation
- iOS initialization after Android stabilizes
- iOS file-open/share flows
- battery/memory-aware rendering and AI behavior

## Phase 7 — Personal Reading Model

Status: **started**

Implemented:

- known-term memory
- removed/suppressed-term memory
- manually-marked difficult-term memory
- feedback counts
- personalized difficult-term hints supplied to future automatic page analysis
- profile summary in AI settings

Next:

- lemma/sense distinction instead of only normalized surface text
- time decay and reinforcement
- per-domain vocabulary profiles
- false-positive/false-negative statistics
- local frequency and CEFR priors
- adaptive highlight density
- explicit import/export of the personal vocabulary profile

## Bookshelf

Implemented:

- automatic local book registration
- metadata and cover display
- reading progress
- search
- Recent filter
- Favorites
- Finished status
- SHA-256 content identity for newly opened/backfilled books
- automatic moved/renamed-book recognition when the same content is opened at a new path
- missing-file detection
- explicit relink flow with content verification when a stored hash is available
- optional "Copy into LexiPane Library" managed-storage mode
- content-addressed managed copies stored in the app data library
- managed-copy preference over external duplicates of the same book
- gradual background SHA-256 backfill for legacy library entries
- switch from a managed copy back to a hash-verified external file
- orphan managed-file cleanup with explicit storage cleanup control

Next:

- managed-library storage statistics and optional size limits

## AI provider milestones

Core:

- [x] Ollama
- [x] Tauri HTTP transport
- [x] Ollama model discovery
- [x] persisted model selection
- [x] generic OpenAI-compatible provider
- [x] native OS credential storage
- [x] provider configuration UI
- [x] streaming text
- [x] automatic-difficulty structured output validation
- [x] per-task primary routing
- [x] ordered fallback chains
- [x] global privacy modes
- [x] per-book privacy override
- [x] usage/token/latency logging
- [x] native Anthropic adapter
- [x] native Gemini adapter
- [x] local/cloud multimodal region routing
- [x] structured contracts for explain / grammar / ask
- [x] user-configurable pricing and estimated costs
- [x] structured multimodal region analysis
- [x] model capability probing
- [x] configurable timeout / transient retry policy
- [x] provider readiness and route diagnostics
- [x] per-book provider allow/deny policy
