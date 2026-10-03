import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

interface PositionRow {
  locator_json: string;
  progress: number | null;
}

export interface PdfReadingPosition {
  page: number;
  progress: number | null;
}

export function parsePdfReadingPosition(
  locatorJson: string,
  progress: number | null,
): PdfReadingPosition | null {
  try {
    const locator = JSON.parse(locatorJson) as {
      kind?: unknown;
      page?: unknown;
    };

    if (
      locator.kind !== "pdf-page" ||
      typeof locator.page !== "number" ||
      !Number.isInteger(locator.page) ||
      locator.page < 1
    ) {
      return null;
    }

    return {
      page: locator.page,
      progress,
    };
  } catch {
    return null;
  }
}

export async function loadPdfReadingPosition(
  path: string,
): Promise<PdfReadingPosition | null> {
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
    ? parsePdfReadingPosition(row.locator_json, row.progress)
    : null;
}

export async function savePdfReadingPosition(
  path: string,
  page: number,
  pageCount: number,
): Promise<void> {
  if (!isTauri() || page < 1 || pageCount < 1) return;

  const db = await initializeDatabase();
  if (!db) return;

  const progress =
    pageCount <= 1
      ? 1
      : Math.max(0, Math.min(1, (page - 1) / (pageCount - 1)));

  const locatorJson = JSON.stringify({
    version: 1,
    kind: "pdf-page",
    page,
  });
  const now = new Date().toISOString();

  await db.execute(
    "INSERT INTO reading_positions (book_id, locator_json, progress, updated_at) " +
      "SELECT id, $2, $3, $4 FROM books WHERE file_path = $1 " +
      "ON CONFLICT(book_id) DO UPDATE SET " +
      "locator_json = excluded.locator_json, " +
      "progress = excluded.progress, " +
      "updated_at = excluded.updated_at",
    [path, locatorJson, progress, now],
  );
}
