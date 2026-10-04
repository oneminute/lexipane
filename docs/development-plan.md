# LexiPane Development Plan

This document is the authoritative development plan and active execution ledger for LexiPane.

All implementation work must follow the workflow in **Development protocol** below. Strategic summaries may also appear in `docs/roadmap.md`, but this file is the source of truth for the currently selected task and its execution status.

---

## Development protocol

### Mandatory pre-development step

Before changing application code, schema, build configuration, tests, or user-facing behavior:

1. Read this entire document, especially **Current Development Status**, the relevant milestone, dependencies, and acceptance criteria.
2. Confirm that the proposed work belongs to the selected milestone or explicitly change the selected milestone here first.
3. Update **Current Development Status** before implementation:
   - set the task/milestone being worked on;
   - set status to `IN_PROGRESS`;
   - record the intended scope;
   - record important dependencies or risks.
4. Only then begin implementation.

### Mandatory completion step

Before considering a development task finished:

1. Run the relevant validation gates.
2. Update **Current Development Status**:
   - `VERIFYING` while validation is incomplete;
   - `COMPLETE` only when acceptance criteria and required validation pass;
   - `BLOCKED` when an external or unresolved dependency prevents completion;
   - `DEFERRED` when intentionally postponed.
3. Record:
   - implementation summary;
   - validation/evidence;
   - known limitations;
   - next selected task.
4. Update milestone checkboxes/status below when scope materially changes.

### Status vocabulary

- `PLANNED` — specified but not selected for immediate work.
- `READY` — sufficiently specified and eligible to start.
- `IN_PROGRESS` — implementation is actively changing the repository.
- `VERIFYING` — implementation is present; validation is still running or incomplete.
- `BLOCKED` — cannot proceed without resolving a dependency.
- `COMPLETE` — acceptance criteria and required checks are satisfied.
- `DEFERRED` — intentionally postponed.

### Validation baseline

Unless a milestone explicitly requires more:

~~~bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
~~~

Schema/network/native-engine changes should add targeted tests or validation beyond the baseline where practical.

---

# Current Development Status

Last updated: **2026-10-04**

## Active program

**Resource Acquisition Platform / Resource Hub**

Status: **IN_PROGRESS**

**RESOURCE-001 — Resource Core** has started. This development pass is establishing the shared domain/persistence/UI/native contracts before any live network provider implementation.

## Most recently completed product work

Reader interaction hardening is live on `main`, including:

- persistent current-sentence state separate from transient text selection;
- sentence highlighting that can be reconstructed after EPUB/Kindle reflow;
- visible Previous sentence / Next sentence controls in the reading pane;
- Reader keep-alive across workspace navigation;
- bookmarks and persisted reading-position restore;
- reversible progress-bar peek mode;
- longer local-AI execution timeouts;
- structured-output recovery/fallback work for local models;
- viewport-contained Reader scrolling.

## Development status history

| Date | Task | Final status | Validation / evidence | Next |
| --- | --- | --- | --- | --- |
| 2026-10-04 | PLAN-001 — Establish authoritative development plan and Resource Hub roadmap | COMPLETE | Added `docs/development-plan.md`, root `AGENTS.md`, README workflow entry, and Resource Hub roadmap summary. Documentation-only change; no runtime validation required. | RESOURCE-001 |

## Next selected task

**RESOURCE-001 — Resource Core**

Status: **IN_PROGRESS**

Current implementation scope:

- establish provider/resource/transfer domain types;
- add versioned SQLite persistence for resource providers, items, sources, files, and transfer jobs;
- add the first Resources shell/page and navigation entry;
- implement resource URI/link classification without performing network transfers yet;
- define Rust/Tauri boundary contracts for future transfer engines;
- add tests for resource identity, URI classification, and schema migration.

Current risks / dependencies:

- SQLite migration must remain compatible with existing user databases.
- Native/Tauri contracts must not start network activity in RESOURCE-001.
- Resource identifiers and source provenance must remain provider-neutral so later cloud/P2P providers do not force schema rewrites.
- The Resource Hub shell must fit the existing desktop layout without destabilizing Reader keep-alive behavior.

Do **not** begin BitTorrent, ED2K, Google Drive, Dropbox, or OneDrive protocol implementation before RESOURCE-001 establishes these shared contracts.

---

# Product direction

LexiPane is evolving from a local AI-assisted reading application into an integrated:

**discover → inspect → acquire → verify → ingest → read → annotate → AI-assist**

workflow.

Network-resource support must not become several isolated download features. ED2K, BitTorrent, cloud storage, OPDS, HTTP, WebDAV, and future sources should share one Resource Acquisition Platform.

The UI name for this platform is **Resource Hub**, surfaced as **Resources** in the main navigation.

---

# Resource Acquisition Platform

## Core principles

1. **Separate discovery from transfer.**
   A source that can search does not have to perform the download itself.

2. **Normalize everything into shared resource objects.**
   Google Drive files, torrent entries, ED2K results, OPDS books, and HTTP URLs must become a common `ResourceItem` representation before the UI consumes them.

3. **Providers declare capabilities.**
   Search, browse, metadata resolution, preview, file listing, download, stream, upload, and authentication are independent capabilities.

4. **Network acquisition is a Rust/native responsibility.**
   Long-running transfers must not depend on a React `fetch()` surviving page/component lifecycle changes.

5. **Downloaded content enters the Library only through an ingestion pipeline.**
   Verification, real file-type detection, de-duplication, metadata extraction, and atomic movement happen before registration as a book.

6. **Content identity is source-independent.**
   SHA-256 plus protocol-native hashes identify duplicates and preserve provenance.

7. **Secrets do not live in SQLite.**
   OAuth refresh/access tokens and service credentials use OS secure credential storage.

8. **P2P is explicit.**
   BitTorrent/ED2K networking, upload/seeding behavior, bandwidth, DHT/PEX, proxy/interface choices, and privacy state must be visible and configurable.

9. **LexiPane does not ship piracy-specific catalogs.**
   Built-in discovery should favor user-owned storage, public-domain/open-access catalogs, and explicitly configured sources. Custom catalogs can plug into the provider framework.

---

# Unified domain model

## ResourceProvider

Conceptual TypeScript contract:

~~~ts
interface ResourceProvider {
  id: string;
  type: "catalog" | "storage" | "p2p" | "transport";

  capabilities: {
    search?: boolean;
    browse?: boolean;
    resolve?: boolean;
    preview?: boolean;
    fileList?: boolean;
    download?: boolean;
    stream?: boolean;
    upload?: boolean;
    authentication?: boolean;
  };
}
~~~

Initial/future provider families:

- Google Drive
- Dropbox
- OneDrive / SharePoint
- HTTP / HTTPS
- OPDS
- WebDAV / Nextcloud
- S3-compatible storage
- SFTP
- BitTorrent
- ED2K
- local/NAS adapters
- Internet Archive
- Project Gutenberg
- Standard Ebooks
- arXiv
- PubMed Central
- DOI/Crossref/Unpaywall
- Zotero
- RSS / Atom
- future user-configured catalogs

## ResourceItem

Every discovery result should normalize to a shared logical resource.

Suggested fields:

~~~text
id
title
authors
description

sourceProvider
sourceId

files[]
  name
  size
  mime
  extension

identifiers
  isbn
  doi
  sha256
  btih
  btmh
  ed2kHash

availability
  sourceCount
  peers
  seeders
  remoteAvailable

metadata
  language
  publisher
  year
  edition
  cover

rights
  publicDomain
  userOwned
  authorized
  unknown
~~~

## ResourceSource

A logical resource may have several acquisition sources.

Example:

~~~text
ResourceItem
  The History of the Decline and Fall of the Roman Empire.epub

ResourceSources
  Google Drive
  HTTPS
  BitTorrent
~~~

The UI should not duplicate the logical book merely because it is obtainable from multiple providers.

## ResourceFile

Represents individual files within a resource/container.

Important for:

- torrent file selection;
- cloud folders/bundles;
- ED2K results;
- archives;
- preview;
- choosing the actual EPUB/PDF without downloading unrelated media.

## TransferJob

Persistent transfer state:

~~~text
id
provider / transport
resource/source/file ids
state
progress
bytes total / completed
download rate
upload rate where applicable
error
created / started / completed timestamps
temporary path
destination
resume metadata
~~~

Transfers must survive React navigation and, where supported by the engine, application restart.

---

# Resource Hub UI

Main navigation:

~~~text
Library
Reader
Notebook
Resources
AI & Models
~~~

Primary Resource Hub tabs:

~~~text
Search
Browse
Downloads
Accounts
~~~

## Universal resource input

Provide a prominent field:

**Paste URL, magnet, ED2K link, cloud share link, or catalog address**

A `ResourceResolver` classifies inputs such as:

- `http://`
- `https://`
- `magnet:?`
- `ed2k://`
- `.torrent`
- Google Drive share links
- Dropbox share links
- OneDrive/SharePoint links
- OPDS catalog URLs
- WebDAV endpoints
- future schemes

Classification must be separate from actually starting a transfer.

## Federated search

One query can fan out to enabled discovery providers.

Filters should eventually include:

- All
- Books
- PDF
- EPUB
- MOBI/Kindle
- Documents
- Local
- Cloud
- Public/open
- P2P

Ranking inputs may include:

- relevance;
- language;
- format preference;
- edition;
- file quality;
- source trust;
- availability;
- already-in-library;
- rights/source status.

---

# Preview model

Preview is capability-graded rather than one Boolean.

## Preview levels

- **Level 0 — identity:** filename, size, protocol hash, source.
- **Level 1 — structure:** file list, format, metadata.
- **Level 2 — document preview:** cover, table of contents, PDF sample pages, EPUB metadata/content sample when legal and technically available.
- **Level 3 — progressive reading:** begin reading selected content before the entire transfer completes.

Providers declare which preview levels they support.

---

# Acquisition and ingestion pipeline

A completed transfer must not be registered directly as a Library book.

Required pipeline:

~~~text
Transfer complete
  ↓
Hash verification
  ↓
Real MIME/file-type detection
  ↓
Security validation
  ↓
Metadata extraction
  ↓
Cover extraction
  ↓
Duplicate detection
  ↓
Filename normalization where appropriate
  ↓
Atomic move into selected storage mode
  ↓
Register/update LexiPane Library
  ↓
Preserve resource provenance
~~~

Existing LexiPane components such as managed-library storage and SHA-256 book identity should be reused.

## Content identity

Store at least:

- SHA-256 for local acquired files;
- BitTorrent v1 infohash (BTIH) when applicable;
- BitTorrent v2 hash (BTMH) when applicable;
- ED2K hash when applicable;
- provider-native immutable/version identifiers where available.

This enables:

- duplicate prevention;
- source aggregation;
- moved/copied-resource recognition;
- remote-version comparison;
- provenance.

---

# Security baseline

Network acquisition expands LexiPane's attack surface. The following are requirements, not optional polish:

- no automatic execution of downloaded content;
- canonical path validation;
- path-traversal prevention;
- torrent/archive filename sanitization;
- real MIME/file-type validation instead of trusting extensions;
- archive/zip-bomb safeguards where archive support exists;
- maximum configurable file/transfer size;
- disk free-space checks;
- isolated temporary download directory;
- atomic final move;
- safe cleanup for canceled/failed jobs;
- explicit handling of executable/script content;
- no OAuth tokens or passwords in SQLite;
- provider/account disconnect and credential revocation flow.

Reader-supported formats may be admitted automatically only after validation. Other files remain generic resources unless the user explicitly handles them.

---

# Provider-specific plans

## BitTorrent

### Architecture

Treat **torrent discovery/catalogs** and **torrent transport** as different capabilities.

Transport accepts:

- magnet URI;
- `.torrent` metadata;
- infohash where resolvable.

Desired flow:

~~~text
Resolve magnet/torrent
  ↓
Fetch metadata
  ↓
Show torrent file tree
  ↓
Choose files
  ↓
Transfer
  ↓
Optional progressive preview
  ↓
Ingestion
~~~

### Engine direction

Preferred evaluation target: a Rust-native engine/library such as `librqbit`, because LexiPane already has a Rust/Tauri native layer.

Required capabilities before adoption:

- magnet metadata resolution;
- DHT where enabled;
- selective file download;
- pause/resume/cancel;
- persistent progress state;
- bandwidth information;
- streaming or prioritized pieces for future preview;
- controllable upload/seeding behavior;
- safe path handling.

LexiPane must not hard-code unauthorized torrent indexes. Discovery providers remain separately configurable.

## ED2K

Do not begin by implementing ED2K/Kad from scratch.

First implementation direction:

~~~text
LexiPane
  ↓
ED2K adapter
  ↓
aMuled / compatible sidecar
  ↓
ED2K / Kad
~~~

The adapter should expose normalized operations:

- search;
- search results;
- metadata/status;
- start download;
- pause;
- resume;
- cancel;
- progress/queue.

A native Rust ED2K/Kad implementation should only be considered later if the sidecar approach becomes a concrete product limitation.

## Cloud storage

Initial providers:

1. Google Drive
2. Dropbox
3. OneDrive / SharePoint

Required shared abilities:

- connect/disconnect account;
- browse;
- search;
- metadata;
- preview where supported;
- download;
- import into LexiPane;
- remember origin/provider identifiers.

Future:

- upload/sync back;
- remote change detection;
- remote-version comparison;
- watch folders.

OAuth secrets/tokens use the existing secure credential architecture.

## HTTP / HTTPS

HTTP is the simplest transfer provider and should be implemented early to validate the full transfer pipeline.

Features:

- HEAD/metadata probing;
- redirects;
- content length/type;
- resumable range requests when supported;
- checksum verification when provided;
- filename derivation;
- cancellation/retry;
- HTTPS-first security posture.

## OPDS / Calibre

OPDS is a high-value early discovery/acquisition provider because it maps naturally to book catalogs.

Use it to validate:

- browsing;
- search;
- metadata;
- covers;
- acquisition links;
- authentication where needed;
- multiple formats for one logical title.

---

# P2P settings

Planned Settings → Resources → P2P controls:

- Enable BitTorrent
- Enable ED2K
- download bandwidth limit
- upload bandwidth limit
- concurrent transfer limit
- upload/seeding policy
- DHT
- PEX
- network interface binding
- proxy
- storage/temp directories

P2P state must be explicit. Enabling a normal HTTP/cloud Resource Provider must not implicitly enable P2P networking.

---

# Persistence plan

Proposed SQLite domains:

- `resource_providers`
- `resource_accounts`
- `resource_items`
- `resource_files`
- `resource_sources`
- `transfer_jobs`
- `transfer_files`
- `resource_history`
- future `resource_identities` if identity normalization warrants a dedicated table

No access token, refresh token, API secret, or password may be stored in these tables.

---

# Native/Tauri boundary

Planned Rust module structure:

~~~text
src-tauri/src/resources/
  mod.rs
  manager.rs
  resolver.rs
  jobs.rs
  events.rs
  ingest.rs
  identity.rs
  security.rs

  transports/
    http.rs
    torrent.rs
    ed2k.rs
    cloud.rs
~~~

The exact module split may evolve, but React should consume stable Tauri commands/events rather than owning transfer lifecycles.

Planned native event categories:

- transfer created;
- metadata resolved;
- progress changed;
- paused/resumed;
- completed;
- failed;
- canceled;
- ingestion completed.

---

# Milestones

## RESOURCE-001 — Resource Core

Status: **IN_PROGRESS**

Goal: establish shared contracts before implementing any provider protocol.

Scope:

- Resource Hub navigation/page shell.
- TypeScript resource/provider/source/file/transfer types.
- URI/link/resource resolver and classification.
- SQLite vNext migration for Resource Core.
- Rust/Tauri resource module skeleton.
- provider capability registry.
- persistent transfer-job state model.
- source/provenance model.
- tests.

Acceptance criteria:

- Resources is reachable from the main navigation.
- A pasted URL/magnet/ED2K/share/catalog string is classified without starting a transfer.
- Provider capabilities can be registered and queried.
- Resource items/files/sources can be persisted and read.
- Transfer jobs can be persisted in non-running states.
- schema migration works on existing databases.
- no P2P socket or cloud OAuth flow is started by this milestone.
- baseline frontend/Rust validation passes.

## RESOURCE-002 — HTTP + OPDS vertical slice

Status: **PLANNED**

Goal: prove discovery → preview → download → ingestion → Library with comparatively simple protocols.

Scope:

- HTTP/HTTPS metadata + resumable download.
- OPDS catalog add/browse/search.
- metadata/cover/file-format preview.
- Download Manager first live engine.
- ingestion into managed/external Library storage.
- duplicate detection.

Acceptance criteria:

- acquire a legal/open EPUB/PDF from an HTTP or OPDS source;
- pause/cancel/retry where technically supported;
- restart-safe job metadata;
- resulting book opens in Reader;
- duplicate acquisition is detected.

## RESOURCE-003 — Cloud accounts

Status: **PLANNED**

Goal: connect user-owned cloud storage.

Initial order:

1. Google Drive
2. Dropbox
3. OneDrive / SharePoint

Scope:

- OAuth/account model;
- secure token storage;
- browse/search;
- file metadata;
- preview/download;
- import to Library;
- origin tracking.

Acceptance criteria:

- at least one provider completes end-to-end before adding the next;
- disconnect removes/revokes local credential material appropriately;
- no token stored in SQLite/logs.

## RESOURCE-004 — Download Manager hardening

Status: **PLANNED**

Goal: make transfers a durable native subsystem.

Scope:

- queue;
- concurrent limits;
- pause/resume/cancel;
- retry policy;
- restart recovery;
- disk-space checks;
- temp-file lifecycle;
- speed/ETA;
- notifications/events;
- storage settings.

## RESOURCE-005 — BitTorrent

Status: **PLANNED**

Goal: add native P2P transport after the common transfer layer is stable.

Scope:

- evaluate/integrate Rust torrent engine;
- magnet and `.torrent`;
- metadata resolution;
- file tree;
- selective download;
- queue/progress;
- privacy/bandwidth settings;
- optional progressive preview foundation.

Explicit non-goal:

- no built-in unauthorized torrent-search catalog.

## RESOURCE-006 — ED2K

Status: **PLANNED**

Goal: add ED2K search/acquisition using an adapter before considering native protocol work.

Scope:

- sidecar availability/configuration;
- network search;
- result normalization;
- start/pause/resume/cancel;
- queue/progress;
- file identity/provenance;
- ingestion.

## RESOURCE-007 — Advanced Preview

Status: **PLANNED**

Scope:

- remote PDF/EPUB sample preview where supported;
- torrent partial-file preview;
- prioritized pieces;
- begin reading before full acquisition when safe;
- temporary preview storage cleanup.

## RESOURCE-008 — Federated Resource Search

Status: **PLANNED**

Scope:

- parallel provider search;
- result merge;
- duplicate/source aggregation;
- filtering;
- source trust;
- format/language preferences;
- already-owned detection;
- cancellation/debouncing;
- per-provider health/latency.

## RESOURCE-009 — Extended Providers

Status: **PLANNED**

Candidates:

- WebDAV / Nextcloud
- S3-compatible
- SFTP
- Calibre/OPDS variants
- Zotero
- Internet Archive
- Project Gutenberg
- Standard Ebooks
- arXiv
- PubMed Central
- DOI/Crossref/Unpaywall
- RSS/Atom
- local/NAS integrations

## RESOURCE-010 — Smart Acquisition

Status: **PLANNED**

Goal: choose among equivalent sources intelligently.

Potential ranking signals:

- exact content identity;
- source reliability;
- transfer speed;
- availability;
- format preference;
- edition;
- file size/quality;
- rights status;
- already-authenticated provider;
- privacy/network policy.

AI may assist with title/author normalization, edition grouping, bilingual title matching, and query expansion, but acquisition correctness must not depend on an LLM.

---

# Longer-term Resource Hub extensions

## Remote synchronization

Preserve remote origin information after import so LexiPane can later detect:

- cloud file changed;
- new version available;
- remote file removed;
- local/remote divergence.

## Resource history

Track:

- searches;
- previews;
- acquisitions;
- failed transfers;
- source changes;
- duplicate detections.

History should be privacy-aware and locally stored by default.

## Personal resource search engine

Long-term Resource Hub can unify:

~~~text
Local Library
Google Drive
Dropbox
OneDrive
OPDS
Public/open catalogs
User-configured catalogs
ED2K
BitTorrent sources
~~~

into one searchable personal reading-resource index.

---

# Relationship to existing roadmap

The current Reader, Library, Notebook, AI Platform, and Personal Reading Model remain active product domains.

Resource Hub does not replace them. Its primary downstream integration point is the existing Library/managed-library pipeline:

~~~text
Resource Hub
  ↓
verified acquisition
  ↓
managed/external local file
  ↓
Library
  ↓
Reader
  ↓
Notebook / AI / personal reading state
~~~

Implementation status for Resource Hub is tracked here first and summarized in `docs/roadmap.md`.
