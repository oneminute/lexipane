import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

interface PositionRow {
  locator_json: string;
  progress: number | null;
}

export interface KindleReadingPosition {
  chapterId: string;
  progress: number | null;
}

export function parseKindleReadingPosition(
  locatorJson: string,
  progress: number | null,
): KindleReadingPosition | null {
  try {
    const locator = JSON.parse(locatorJson) as {
      kind?: unknown;
      chapterId?: unknown;
    };

    if (
      locator.kind !== "kindle-chapter" ||
      typeof locator.chapterId !== "string" ||
      !locator.chapterId
    ) {
      return null;
    }

    return {
      chapterId: locator.chapterId,
      progress,
    };
  } catch {
    return null;
  }
}

export async function loadKindleReadingPosition(
  path: string,
): Promise<KindleReadingPosition | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<PositionRow[]>(
    "SELECT rp.locator_json, rp.progress " +
      "FROM reading_positions rp " +
      "JOIN books b ON b.id = rp.book_id " +
      "WHERE b.file_path = $1 LIMIT 1",
    [path],
  );

  const row = rows[0];
  return row
    ? parseKindleReadingPosition(row.locator_json, row.progress)
    : null;
}

export async function saveKindleReadingPosition(
  path: string,
  chapterId: string,
  progress: number | null,
): Promise<void> {
  if (!isTauri() || !chapterId) return;

  const db = await initializeDatabase();
  if (!db) return;

  const locatorJson = JSON.stringify({
    version: 1,
    kind: "kindle-chapter",
    chapterId,
  });

  await db.execute(
    "INSERT INTO reading_positions (book_id, locator_json, progress, updated_at) " +
      "SELECT id, $2, $3, $4 FROM books WHERE file_path = $1 " +
      "ON CONFLICT(book_id) DO UPDATE SET " +
      "locator_json = excluded.locator_json, " +
      "progress = excluded.progress, " +
      "updated_at = excluded.updated_at",
    [
      path,
      locatorJson,
      progress,
      new Date().toISOString(),
    ],
  );
}
