import { isTauri } from "@tauri-apps/api/core";
import { registerBookFile } from "../books/library";
import { initializeDatabase } from "../db/database";

export interface KindleTextAnchor {
  version: 1;
  kind: "kindle-text";
  chapterId: string;
  exact: string;
  context: string;
}

export interface KindleTextAnnotation {
  id: string;
  selectedText: string;
  status: string;
  color: string | null;
  anchor: KindleTextAnchor;
}

interface AnnotationRow {
  id: string;
  selected_text: string | null;
  status: string;
  color: string | null;
  anchor_json: string;
}

export function parseKindleTextAnchor(
  value: string,
): KindleTextAnchor | null {
  try {
    const anchor = JSON.parse(value) as Partial<KindleTextAnchor>;

    if (
      anchor.version !== 1 ||
      anchor.kind !== "kindle-text" ||
      typeof anchor.chapterId !== "string" ||
      !anchor.chapterId ||
      typeof anchor.exact !== "string" ||
      !anchor.exact
    ) {
      return null;
    }

    return {
      version: 1,
      kind: "kindle-text",
      chapterId: anchor.chapterId,
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

export async function createKindleHighlight(
  bookPath: string,
  chapterId: string,
  exact: string,
  context: string,
): Promise<KindleTextAnnotation | null> {
  if (!isTauri() || !chapterId || !exact.trim()) return null;

  const book = await registerBookFile(bookPath);
  if (!book) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const anchor: KindleTextAnchor = {
    version: 1,
    kind: "kindle-text",
    chapterId,
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

export async function listKindleHighlights(
  bookPath: string,
): Promise<KindleTextAnnotation[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<AnnotationRow[]>(
    "SELECT a.id, a.selected_text, a.status, a.color, a.anchor_json " +
      "FROM annotations a JOIN books b ON b.id = a.book_id " +
      "WHERE b.file_path = $1 AND a.status = 'active'",
    [bookPath],
  );

  const result: KindleTextAnnotation[] = [];

  for (const row of rows) {
    const anchor = parseKindleTextAnchor(row.anchor_json);
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

export async function removeKindleHighlight(
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
