import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

export type TermFeedbackStatus = "known" | "difficult" | "suppressed";

export interface ReadingTermFeedback {
  term: string;
  status: TermFeedbackStatus;
  seenCount: number;
  updatedAt: string;
}

interface KnownTermRow {
  normalized_term: string;
  status: string;
  seen_count: number;
  updated_at: string;
}

export interface ReadingProfileSummary {
  known: number;
  difficult: number;
  suppressed: number;
  totalSignals: number;
}

export function normalizeTerm(term: string): string {
  return term
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s\u00a0]+/g, " ");
}

function toFeedback(row: KnownTermRow): ReadingTermFeedback | null {
  if (
    row.status !== "known" &&
    row.status !== "difficult" &&
    row.status !== "suppressed"
  ) {
    return null;
  }

  return {
    term: row.normalized_term,
    status: row.status,
    seenCount: Number(row.seen_count ?? 0),
    updatedAt: row.updated_at,
  };
}

export async function recordTermFeedback(
  term: string,
  status: TermFeedbackStatus,
): Promise<void> {
  if (!isTauri()) return;

  const normalized = normalizeTerm(term);
  if (!normalized) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "INSERT INTO known_terms (normalized_term, language, status, seen_count, updated_at) " +
      "VALUES ($1, 'en', $2, 1, $3) " +
      "ON CONFLICT(normalized_term) DO UPDATE SET " +
      "status = excluded.status, " +
      "seen_count = known_terms.seen_count + 1, " +
      "updated_at = excluded.updated_at",
    [normalized, status, new Date().toISOString()],
  );
}

export async function listSuppressedTerms(): Promise<Set<string>> {
  if (!isTauri()) return new Set();

  const db = await initializeDatabase();
  if (!db) return new Set();

  const rows = await db.select<KnownTermRow[]>(
    "SELECT normalized_term, status, seen_count, updated_at FROM known_terms " +
      "WHERE language = 'en' AND status IN ('known', 'suppressed')",
  );

  return new Set(rows.map((row) => row.normalized_term));
}

export async function listTermFeedback(): Promise<ReadingTermFeedback[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<KnownTermRow[]>(
    "SELECT normalized_term, status, seen_count, updated_at FROM known_terms " +
      "WHERE language = 'en' ORDER BY updated_at DESC",
  );

  return rows
    .map(toFeedback)
    .filter((item): item is ReadingTermFeedback => Boolean(item));
}

export async function listKnownTerms(): Promise<KnownTermRow[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<KnownTermRow[]>(
    "SELECT normalized_term, status, seen_count, updated_at FROM known_terms " +
      "WHERE language = 'en' ORDER BY updated_at DESC",
  );
}

export async function listDifficultTermHints(
  limit = 40,
): Promise<string[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<KnownTermRow[]>(
    "SELECT normalized_term, status, seen_count, updated_at FROM known_terms " +
      "WHERE language = 'en' AND status = 'difficult' " +
      "ORDER BY seen_count DESC, updated_at DESC LIMIT $1",
    [Math.max(1, Math.min(200, limit))],
  );

  return rows.map((row) => row.normalized_term);
}

export async function getReadingProfileSummary(): Promise<ReadingProfileSummary> {
  const feedback = await listTermFeedback();

  return feedback.reduce<ReadingProfileSummary>(
    (summary, item) => {
      summary[item.status] += 1;
      summary.totalSignals += item.seenCount;
      return summary;
    },
    {
      known: 0,
      difficult: 0,
      suppressed: 0,
      totalSignals: 0,
    },
  );
}
