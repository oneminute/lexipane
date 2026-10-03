# LexiPane roadmap

The roadmap is organized as vertical slices. Each phase should leave the application useful instead of adding disconnected infrastructure.

## Phase 0 — Foundation

Status: **complete for desktop development**

Implemented:

- Tauri 2 + React + TypeScript + Rust
- responsive desktop/mobile-aware shell
- SQLite schema v1
- Library, Reader, Notebook, and AI/Models surfaces
- provider registry
- Ollama adapter
- generic OpenAI-compatible adapter foundation
- Tauri HTTP transport for local Ollama without WebView CORS dependency
- architecture documentation
- GitHub Actions frontend and Rust checks
- Windows dependency-aware one-click launcher

## Phase 1 — PDF reader

Status: **mostly implemented**

Implemented:

- PDF.js integration
- native file picker
- native drag/drop routing
- Tauri filesystem access
- persisted runtime filesystem scopes
- real PDF canvas rendering
- continuous multi-page reading
- selectable text layer
- zoom controls
- current-page detection
- opened books persisted to SQLite and shown in the bookshelf
- reading-position persistence and restore
- selected PDF text routed into the AI pane
- persistent user highlights
- versioned PDF anchors with page, exact quote, prefix/suffix context, and normalized rectangles
- highlight removal from the current-page assistance panel

Still planned:

- table of contents
- PDF metadata/author extraction
- cover and thumbnail generation
- page virtualization/lazy rendering for very large PDFs
- encrypted/password PDF handling
- stronger quote-based highlight recovery if PDF.js text segmentation changes

## Phase 2 — Contextual AI reading

Status: **started; local selection analysis is live**

Implemented:

- Ollama connection through Tauri HTTP
- installed-model discovery
- persisted local-model preference
- preference for Qwen 3.5/Qwen when no model is configured
- selected-text context extraction
- surrounding-page context supplied to the local model
- contextual explanation
- grammar/structure analysis
- custom questions about the selection

Next:

- automatic difficult-word candidates
- phrase and collocation candidates
- configurable reader language level
- automatic word/phrase highlights
- Known / Remove feedback
- double-click sentence analysis
- structured-output validation
- AI result caching
- task router with per-task model selection
- cloud provider configuration and secure credentials
- streaming responses
- usage and cost accounting

Exit condition: a user can read an English book with useful automatic assistance rather than manually requesting help for every selection.

## Phase 3 — Notebook and region intelligence

Status: **Notebook foundation live**

Implemented:

- persistent Notebook
- source text kept separately from AI content
- AI explanation saved with a selection
- editable user-authored notes
- jump back from a note to its local book

Next:

- tags and filters
- note deletion/archive
- link notes directly to annotation anchors
- rectangular region selection
- text-layer extraction when possible
- OCR fallback for scanned regions
- multimodal model routing for charts, images, and formulas
- Markdown/PDF export

## Phase 4 — EPUB

- EPUB engine behind Document Engine interface
- CFI-based anchors
- reflow and font controls
- same annotation, AI, and Notebook workflow as PDF

## Phase 5 — MOBI / AZW / AZW3

- native parsing or conversion adapter
- normalized chapter/block anchors
- same Notebook and AI workflow

## Phase 6 — Mobile

- Android packaging first
- iOS packaging
- touch selection
- reading-first AI sheet
- open-with/file association flows
- mobile secret storage
- local/cloud model capability negotiation

## Phase 7 — Personal Reading Model

- known-term memory
- false-positive feedback
- manually-added difficulty feedback
- user-specific difficulty scoring
- CEFR/frequency/domain priors
- adaptive automatic highlighting

## AI provider milestones

Core:

- [x] Ollama provider
- [x] Tauri HTTP local transport
- [x] Ollama model discovery UI
- [x] persisted local model selection
- [x] generic OpenAI-compatible provider foundation
- [ ] secure API-key storage
- [ ] cloud-provider configuration UI
- [ ] streaming
- [ ] structured-output validation
- [ ] per-task router
- [ ] usage/cost dashboard

Native adapters:

- [ ] Anthropic Claude
- [ ] Google Gemini
- [ ] OpenAI provider-native capabilities where useful
- [ ] provider-specific multimodal/caching/reasoning controls
