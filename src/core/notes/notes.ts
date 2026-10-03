import { isTauri } from "@tauri-apps/api/core";
import { registerBookFile } from "../books/library";
import { initializeDatabase } from "../db/database";

export interface ReaderNote {
  id: string;
  book_id: string | null;
  book_title: string | null;
  book_path: string | null;
  source_text: string | null;
  ai_content: string | null;
  user_content: string | null;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

export async function createReaderNote(
  bookPath: string,
  sourceText: string,
  aiContent: string | null,
): Promise<string | null> {
  if (!isTauri()) return null;

  const book = await registerBookFile(bookPath);
  if (!book) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    "INSERT INTO notes " +
      "(id, book_id, source_text, ai_content, user_content, tags_json, created_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, book.id, sourceText, aiContent, "", "[]", now, now],
  );

  return id;
}

export async function listReaderNotes(): Promise<ReaderNote[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<ReaderNote[]>(
    "SELECT n.id, n.book_id, b.title AS book_title, b.file_path AS book_path, " +
      "n.source_text, n.ai_content, n.user_content, n.tags_json, " +
      "n.created_at, n.updated_at " +
      "FROM notes n LEFT JOIN books b ON b.id = n.book_id " +
      "ORDER BY n.updated_at DESC",
  );
}

export async function updateReaderNoteUserContent(
  noteId: string,
  userContent: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE notes SET user_content = $2, updated_at = $3 WHERE id = $1",
    [noteId, userContent, new Date().toISOString()],
  );
}
