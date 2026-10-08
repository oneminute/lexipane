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

Last updated: **2026-10-07**

## Active program

**LONGRUN-001 — Network Resources + Reader AI Persistence**

Status: **IN_PROGRESS**

This is a continuous implementation batch authorized to proceed without per-feature confirmation.

Two workstreams are tracked in this batch:

1. **Resource Acquisition Platform** — HTTP/OPDS is complete; cloud accounts/shared links, BitTorrent, WebDAV, S3, SFTP, public/open discovery, federated search, and native ED2K Server/UDP Global/Kad search are implemented on the shared pipeline. Download Manager hardening remains partially open. Native ED2K/Kad search is implemented and awaiting one local live-network smoke test; the next code milestone is selected-file source discovery.
2. **Reader AI persistence** — **COMPLETE** for the requested scope: every current-sentence explanation uses versioned SQLite history first, Regenerate appends immutable versions, Older/Newer browse saved versions without inference, configurable look-ahead pre-generation writes every successful result immediately, and history uses stable Library book identity when available.

RESOURCE-002 and Reader AI persistence are **COMPLETE**. RESOURCE-004 remains **IN_PROGRESS**. RESOURCE-006K remains **VERIFYING** only for a local Windows/Tauri live-network smoke test and no longer blocks implementation of the next native ED2K phase.

### Active product priority

**RESOURCE-006S — Native ED2K/Kad source discovery**

Status: **VERIFYING**

Implementation summary:

- added a normalized NativeEd2kSource model shared by ED2K Server and Kad discovery, preserving public endpoint, TCP/UDP ports, origin/provenance, HighID/LowID state, server context, Kad source/user ID, source type, encryption flags, and buddy callback metadata needed by the later native transfer phase;
- added resource_ed2k_native_discover_sources plus the TypeScript discoverNativeEd2kSources(...) transport API; the command is discovery-only and does not start transfer, publish files, or keep a background Kad participant alive;
- implemented bounded ED2K Server OP_GETSOURCES lookup after normal server login, parses OP_IDCHANGE TCP capability flags, rejects login responses with no assigned client ID, and parses OP_FOUNDSOURCES into direct HighID or server-callback LowID source records;
- fixed the ED2K Server source request wire format to include the exact file size: files at or below the ED2K legacy limit (4,290,048,000 bytes) use hash + u32 size; files above that protocol limit use hash + 0u32 + u64 size and are sent only to servers advertising SRV_TCPFLG_LARGEFILES;
- source lookup now receives the selected search result's reporting-server provenance and queries those servers first, then fills the bounded query set from the normal ranked server.met list; Kad provenance labels are intentionally ignored as server hints;
- implemented Kad2 selected-file source lookup using the ED2K file hash as the Kad target, the standard 26-byte SEARCH_SOURCE_REQ payload (target + startPosition + uint64 filesize), the existing bounded bootstrap/FIND_VALUE routing flow, and KADEMLIA2_SEARCH_RES parsing;
- Kad source parsing supports actionable source types 1/3/4/5/6, preserves direct-UDP callback and buddy callback metadata, rejects missing TCP ports, private/local endpoints, wrong file-size class, mismatched published file sizes, incomplete buddy tuples, invalid type-6 callback capability, and responses from nodes that were not actually queried;
- server and Kad results are merged with a protocol-neutral identity key; matching IP:TCP endpoints enrich one record with UDP/source-type/encryption/provenance metadata instead of creating duplicates, while LowID/callback identities are kept separate when they cannot be safely proven identical;
- added explicit API diagnostics for direct, callback/firewalled, server-provenance, and Kad-provenance source counts plus bounded network errors; partial success is preserved if either Server or Kad discovery path is unavailable;
- Resource Hub is now Native ED2K Phase 4: each native search result has **Find native sources**, displays source counts, direct/callback classification, server/Kad lookup diagnostics, endpoint/callback metadata, and the first bounded network diagnostic messages;
- source-discovery UI requests are single-flight and reset on a new ED2K search so stale responses cannot repopulate results from an earlier query.

Validation / evidence:

- CI run 37687595426 passed frontend checks, Linux cargo check + cargo test --lib, and Windows cargo check + cargo test --lib for the first complete Server+Kad callback-validation slice;
- a later deterministic test expansion exposed one missed expected_size test argument on both Linux and Windows; commit a953abcf fixed that compile/test issue, and its successor CI completed successfully across frontend, Linux Rust, and Windows Rust gates;
- targeted tests now cover the exact ED2K legacy large-file boundary and Server source request encoding, large-file capability rejection, source-response parsing, public/private address filtering, source merging, result-server prioritization, Kad file-target conversion, Kad source request layout, HighID sources, firewalled buddy metadata, published-size identity guards, TCP-port requirements, and file-size/source-type compatibility;
- later commits add protocol-correct Server filesize requests, server provenance prioritization, stricter Kad source validation, explicit source counts, UI diagnostics, and the exact 4,290,048,000-byte ED2K legacy large-file boundary; final CI run 37711492067 on main commit 505030cc completed successfully with Frontend checks, Rust check (Linux), and Rust check (Windows) all passing.

Remaining verification:

- cross-platform CI is complete on the current main head; no CI blocker remains for RESOURCE-006S;
- run one local Windows/Tauri live-network smoke test: perform native ED2K search, choose a real result, click **Find native sources**, and confirm that Server and/or Kad diagnostics return plausible source records or explicit network timeouts without starting a download;
- live-network failure alone does not invalidate deterministic protocol completion when the local ED2K/Kad network is blocked, but the UI must surface that condition clearly.

Dependencies / risks:

- ED2K Server/Kad availability varies and UDP may be filtered by the local firewall/router;
- Server LowID, Kad buddy-callback, and Kad direct-UDP-callback sources are preserved for the next transfer milestone but are intentionally not treated as ordinary direct TCP endpoints;
- native part/block negotiation, queueing, piece verification, callback execution, publishing, and long-lived Kad participation remain outside RESOURCE-006S.

**RESOURCE-006K — Native Kad bootstrap and keyword search**

Status: **VERIFYING**

Implementation summary:

- added a native Rust Kad2 search module with no aMule runtime dependency;
- downloads and caches a current `nodes.dat` bootstrap list under the same Resource ED2K app-data area, with six-hour freshness, stale-cache fallback, bounded size/contact counts, and support for modern nodes.dat v1/v2/v3 formats including v3 bootstrap edition;
- parses Kad contacts with correct little-endian IPv4 encoding, deduplicates UDP endpoints, prefers newer contact records, and rejects loopback/private/link-local/documentation/multicast/broadcast destinations learned from bootstrap/routing data;
- creates an ephemeral local Kad identity for each search session rather than joining/publishing as a long-lived node;
- implements Kad UInt128 wire conversion, XOR-distance ordering, aMule-compatible first-keyword MD4 targeting, bounded keyword tokenization, and ED2K hash reconstruction from Kad result identities;
- implements Kad2 UDP framing for `KADEMLIA2_BOOTSTRAP_REQ/RES`, `KADEMLIA2_REQ/RES`, and `KADEMLIA2_SEARCH_KEY_REQ/SEARCH_RES`;
- implements current v6+ NodeID-based Kad UDP obfuscation using MD5-derived RC4 framing, plus plaintext and zlib-packed Kad2 response decoding;
- performs bounded bootstrap discovery, three iterative FIND_VALUE routing rounds, then keyword requests against the closest known contacts to the keyword target;
- parses Kad keyword tag lists into the existing `NativeEd2kSearchResult` model, builds canonical `ed2k://` links, and locally enforces all search terms against returned filenames;
- runs Kad search in parallel with existing TCP seed + UDP Global Search; Kad failure remains a partial failure and does not break Server/Global results, while a Kad-only responding path can still return results if ED2K servers are unavailable;
- merges Kad + TCP + UDP Global results by ED2K hash + file size using the existing result merger;
- Resource Hub is now Native ED2K Phase 3 and displays TCP, UDP Global, Kad bootstrap, Kad lookup, Kad keyword, contacts loaded/discovered, and nodes.dat source diagnostics.

Validation / evidence:

- module-compilation CI run `37558089320` passed frontend checks, Linux `cargo check` + `cargo test --lib`, and Windows `cargo check` + `cargo test --lib`;
- final Kad code CI run `37558784573` passed frontend `npm run typecheck`, `npm test`, and `npm run build`;
- the same final run passed Linux and Windows `cargo check` + `cargo test --lib`;
- targeted Rust tests cover nodes.dat v3 bootstrap parsing, Kad MD4 keyword hash, UInt128/NodeID encryption round-trip, Kad lookup-contact parsing, Kad keyword result -> ED2K identity conversion, contact deduplication, and local/private-address rejection.

Remaining verification:

- perform one local Windows/Tauri live search to verify current nodes.dat retrieval plus real Kad bootstrap/lookup/keyword responses under the user's network/firewall environment.

Known limitations / next phase:

- this is ephemeral search-only Kad participation: no publishing, persistent routing table, background keepalive, source publishing, or firewall-state participation;
- selected-file source discovery is not implemented yet;
- native part/block transfer is not implemented yet;
- aMule remains optional only as a temporary download fallback after native discovery;
- next ED2K milestone after live-search verification is `RESOURCE-006S — Native ED2K/Kad source discovery`.


**RESOURCE-006G — Native ED2K Global Search**

Status: **VERIFYING**

Implementation summary:

- extended the native ED2K engine from direct TCP server search to ED2K UDP Global Search;
- parses `ST_UDPFLAGS` from server.met and chooses `OP_GLOBSEARCHREQ2 (0x92)` for servers advertising extended file search, with legacy `OP_GLOBSEARCHREQ (0x98)` fallback;
- sends standard unencrypted ED2K UDP packets to server TCP-port + 4, without requiring aMule, External Connections, or a persistent sidecar;
- parses `OP_GLOBSEARCHRES (0x99)` including multiple concatenated `E3 99 + result` records in one UDP datagram;
- runs bounded TCP seed search and bounded UDP global expansion concurrently, with independent timeouts and partial-success behavior;
- excludes TCP seed servers from the UDP expansion set so the global phase broadens coverage instead of repeating the same servers;
- merges TCP + UDP results by ED2K hash and file size while preserving source counts, complete-source counts, and responding-server identities;
- Resource Hub now displays separate TCP and UDP-global response counts and labels the native search path as Phase 2;
- federated Resource Search automatically benefits from the same global ED2K expansion without any ED2K account configuration.

Validation / evidence:

- final CI run `37554195198` passed `npm run typecheck`, `npm test`, and `npm run build`;
- the same run passed Linux `cargo check` and `cargo test --lib`;
- the same run passed Windows `cargo check` and `cargo test --lib`;
- targeted Rust tests cover UDP capability parsing from server.met, extended-vs-legacy UDP opcode selection, multi-result UDP datagram parsing, TCP framing/search parsing, and cross-server result deduplication.

Remaining verification:

- one local Windows/Tauri live search is still required to confirm real public ED2K servers respond to the combined TCP + UDP Global Search path under the user's network/firewall environment.

Known limitations / next phase:

- Kad is not implemented yet;
- native source lookup and native file transfer are not implemented yet;
- aMule remains optional only as a temporary download fallback after native search;
- the next selected ED2K task is `RESOURCE-006K — Native Kad bootstrap and keyword search`.


**RESOURCE-006N — Native ED2K search engine**

Status: **VERIFYING**

User decision: aMule is no longer the default ED2K backend. LexiPane now contains a native Rust ED2K Server Search implementation; the existing aMule adapter remains only as an optional compatibility/download fallback until native transfer support is implemented.

Implementation summary:

- added a native ED2K TCP protocol module with bounded packet decoding, zlib-packed packet support, old/new ED2K tag decoding, login framing, prefix-tree keyword search encoding, and search-result parsing;
- added current server.met download + six-hour app-data cache with stale-cache fallback and parser support for IP/dynamic-host entries, preference/failure/user/file metadata;
- native search connects directly to several ED2K servers with bounded connect/login/search timeouts, sends OP_LOGINREQUEST + OP_SEARCHREQUEST, waits for OP_IDCHANGE / OP_SEARCHRESULT, and tolerates partial server failures;
- results expose filename, size, ED2K hash/link, sources, complete sources and responding servers; duplicate hash+size results are merged and Reader formats are ranked ahead of non-book results;
- Reader-format detection covers PDF, EPUB, MOBI, AZW and AZW3;
- Resource Hub Browse now presents **LexiPane Native ED2K** as the default search UI with no aMule setup requirement;
- Resource Hub federated Search also always queries the native ED2K source, independent of configured accounts;
- aMule search/configuration remains behind a compatibility/fallback section, and can temporarily download a native search result by ED2K link while the native downloader is not yet implemented.

Validation / evidence:

- native protocol commit CI has passed Linux `cargo check` and `cargo test --lib`, including unit coverage for TCP framing, multi-word search expression encoding, server.met parsing, search-result tag parsing and cross-server deduplication;
- final frontend commit CI run 37413251250 passed `npm run typecheck`, `npm test`, and `npm run build`;
- the first Windows Rust run was blocked only by Tauri's missing repository `src-tauri/icons/icon.ico`; CI now creates a validation-only minimal icon and the replacement Windows `cargo check/test` run is executing past that prerequisite;
- a local Windows/Tauri live-search smoke test is still required to verify public server.met retrieval, real ED2K server login, and OP_SEARCHRESULT compatibility.

Known limitations / next phases:

- this batch implements direct ED2K Server Search, not Kad;
- native file/source download is not implemented yet, so Download can temporarily hand an ED2K link to the optional aMule fallback; without aMule the result link can be copied;
- next native phases are Global Search hardening, Kad bootstrap/keyword search, then native source lookup and part/block download.


### Active regression hotfix

**READER-NAV-RESUME — Preserve reading position across main-view navigation**

Status: **VERIFYING**

Root cause:

- Reader is intentionally kept mounted while other main views are shown, but its keep-alive wrapper uses `display:none`;
- epub.js and PDF visibility/layout observers can react to the resulting zero-size layout and emit relocation/visible-page changes that are not real user navigation;
- those callbacks previously continued updating/saving Reader position while the Reader was hidden, allowing the last foreground position to be overwritten.

Implementation summary:

- App now explicitly tells ReaderView whether Reader is the active foreground main view;
- ReaderView keeps a synchronous foreground-state ref so EPUB/PDF/Kindle position callbacks ignore layout-driven events as soon as Reader is hidden;
- the last valid foreground PDF page, EPUB CFI, or Kindle chapter is retained separately from hidden renderer state;
- on leaving Reader, any pending debounced EPUB save is flushed immediately before hidden-layout events can interfere;
- if a progress-scrub peek is active, the protected pre-peek location is retained rather than the temporary browse location;
- when returning to Reader, LexiPane waits for the keep-alive wrapper to regain layout, dispatches resize, and then actively restores the protected target;
- EPUB and Kindle navigation targets are briefly cleared before restoration so returning to the same prior target still produces a fresh navigation request;
- existing bookmark/progress navigation and EPUB 600 ms scroll-write debounce remain intact.

Validation / evidence:

- implementation commits: `b1ad50c` and `dde744c`;
- CI run `37631677296` passed frontend `npm run typecheck`, `npm test`, and `npm run build`;
- Rust/Linux/Windows repository gates are still completing, although this hotfix contains no Rust changes.

Remaining verification:

- local Windows/Tauri smoke test: open a book, move to a recognizable reading location, switch Reader → Library/Resources/AI → Reader, and confirm the same location is restored;
- repeat for the affected EPUB; PDF/Kindle should also retain their format-native stored target;
- verify the earlier EPUB mouse-wheel snap-back does not return.

Known limitation:

- Kindle position persistence is currently chapter-based rather than a fine-grained within-chapter locator; this hotfix preserves the existing Kindle position model rather than redesigning it.

**BUILD-VITE-IPV4 — Make Windows dev-server binding resilient**

Status: **VERIFYING**

Observed failure sequence:

- first local Windows launch failed on `::1:1420`, confirming the implicit localhost/IPv6 bind was unusable;
- after switching both Vite and Tauri to `127.0.0.1:1420`, the next local launch failed with `listen EACCES: permission denied 127.0.0.1:1420`;
- this confirms TCP port 1420 itself is reserved/excluded or otherwise unavailable on the user's Windows installation, so another fixed port would only move the same fragility.

Implementation summary:

- Vite now reads its strict dev port from `TAURI_DEV_PORT`, defaulting to 1420 only when launched directly without the Windows launcher;
- the Windows launcher probes 1420 and, when Windows refuses/reserves it, binds a temporary loopback listener on port 0 so Windows chooses a usable ephemeral port;
- the selected port is exported to Vite and printed as `Dev : http://127.0.0.1:<port>`;
- desktop startup writes a temporary Tauri JSON override with `build.devUrl` pointing to exactly the same selected port, invokes `tauri dev --config <temp-file>`, and removes the override afterward;
- an explicit user `TAURI_DEV_PORT` is still supported but is validated before startup and rejected early if unavailable;
- explicit `TAURI_DEV_HOST` / `TAURI_DEV_HMR_PORT` support remains available;
- Windows CI now parses `scripts/windows/start-lexipane.ps1` without executing it, so launcher syntax regressions are caught before local use.

Validation / evidence:

- dynamic-port implementation commits: `0a47f00` and `60e61db`;
- frontend typecheck/tests/build have already passed on the dynamic-port commits;
- final CI including the new Windows launcher parser is queued/running;
- one local Windows `start-lexipane.cmd` smoke test is still required before COMPLETE.

Known limitation:

- there is a very small race between releasing the probe listener and Vite rebinding the selected ephemeral port; if another process claims it in that interval, rerunning the launcher will choose another port.

**DB-SCHEMA-REPAIR — Repair v12/v13 sentence AI schema upgrade ordering**

Status: **VERIFYING**

Implementation summary:

- existing databases now run versioned migrations before latest-schema indexes are created;
- a targeted idempotent repair detects a v12-shaped `sentence_ai_versions` table that was already stamped v13, adds `book_id`, and backfills it from `books.file_path` without deleting user data;
- latest schema tables/indexes are applied only after migrations and repair complete;
- removed the unused S3 initial assignment and unused torrent runtime `file_index` field that produced the two Windows compiler warnings.

Validation / evidence:

- the original `no such column: book_id` error is no longer reported on the user's existing database;
- the local Windows smoke test now exposes a second regression: SQLite `code: 5 database is locked` during Ollama model discovery/Test LLM;
- current investigation focuses on manual multi-call `BEGIN IMMEDIATE` transactions executed through the plugin-sql/sqlx connection pool.

Implementation summary:

- removed every frontend `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` sequence from database migrations, sentence AI history, and Resource Hub bundle persistence;
- migrations now autocommit statement-by-statement, tolerate an already-applied `ALTER TABLE ... ADD COLUMN`, and stamp the schema version only after all migration statements complete;
- schema drift repair always finishes the `book_id` backfill, including after an interrupted earlier launch;
- sentence AI version allocation and insertion now happen in one SQLite `INSERT ... SELECT COALESCE(MAX(version_no), 0) + 1` statement;
- Resource Hub bundle writes remain retry-safe through idempotent upserts without holding a cross-call transaction lock.

Validation / evidence:

- final CI run 37409103606 has passed frontend typecheck, tests, and production build;
- Linux and Windows Rust checks are still running on that final commit;
- local Windows/Tauri verification is required after fully closing the pre-fix LexiPane process so its previously acquired SQLite lock is released.

Known limitation:

- if an old LexiPane process is still running with the pre-fix code, its OS-level SQLite lock persists until that process exits; the new code cannot release a lock owned by an already-running old process.

**BUILD-WINDOWS-OPENSSL — Remove unintended Perl/OpenSSL build dependency on Windows**

Status: **VERIFYING**

Implementation summary:

- changed `ssh2` back to its default feature set, removing the global `vendored-openssl` feature;
- Windows therefore uses libssh2's WinCNG backend instead of compiling vendored OpenSSL with Perl;
- Unix continues to use the platform OpenSSL dependency path already covered by Linux CI;
- added a dedicated `windows-latest` Rust `cargo check` + library-test job to CI.

Validation / evidence:

- manifest-level root cause is removed in commit `0a886e4`;
- Windows CI coverage was added in commit `d36d812`;
- latest cross-platform CI run is executing the new Windows Rust gate; frontend and Linux/Rust validation remain in the same workflow.

Known limitation:

- the new Windows job must finish successfully, followed by one local `start-lexipane.cmd` smoke test, before marking this regression COMPLETE.

**READER-EPUB-SCROLL-STABILITY — Stabilize mouse-wheel scrolling and reading-position persistence**

Status: **VERIFYING**

Implementation summary:

- disabled Chromium scroll anchoring on the EPUB host, epub.js manager container, and rendered section documents so continuous `scrolled-doc` layout changes do not pull the viewport back toward an earlier section;
- kept resume-from-last-position behavior and explicit Bookmarks/Contents/progress navigation intact;
- changed automatic EPUB reading-position persistence from one SQLite write per relocation event to a 600 ms trailing debounce, while keeping the visible current position/progress synchronous;
- flushes the latest pending reading position when the active book changes or the Reader unmounts.

Validation / evidence:

- GitHub Actions CI run 37405995032 passed frontend `npm run typecheck`, `npm test`, and `npm run build`;
- the same run passed `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path src-tauri/Cargo.toml --lib`;
- no schema or native-code changes were required.

Known limitation:

- CI cannot reproduce a physical mouse-wheel interaction inside the Windows Tauri WebView with the affected EPUB; one local smoke test of rapid upward/downward scrolling across a chapter boundary remains before marking the regression fully COMPLETE.

Dependencies / risks:

- EPUB rendering uses epub.js 0.3.93 continuous management, which dynamically inserts/removes section iframes;
- Chromium scroll anchoring can fight those layout changes and produce visible snap-back;
- the fix must not disable ordinary scrolling or explicit `rendition.display()` navigation.

## Most recently completed product work

**RESOURCE-001 — Resource Core** is complete on `main`.

Delivered:

- provider-neutral resource/provider/source/file/transfer contracts;
- builtin provider capability registry with every live transport disabled;
- non-networking input classification for web, OPDS hints, cloud share links, magnet/torrent, ED2K, WebDAV, S3, and SFTP;
- provider-neutral identity normalization;
- SQLite schema v10 Resource Core tables/migration;
- Resource Core persistence services and inert draft transfer jobs;
- Rust/Tauri Resource Core capability boundary;
- Resources main-navigation entry and Search / Browse / Downloads / Accounts shell;
- targeted resolver, identity, provider-registry, and schema migration tests.

## Continuous batch status

**LONGRUN-001 — Network Resources + Reader AI Persistence**

Status: **IN_PROGRESS**

Execution policy for this batch:

- do not pause for routine design choices or milestone transitions;
- choose implementation defaults autonomously and record them here;
- keep provider-specific code behind the Resource Core contracts;
- prefer working end-to-end vertical slices over placeholder-only UI;
- when an external prerequisite cannot be supplied by code alone (for example provider OAuth client credentials), complete the reusable implementation and clearly mark only that external activation step blocked;
- keep baseline and targeted tests running throughout the batch.

Reader AI acceptance criteria:

- successful sentence explanations are always persisted in SQLite;
- sentence selection checks versioned SQLite history before making an AI request;
- existing legacy `ai_cache` responses may be imported into sentence history on first use;
- Regenerate bypasses cached/history output, performs a new inference, and appends a new immutable version;
- users can browse older/newer explanation versions without another AI call;
- after the current sentence is available, LexiPane pre-generates the next configurable number of sentences in the same text context;
- pre-generation skips sentences already present in the version store and saves every successful result immediately;
- background pre-generation never replaces the currently displayed sentence/result.

Network-resource batch priorities:

- complete RESOURCE-002 validation;
- strengthen persistent download manager state and recovery;
- add cloud/shared-link provider support that can work without provider-specific secrets where possible;
- implement reusable OAuth/account contracts for Google Drive, Dropbox, and OneDrive so activation only needs client credentials;
- integrate a Rust BitTorrent engine if dependency/build constraints allow;
- implement an ED2K sidecar adapter boundary and control path;
- add extended catalog/storage providers where they reuse the HTTP pipeline;
- add federated search/result aggregation after at least two searchable providers are live.

## Development status history

| Date | Task | Final status | Validation / evidence | Next |
| --- | --- | --- | --- | --- |
| 2026-10-04 | PLAN-001 — Establish authoritative development plan and Resource Hub roadmap | COMPLETE | Added `docs/development-plan.md`, root `AGENTS.md`, README workflow entry, and Resource Hub roadmap summary. Documentation-only change; no runtime validation required. | RESOURCE-001 |
| 2026-10-04 | RESOURCE-001 — Resource Core | COMPLETE | Resource contracts, provider registry, resolver, identity, SQLite v10 persistence, draft jobs, native boundary, Resources UI shell. `npm run typecheck`, `npm test`, `npm run build`, and `cargo check --manifest-path src-tauri/Cargo.toml` all passed in CI run 37220879280. | RESOURCE-002 |
| 2026-10-05 | RESOURCE-002 — HTTP + OPDS vertical slice | COMPLETE | Native resumable HTTP, OPDS browse/search/navigation, persistent jobs, verified ingestion, duplicate detection, Reader-format validation, restart recovery. Repeated full CI passes include frontend typecheck/tests/build plus Rust check/tests; latest pre-cleanup full main validation passed before LONGRUN continuation. | RESOURCE-004 |
| 2026-10-05 | READER-AI-HISTORY — Versioned sentence explanations | COMPLETE | SQLite `sentence_ai_versions`, stable book-id association, DB-first lookup, Regenerate/new immutable version, Older/Newer browsing, configurable look-ahead pre-generation, PDF cross-page prefetch, and removal of retired automatic difficult-term code. | RESOURCE-004 |
| 2026-10-05 | READER-EPUB-SCROLL-STABILITY — Mouse-wheel snap-back regression | VERIFYING | Disabled scroll anchoring across the epub.js continuous rendition; debounced automatic reading-position writes to 600 ms; CI run 37405995032 passed frontend typecheck/tests/build and Rust check/tests. Local Windows/Tauri mouse-wheel smoke test remains. | READER-EPUB-SCROLL-STABILITY |
| 2026-10-06 | RESOURCE-006N — Native ED2K Server Search | VERIFYING | Native Rust ED2K TCP search, server.met cache, result normalization, Resource Hub integration, and targeted protocol tests implemented; frontend/Linux/Windows CI gates passed after Windows icon validation fix. Local live-network smoke test remains. | RESOURCE-006G |
| 2026-10-06 | RESOURCE-006G — Native ED2K UDP Global Search | VERIFYING | Added UDP Global Search with capability-aware opcodes, merged TCP/UDP results, diagnostics, and cross-platform CI/test coverage. Local live-network smoke test remains. | RESOURCE-006K |
| 2026-10-07 | RESOURCE-006K — Native Kad bootstrap and keyword search | VERIFYING | Native Kad2 bootstrap, iterative lookup, keyword search, UDP obfuscation/decoding, result merge and diagnostics implemented; final frontend/Linux/Windows CI and targeted Rust tests passed. Local Kad smoke test remains. | RESOURCE-006S |
| 2026-10-07 | READER-NAV-RESUME — Preserve Reader position across main-view navigation | VERIFYING | Foreground guards, exact PDF/EPUB/Kindle restoration helpers, Kindle in-chapter preservation, and targeted tests landed; local Windows/Tauri format smoke tests remain. | RESOURCE-006S |
| 2026-10-07 | RESOURCE-006S — Native ED2K/Kad source discovery | VERIFYING | Native Server + Kad selected-file source discovery, callback metadata, large-file protocol handling, result-server prioritization, merged provenance/count diagnostics, UI source inspection, and targeted protocol tests implemented. Latest cross-platform CI plus one local live-network smoke test remain. | RESOURCE-006S |

## Next selected task

**RESOURCE-006S — Native ED2K/Kad source discovery**

Status: **VERIFYING**

Implementation is feature-complete for the selected discovery-only scope. Keep 006S selected until the latest frontend/Linux/Windows CI gates pass and one local Windows/Tauri live-network source-discovery smoke test is recorded. Do not start native part/block transfer under 006S; that is the following ED2K milestone.


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

Status: **COMPLETE**

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

Status: **COMPLETE**

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

Status: **VERIFYING**

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

Status: **IN_PROGRESS**

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

Status: **VERIFYING**

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

Status: **VERIFYING**

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

Status: **VERIFYING**

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

Status: **IN_PROGRESS**

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
