# LexiPane roadmap

The roadmap is organized as vertical slices. Each phase should leave the application usable rather than adding disconnected infrastructure.

## Phase 0 — Foundation

Status: in progress

- Tauri 2 + React + TypeScript + Rust
- responsive desktop and mobile-aware shell
- SQLite schema v1
- library, reader, notebook and AI settings surfaces
- provider catalog
- Ollama adapter
- generic OpenAI-compatible adapter
- architecture documentation
- baseline CI

Exit condition: a fresh clone can install dependencies, typecheck, test, build the frontend and launch the Tauri shell.

## Phase 1 — PDF reader

- PDF.js integration
- open and drag-drop PDF
- page and continuous modes
- zoom
- table of contents
- text layer and selection
- reading-position persistence
- add opened PDF to local library
- cover and thumbnail generation

Exit condition: LexiPane is a competent local PDF reader before AI is required.

## Phase 2 — Contextual AI reading

- automatic difficult-word candidates
- phrase and collocation candidates
- configurable reading level
- user add and remove annotation
- Known feedback
- context-aware word and phrase explanation
- sentence selection
- grammar and meaning structure analysis
- structured model output
- AI result caching

Exit condition: a user can read an English PDF and get useful assistance without copying text into a chat application.

## Phase 3 — Notebook and region intelligence

- unified notebook
- manual notes beside AI content
- tags
- rectangular region selection
- text-layer extraction when possible
- OCR fallback for scanned regions
- multimodal model route for charts, images and formulas
- Markdown export

## Phase 4 — EPUB

- EPUB engine behind Document Engine interface
- CFI-based anchors
- reflow and font controls
- same annotation and AI workflow as PDF

## Phase 5 — MOBI, AZW and AZW3

- native parsing or conversion adapter
- normalized chapter and block anchors
- same notebook and AI workflow

## Phase 6 — Mobile

- Android packaging first
- iOS packaging
- touch selection
- reading-first AI sheet
- open-with and file association flows
- mobile secret storage
- local/cloud model capability negotiation

## Phase 7 — Personal Reading Model

- known-term memory
- false-positive feedback
- manually-added difficulty feedback
- user-specific difficulty scoring
- CEFR, frequency and domain priors
- adaptive automatic highlighting

## AI provider milestones

Core compatibility adapters:

- [x] Ollama foundation
- [x] Generic OpenAI-compatible foundation
- [ ] provider configuration UI
- [ ] secure API-key storage
- [ ] model discovery UI
- [ ] streaming
- [ ] structured-output validation
- [ ] task router
- [ ] cost and usage dashboard

Native adapters:

- [ ] Anthropic Claude
- [ ] Google Gemini
- [ ] provider-specific multimodal, caching and reasoning controls

The registry already contains major global, China-cloud and local provider families. Catalog presence does not mean every provider-native feature is implemented.
