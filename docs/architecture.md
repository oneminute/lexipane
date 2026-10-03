# LexiPane architecture

## Design principles

LexiPane is not a chat window attached to a document viewer. The source document remains the primary reading surface and AI is a contextual assistance layer bound to stable locations in the book.

The architecture separates five concerns:

1. Document Engine — normalize PDF, EPUB and Kindle-style formats behind one reading model.
2. Annotation Engine — bind automatic terms, user selections, sentence analyses and region captures to stable document anchors.
3. Notebook Engine — preserve source text, AI explanations and user-authored notes separately.
4. AI Platform — route reading tasks to local or cloud models without coupling UI to any vendor.
5. Personal Reading Model — learn from Known, removed and manually-added terms.

## Runtime stack

- Tauri 2: desktop and mobile application shell.
- React + TypeScript: shared UI.
- Rust: native boundary, file/runtime integration and future document/native helpers.
- SQLite: local library metadata, positions, annotations, notes, provider configuration and usage records.

The first implementation target is desktop. Android and iOS should reuse the same domain services and responsive UI rather than becoming separate products.

## Document Engine

The future interface should expose a normalized model similar to:

~~~ts
interface DocumentEngine {
  open(source: BookSource): Promise<OpenedDocument>;
  getMetadata(): Promise<BookMetadata>;
  getToc(): Promise<TocItem[]>;
  getPageOrSection(locator: DocumentLocator): Promise<DocumentContent>;
  resolveAnchor(anchor: AnnotationAnchor): Promise<ResolvedAnchor | null>;
}
~~~

Planned backends:

- PDF: PDF.js first.
- EPUB: epub.js or a wrapped EPUB engine.
- MOBI/AZW/AZW3: parse or convert through a dedicated adapter, likely libmobi on the native side.

DRM-protected content is outside the initial scope.

## Annotation anchors

Never store only a page number and selected text.

PDF anchors should eventually include page, text item and character offsets, bounding rectangles, quote context and a context hash.

EPUB anchors should use CFI plus selected text and quote context.

Converted or reflowable formats should keep chapter/block IDs, offsets and a quote fallback.

The annotation record remains format-neutral by storing the engine-specific anchor as versioned JSON.

## AI Platform

The reader calls semantic operations such as:

- detect difficult terms
- explain word in context
- explain phrase in context
- analyze sentence
- explain passage
- analyze selected region or image
- summarize chapter
- answer a question about current context

The task layer does not import vendor clients directly.

Current executable adapters:

- Ollama
- generic OpenAI-compatible endpoint

Cataloged provider families include OpenAI, Anthropic Claude, Google Gemini, xAI Grok, OpenRouter, Mistral, Alibaba Qwen, DeepSeek, Kimi, GLM, MiniMax, Doubao, ERNIE, Hunyuan, LM Studio, llama.cpp, vLLM and LocalAI.

Provider-specific native adapters should be added when they unlock capabilities that should not be forced through a compatibility API.

Routing is task based, not global-model based. A typical user may route vocabulary, phrases and grammar to local Qwen while reserving vision or unusually difficult passages for another configured model.

Privacy modes:

- Local only
- Prefer local
- Automatic
- Cloud only

Cloud escalation must be visible to the user when selected content would leave the device.

## Secrets

Provider configuration belongs in SQLite, but API keys do not.

A SecretStore abstraction will use OS-provided secure storage:

- Windows Credential Manager
- macOS and iOS Keychain
- Linux Secret Service
- Android Keystore

Until that abstraction is implemented, no cloud API key should be persisted by the application.

## SQLite

Schema v1 reserves tables for books, reading positions, annotations, notes, known terms, provider configuration, task routing and AI usage.

Schema changes should move to numbered migrations before the first public release.

## UI composition

Desktop uses a true split workspace: document pane on the left and structured AI assistance on the right.

Mobile uses the same domain model with a reading-first layout and an AI bottom sheet or tab instead of forcing a horizontal split.

Structured AI cards come before free-form chat.

## Near-term implementation boundary

The current repository is a foundation scaffold. It intentionally does not pretend to render PDF or persist cloud credentials yet.

The next vertical slice is:

open PDF → render pages → select text → create stable anchor → show contextual explanation → persist annotation and reading position.
