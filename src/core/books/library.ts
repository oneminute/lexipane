import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import { getBookExtension } from "./openBook";

export interface LibraryBook {
  id: string;
  file_path: string;
  format: string;
  title: string | null;
  author: string | null;
  cover_path: string | null;
  added_at: string;
  last_opened_at: string | null;
}

function titleFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop() || path;
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export async function registerBookFile(path: string): Promise<LibraryBook | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const format = getBookExtension(path) || "unknown";
  const title = titleFromPath(path);

  await db.execute(
    "INSERT INTO books (id, file_path, format, title, added_at, last_opened_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6) " +
      "ON CONFLICT(file_path) DO UPDATE SET " +
      "format = excluded.format, " +
      "title = COALESCE(books.title, excluded.title), " +
      "last_opened_at = excluded.last_opened_at",
    [id, path, format, title, now, now],
  );

  const rows = await db.select<LibraryBook[]>(
    "SELECT id, file_path, format, title, author, cover_path, added_at, last_opened_at " +
      "FROM books WHERE file_path = $1 LIMIT 1",
    [path],
  );

  return rows[0] ?? null;
}

export async function listLibraryBooks(): Promise<LibraryBook[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<LibraryBook[]>(
    "SELECT id, file_path, format, title, author, cover_path, added_at, last_opened_at " +
      "FROM books ORDER BY COALESCE(last_opened_at, added_at) DESC",
  );
}


export async function updateBookMetadata(
  path: string,
  title: string | null,
  author: string | null,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET " +
      "title = CASE WHEN $2 IS NOT NULL AND TRIM($2) <> '' THEN $2 ELSE title END, " +
      "author = CASE WHEN $3 IS NOT NULL AND TRIM($3) <> '' THEN $3 ELSE author END " +
      "WHERE file_path = $1",
    [path, title, author],
  );
}


export async function updateBookCover(
  path: string,
  coverDataUrl: string | null,
): Promise<void> {
  if (!isTauri() || !coverDataUrl) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET cover_path = $2 WHERE file_path = $1",
    [path, coverDataUrl],
  );
}
