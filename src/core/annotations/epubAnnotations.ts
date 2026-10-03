import { isTauri } from "@tauri-apps/api/core";
import { registerBookFile } from "../books/library";
import { initializeDatabase } from "../db/database";

export interface EpubCfiAnchor {
  version: 1;
  kind: "epub-cfi";
  cfi: string;
  exact: string;
  context: string;
}

export interface EpubTextAnnotation {
  id: string;
  selectedText: string;
  status: string;
  color: string | null;
  anchor: EpubCfiAnchor;
}

interface AnnotationRow {
  id: string;
  selected_text: string | null;
  status: string;
  color: string | null;
  anchor_json: string;
}

export function parseEpubCfiAnchor(
  value: string,
): EpubCfiAnchor | null {
  try {
    const anchor = JSON.parse(value) as Partial<EpubCfiAnchor>;

    if (
      anchor.version !== 1 ||
      anchor.kind !== "epub-cfi" ||
      typeof anchor.cfi !== "string" ||
      !anchor.cfi ||
      typeof anchor.exact !== "string"
    ) {
      return null;
    }

    return {
      version: 1,
      kind: "epub-cfi",
      cfi: anchor.cfi,
      exact: anchor.exact,
      context:
        typeof anchor.context === "string"
          ? anchor.context
          : "",
    };
  } catch {
    return null;
  }
}

export async function createEpubHighlight(
  bookPath: string,
  cfi: string,
  exact: string,
  context: string,
): Promise<EpubTextAnnotation | null> {
  if (!isTauri() || !cfi || !exact.trim()) return null;

  const book = await registerBookFile(bookPath);
  if (!book) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const anchor: EpubCfiAnchor = {
    version: 1,
    kind: "epub-cfi",
    cfi,
    exact: exact.trim(),
    context: context.slice(0, 6000),
  };

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    "INSERT INTO annotations " +
      "(id, book_id, source, type, anchor_json, selected_text, status, color, created_at, updated_at) " +
      "VALUES ($1, $2, 'user', 'text', $3, $4, 'active', 'blue', $5, $5)",
    [
      id,
      book.id,
      JSON.stringify(anchor),
      anchor.exact,
      now,
    ],
  );

  return {
    id,
    selectedText: anchor.exact,
    status: "active",
    color: "blue",
    anchor,
  };
}

export async function listEpubHighlights(
  bookPath: string,
): Promise<EpubTextAnnotation[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<AnnotationRow[]>(
    "SELECT a.id, a.selected_text, a.status, a.color, a.anchor_json " +
      "FROM annotations a JOIN books b ON b.id = a.book_id " +
      "WHERE b.file_path = $1 AND a.status = 'active'",
    [bookPath],
  );

  const result: EpubTextAnnotation[] = [];

  for (const row of rows) {
    const anchor = parseEpubCfiAnchor(row.anchor_json);
    if (!anchor) continue;

    result.push({
      id: row.id,
      selectedText: row.selected_text ?? anchor.exact,
      status: row.status,
      color: row.color,
      anchor,
    });
  }

  return result;
}

export async function removeEpubHighlight(
  annotationId: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE annotations SET status = 'removed', updated_at = $2 WHERE id = $1",
    [annotationId, new Date().toISOString()],
  );
}
