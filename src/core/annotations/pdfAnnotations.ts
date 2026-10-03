import { isTauri } from "@tauri-apps/api/core";
import { registerBookFile } from "../books/library";
import { initializeDatabase } from "../db/database";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextAnchor {
  version: 1;
  kind: "pdf-text-range";
  page: number;
  exact: string;
  prefix: string;
  suffix: string;
  rects: NormalizedRect[];
}

export interface PdfTextAnnotation {
  id: string;
  source: "user" | "auto";
  type: string;
  selectedText: string;
  status: string;
  color: string | null;
  anchor: PdfTextAnchor;
}

interface AnnotationRow {
  id: string;
  source: string;
  type: string;
  selected_text: string | null;
  status: string;
  color: string | null;
  anchor_json: string;
}

export function parsePdfTextAnchor(value: string): PdfTextAnchor | null {
  try {
    const anchor = JSON.parse(value) as Partial<PdfTextAnchor>;
    if (
      anchor.version !== 1 ||
      anchor.kind !== "pdf-text-range" ||
      typeof anchor.page !== "number" ||
      !Number.isInteger(anchor.page) ||
      anchor.page < 1 ||
      typeof anchor.exact !== "string" ||
      !Array.isArray(anchor.rects)
    ) {
      return null;
    }

    const rects = anchor.rects.filter((rect): rect is NormalizedRect => {
      return (
        typeof rect?.x === "number" &&
        typeof rect?.y === "number" &&
        typeof rect?.width === "number" &&
        typeof rect?.height === "number"
      );
    });

    return {
      version: 1,
      kind: "pdf-text-range",
      page: anchor.page,
      exact: anchor.exact,
      prefix: typeof anchor.prefix === "string" ? anchor.prefix : "",
      suffix: typeof anchor.suffix === "string" ? anchor.suffix : "",
      rects,
    };
  } catch {
    return null;
  }
}

function quoteContext(
  exact: string,
  context: string,
): { prefix: string; suffix: string } {
  const index = context.indexOf(exact);
  if (index < 0) {
    return { prefix: "", suffix: "" };
  }

  return {
    prefix: context.slice(Math.max(0, index - 100), index),
    suffix: context.slice(index + exact.length, index + exact.length + 100),
  };
}

export async function createUserPdfHighlight(
  bookPath: string,
  page: number,
  exact: string,
  context: string,
  rects: NormalizedRect[],
): Promise<PdfTextAnnotation | null> {
  if (!isTauri() || page < 1 || !exact.trim() || rects.length === 0) {
    return null;
  }

  const book = await registerBookFile(bookPath);
  if (!book) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const { prefix, suffix } = quoteContext(exact, context);
  const anchor: PdfTextAnchor = {
    version: 1,
    kind: "pdf-text-range",
    page,
    exact,
    prefix,
    suffix,
    rects,
  };

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    "INSERT INTO annotations " +
      "(id, book_id, source, type, anchor_json, selected_text, status, color, created_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      id,
      book.id,
      "user",
      "text",
      JSON.stringify(anchor),
      exact,
      "active",
      "blue",
      now,
      now,
    ],
  );

  return {
    id,
    source: "user",
    type: "text",
    selectedText: exact,
    status: "active",
    color: "blue",
    anchor,
  };
}

export async function listPdfTextAnnotations(
  bookPath: string,
): Promise<PdfTextAnnotation[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<AnnotationRow[]>(
    "SELECT a.id, a.source, a.type, a.selected_text, a.status, a.color, a.anchor_json " +
      "FROM annotations a JOIN books b ON b.id = a.book_id " +
      "WHERE b.file_path = $1 AND a.status = 'active' " +
      "ORDER BY a.created_at ASC",
    [bookPath],
  );

  const result: PdfTextAnnotation[] = [];
  for (const row of rows) {
    const anchor = parsePdfTextAnchor(row.anchor_json);
    if (!anchor) continue;

    result.push({
      id: row.id,
      source: row.source === "auto" ? "auto" : "user",
      type: row.type,
      selectedText: row.selected_text ?? anchor.exact,
      status: row.status,
      color: row.color,
      anchor,
    });
  }

  return result;
}

export async function removePdfTextAnnotation(
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
