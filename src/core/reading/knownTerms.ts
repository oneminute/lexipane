import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

export type TermFeedbackStatus = "known" | "difficult" | "suppressed";

interface KnownTermRow {
  normalized_term: string;
  status: string;
}

export function normalizeTerm(term: string): string {
  return term
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s\u00a0]+/g, " ");
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
    "SELECT normalized_term, status FROM known_terms " +
      "WHERE language = 'en' AND status IN ('known', 'suppressed')",
  );

  return new Set(rows.map((row) => row.normalized_term));
}

export async function listKnownTerms(): Promise<KnownTermRow[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<KnownTermRow[]>(
    "SELECT normalized_term, status FROM known_terms " +
      "WHERE language = 'en' ORDER BY updated_at DESC",
  );
}
