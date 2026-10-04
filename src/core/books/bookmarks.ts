import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import {
  parseReaderNavigationTarget,
  serializeReaderNavigationTarget,
  type ReaderNavigationTarget,
} from "./navigation";

interface BookmarkRow {
  id: string;
  locator_json: string;
  progress: number | null;
  label: string | null;
  created_at: string;
}

export interface ReaderBookmark {
  id: string;
  target: ReaderNavigationTarget;
  progress: number | null;
  label: string | null;
  createdAt: string;
}

function bookmarkId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    "bookmark-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export async function listReaderBookmarks(
  path: string,
): Promise<ReaderBookmark[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<BookmarkRow[]>(
    "SELECT bm.id, bm.locator_json, bm.progress, bm.label, bm.created_at " +
      "FROM bookmarks bm " +
      "JOIN books b ON b.id = bm.book_id " +
      "WHERE b.file_path = $1 " +
      "ORDER BY COALESCE(bm.progress, 2), bm.created_at",
    [path],
  );

  return rows.flatMap((row) => {
    const target = parseReaderNavigationTarget(row.locator_json);
    return target
      ? [{
          id: row.id,
          target,
          progress: row.progress,
          label: row.label,
          createdAt: row.created_at,
        }]
      : [];
  });
}

export async function createReaderBookmark(
  path: string,
  target: ReaderNavigationTarget,
  progress: number | null,
  label: string | null = null,
): Promise<ReaderBookmark | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const id = bookmarkId();
  const createdAt = new Date().toISOString();
  const locatorJson = serializeReaderNavigationTarget(target);
  if (!locatorJson) return null;

  await db.execute(
    "INSERT INTO bookmarks " +
      "(id, book_id, locator_json, progress, label, created_at) " +
      "SELECT $2, id, $3, $4, $5, $6 FROM books WHERE file_path = $1",
    [path, id, locatorJson, progress, label, createdAt],
  );

  return {
    id,
    target,
    progress,
    label,
    createdAt,
  };
}

export async function removeReaderBookmark(
  id: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "DELETE FROM bookmarks WHERE id = $1",
    [id],
  );
}
