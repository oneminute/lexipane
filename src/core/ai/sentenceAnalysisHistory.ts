import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import { findLibraryBookByPath } from "../books/library";
import { stableHash } from "./cache";
import {
  analyzeReadingSelection,
  streamReadingSelection,
  type ReadingAnalysisResult,
  type ReadingRequestDebug,
  type ReadingSelection,
  type ReadingStreamCallback,
} from "./readingService";
import type { StructuredReadingAnalysis } from "./readingStructured";

export interface SentenceAnalysisKeyInput {
  format: "pdf" | "epub" | "kindle";
  container: string;
  sentenceIndex: number;
  text: string;
}

export interface SentenceAnalysisVersion {
  id: string;
  bookPath: string;
  bookId?: string;
  sentenceKey: string;
  sentenceText: string;
  contextHash: string;
  mode: "grammar";
  versionNo: number;
  model: string;
  source?: string;
  analysis: StructuredReadingAnalysis;
  text: string;
  rawResponse?: string;
  requestDebug?: ReadingRequestDebug;
  importedLegacyCache: boolean;
  createdAt: string;
}

interface SentenceAnalysisRow {
  id: string;
  book_id: string | null;
  book_path: string;
  sentence_key: string;
  sentence_text: string;
  context_hash: string;
  mode: "grammar";
  version_no: number;
  model_id: string;
  source: string | null;
  analysis_json: string;
  text: string;
  raw_response: string | null;
  request_json: string | null;
  imported_legacy_cache: number;
  created_at: string;
}

export interface SentenceAnalysisRequest {
  bookPath: string;
  sentenceKey: string;
  selection: ReadingSelection;
}

export interface GenerateSentenceAnalysisOptions {
  forceNew?: boolean;
  onStream?: ReadingStreamCallback;
}

export interface SentenceAnalysisResolution {
  version: SentenceAnalysisVersion;
  versions: SentenceAnalysisVersion[];
  generated: boolean;
}

const inFlight = new Map<string, Promise<SentenceAnalysisResolution>>();

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToVersion(row: SentenceAnalysisRow): SentenceAnalysisVersion {
  return {
    id: row.id,
    bookPath: row.book_path,
    bookId: row.book_id ?? undefined,
    sentenceKey: row.sentence_key,
    sentenceText: row.sentence_text,
    contextHash: row.context_hash,
    mode: row.mode,
    versionNo: row.version_no,
    model: row.model_id,
    source: row.source ?? undefined,
    analysis: parseJson<StructuredReadingAnalysis>(
      row.analysis_json,
      {
        kind: "raw",
        text: row.text,
        note: "Stored sentence analysis could not be parsed.",
      },
    ),
    text: row.text,
    rawResponse: row.raw_response ?? undefined,
    requestDebug: parseJson<ReadingRequestDebug | undefined>(
      row.request_json,
      undefined,
    ),
    importedLegacyCache: row.imported_legacy_cache !== 0,
    createdAt: row.created_at,
  };
}

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "sentence-ai-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2)
  );
}

export function createSentenceAnalysisKey(
  input: SentenceAnalysisKeyInput,
): string {
  const normalizedText = input.text.replace(/\s+/g, " ").trim();

  return [
    input.format,
    stableHash(input.container),
    Math.max(0, Math.trunc(input.sentenceIndex)).toString(36),
    stableHash(normalizedText),
  ].join(":");
}

async function resolveBookId(
  bookPath: string,
): Promise<string | null> {
  return (await findLibraryBookByPath(bookPath))?.id ?? null;
}

export async function listSentenceAnalysisVersions(
  bookPath: string,
  sentenceKey: string,
): Promise<SentenceAnalysisVersion[]> {
  if (!isTauri() || !bookPath || !sentenceKey) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const bookId = await resolveBookId(bookPath);
  const rows = bookId
    ? await db.select<SentenceAnalysisRow[]>(
        "SELECT * FROM sentence_ai_versions " +
          "WHERE (book_id = $1 OR (book_id IS NULL AND book_path = $2)) " +
          "AND sentence_key = $3 AND mode = 'grammar' " +
          "ORDER BY version_no ASC",
        [bookId, bookPath, sentenceKey],
      )
    : await db.select<SentenceAnalysisRow[]>(
        "SELECT * FROM sentence_ai_versions " +
          "WHERE book_path = $1 AND sentence_key = $2 AND mode = 'grammar' " +
          "ORDER BY version_no ASC",
        [bookPath, sentenceKey],
      );

  if (bookId) {
    await db.execute(
      "UPDATE sentence_ai_versions SET book_id = $1 " +
        "WHERE book_id IS NULL AND book_path = $2 AND sentence_key = $3",
      [bookId, bookPath, sentenceKey],
    );
  }

  return rows.map((row) =>
    row.book_id
      ? rowToVersion(row)
      : rowToVersion({ ...row, book_id: bookId }),
  );
}

export async function getLatestSentenceAnalysisVersion(
  bookPath: string,
  sentenceKey: string,
): Promise<SentenceAnalysisVersion | null> {
  const versions = await listSentenceAnalysisVersions(
    bookPath,
    sentenceKey,
  );
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

async function appendSentenceAnalysisVersion(
  request: SentenceAnalysisRequest,
  result: ReadingAnalysisResult,
): Promise<SentenceAnalysisVersion> {
  const contextHash = stableHash(request.selection.context ?? "");
  const createdAt = new Date().toISOString();
  const bookId = isTauri()
    ? await resolveBookId(request.bookPath)
    : null;

  if (!isTauri()) {
    return {
      id: createId(),
      bookPath: request.bookPath,
      bookId: bookId ?? undefined,
      sentenceKey: request.sentenceKey,
      sentenceText: request.selection.text,
      contextHash,
      mode: "grammar",
      versionNo: 1,
      model: result.model,
      source: result.source,
      analysis: result.analysis,
      text: result.text,
      rawResponse: result.rawResponse,
      requestDebug: result.requestDebug,
      importedLegacyCache: Boolean(result.cached),
      createdAt,
    };
  }

  const db = await initializeDatabase();
  if (!db) {
    throw new Error("Database is unavailable for sentence AI history.");
  }

  await db.execute("BEGIN IMMEDIATE");

  try {
    const versionRows = await db.select<Array<{ next_version: number }>>(
      "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version " +
        "FROM sentence_ai_versions " +
        "WHERE ((book_id IS NOT NULL AND book_id = $1) OR " +
        "(book_id IS NULL AND book_path = $2)) " +
        "AND sentence_key = $3 AND mode = 'grammar'",
      [bookId, request.bookPath, request.sentenceKey],
    );
    const versionNo = Math.max(1, versionRows[0]?.next_version ?? 1);
    const id = createId();

    await db.execute(
      "INSERT INTO sentence_ai_versions " +
        "(id, book_id, book_path, sentence_key, sentence_text, context_hash, mode, " +
        "version_no, model_id, source, analysis_json, text, raw_response, " +
        "request_json, imported_legacy_cache, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,'grammar',$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        id,
        bookId,
        request.bookPath,
        request.sentenceKey,
        request.selection.text,
        contextHash,
        versionNo,
        result.model,
        result.source ?? null,
        JSON.stringify(result.analysis),
        result.text,
        result.rawResponse ?? null,
        JSON.stringify(result.requestDebug),
        result.cached ? 1 : 0,
        createdAt,
      ],
    );

    await db.execute("COMMIT");

    return {
      id,
      bookPath: request.bookPath,
      bookId: bookId ?? undefined,
      sentenceKey: request.sentenceKey,
      sentenceText: request.selection.text,
      contextHash,
      mode: "grammar",
      versionNo,
      model: result.model,
      source: result.source,
      analysis: result.analysis,
      text: result.text,
      rawResponse: result.rawResponse,
      requestDebug: result.requestDebug,
      importedLegacyCache: Boolean(result.cached),
      createdAt,
    };
  } catch (error) {
    await db.execute("ROLLBACK");
    throw error;
  }
}

async function generate(
  request: SentenceAnalysisRequest,
  options: GenerateSentenceAnalysisOptions,
): Promise<SentenceAnalysisResolution> {
  if (!options.forceNew) {
    const existing = await listSentenceAnalysisVersions(
      request.bookPath,
      request.sentenceKey,
    );

    if (existing.length > 0) {
      return {
        version: existing[existing.length - 1],
        versions: existing,
        generated: false,
      };
    }
  }

  const result = options.onStream
    ? await streamReadingSelection(
        request.selection,
        "grammar",
        undefined,
        options.onStream,
        { bypassCache: Boolean(options.forceNew) },
      )
    : await analyzeReadingSelection(
        request.selection,
        "grammar",
        undefined,
        { bypassCache: Boolean(options.forceNew) },
      );

  const version = await appendSentenceAnalysisVersion(request, result);
  const versions = await listSentenceAnalysisVersions(
    request.bookPath,
    request.sentenceKey,
  );

  return {
    version,
    versions: versions.length > 0 ? versions : [version],
    generated: true,
  };
}

export async function resolveSentenceAnalysis(
  request: SentenceAnalysisRequest,
  options: GenerateSentenceAnalysisOptions = {},
): Promise<SentenceAnalysisResolution> {
  if (!request.bookPath.trim()) {
    throw new Error("A book path is required for sentence AI history.");
  }

  if (!request.sentenceKey.trim()) {
    throw new Error("A sentence identity key is required.");
  }

  const lockKey = request.bookPath + "|" + request.sentenceKey;

  if (!options.forceNew) {
    const existing = inFlight.get(lockKey);
    if (existing) return existing;
  }

  const task = generate(request, options);

  if (!options.forceNew) {
    inFlight.set(lockKey, task);
  }

  try {
    return await task;
  } finally {
    if (!options.forceNew && inFlight.get(lockKey) === task) {
      inFlight.delete(lockKey);
    }
  }
}
