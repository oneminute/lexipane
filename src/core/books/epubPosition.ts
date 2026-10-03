import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

interface PositionRow {
  locator_json: string;
  progress: number | null;
}

export interface EpubReadingPosition {
  cfi: string;
  progress: number | null;
}

export function parseEpubReadingPosition(
  locatorJson: string,
  progress: number | null,
): EpubReadingPosition | null {
  try {
    const locator = JSON.parse(locatorJson) as {
      kind?: unknown;
      cfi?: unknown;
    };

    if (
      locator.kind !== "epub-cfi" ||
      typeof locator.cfi !== "string" ||
      !locator.cfi
    ) {
      return null;
    }

    return {
      cfi: locator.cfi,
      progress,
    };
  } catch {
    return null;
  }
}

export async function loadEpubReadingPosition(
  path: string,
): Promise<EpubReadingPosition | null> {
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
    ? parseEpubReadingPosition(row.locator_json, row.progress)
    : null;
}

export async function saveEpubReadingPosition(
  path: string,
  cfi: string,
  progress: number | null,
): Promise<void> {
  if (!isTauri() || !cfi) return;

  const db = await initializeDatabase();
  if (!db) return;

  const locatorJson = JSON.stringify({
    version: 1,
    kind: "epub-cfi",
    cfi,
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
