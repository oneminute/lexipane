import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import { getBookExtension } from "./openBook";

export type BookReadingStatus = "reading" | "finished";

export interface LibraryBook {
  id: string;
  file_path: string;
  format: string;
  title: string | null;
  author: string | null;
  cover_path: string | null;
  favorite: number;
  reading_status: BookReadingStatus;
  progress: number | null;
  added_at: string;
  last_opened_at: string | null;
}

function titleFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop() || path;
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

const BOOK_SELECT =
  "SELECT b.id, b.file_path, b.format, b.title, b.author, b.cover_path, " +
  "b.favorite, b.reading_status, rp.progress, b.added_at, b.last_opened_at " +
  "FROM books b LEFT JOIN reading_positions rp ON rp.book_id = b.id ";

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
    BOOK_SELECT + "WHERE b.file_path = $1 LIMIT 1",
    [path],
  );

  return rows[0] ?? null;
}

export async function listLibraryBooks(): Promise<LibraryBook[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<LibraryBook[]>(
    BOOK_SELECT +
      "ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC",
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

export async function setBookFavorite(
  bookId: string,
  favorite: boolean,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET favorite = $2 WHERE id = $1",
    [bookId, favorite ? 1 : 0],
  );
}

export async function setBookReadingStatus(
  bookId: string,
  status: BookReadingStatus,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET reading_status = $2 WHERE id = $1",
    [bookId, status],
  );
}
