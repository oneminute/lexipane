import { isTauri } from "@tauri-apps/api/core";
import { registerBookFile } from "../books/library";
import { initializeDatabase } from "../db/database";
import { deleteUnreferencedNoteAssetFiles } from "./noteAssets";

export interface ReaderNote {
  id: string;
  book_id: string | null;
  book_title: string | null;
  book_path: string | null;
  source_text: string | null;
  ai_content: string | null;
  user_content: string | null;
  tags_json: string;
  anchor_json: string | null;
  created_at: string;
  updated_at: string;
}

export async function createReaderNote(
  bookPath: string,
  sourceText: string,
  aiContent: string | null,
  anchorJson: string | null = null,
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
      "(id, book_id, source_text, ai_content, user_content, tags_json, anchor_json, created_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      id,
      book.id,
      sourceText,
      aiContent,
      "",
      "[]",
      anchorJson,
      now,
      now,
    ],
  );

  return id;
}

export async function listReaderNotes(): Promise<ReaderNote[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<ReaderNote[]>(
    "SELECT n.id, n.book_id, b.title AS book_title, b.file_path AS book_path, " +
      "n.source_text, n.ai_content, n.user_content, n.tags_json, n.anchor_json, " +
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


export async function updateReaderNoteTags(
  noteId: string,
  tags: string[],
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const normalized = Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40)),
    ),
  ).slice(0, 20);

  await db.execute(
    "UPDATE notes SET tags_json = $2, updated_at = $3 WHERE id = $1",
    [noteId, JSON.stringify(normalized), new Date().toISOString()],
  );
}

export async function deleteReaderNote(noteId: string): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const assets = await db.select<Array<{ file_path: string }>>(
    "SELECT file_path FROM note_assets WHERE note_id = $1",
    [noteId],
  );

  await db.execute("DELETE FROM notes WHERE id = $1", [noteId]);

  await deleteUnreferencedNoteAssetFiles(
    assets.map((asset) => asset.file_path),
  );
}

export function parseNoteTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}
