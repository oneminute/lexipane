import type { NormalizedRect } from "../../core/annotations/pdfAnnotations";

interface SpanRecord {
  span: HTMLSpanElement;
  start: number;
  end: number;
}

export function normalizePdfText(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s\u00a0]+/g, " ").trim();
}

function pageShell(page: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.pdf-page-shell[data-pdf-page="' + page + '"]',
  );
}

export function getPdfPageText(page: number): string {
  const shell = pageShell(page);
  return normalizePdfText(
    shell?.querySelector<HTMLElement>(".textLayer")?.textContent,
  );
}

function buildSpanRecords(textLayer: HTMLElement): {
  text: string;
  records: SpanRecord[];
} {
  const spans = Array.from(
    textLayer.querySelectorAll<HTMLSpanElement>("span"),
  );

  const records: SpanRecord[] = [];
  let text = "";

  for (const span of spans) {
    const value = normalizePdfText(span.textContent);
    if (!value) continue;

    if (text) text += " ";
    const start = text.length;
    text += value;
    records.push({
      span,
      start,
      end: text.length,
    });
  }

  return { text, records };
}

export function locatePdfTextRects(
  page: number,
  exact: string,
): NormalizedRect[] {
  const shell = pageShell(page);
  const textLayer = shell?.querySelector<HTMLElement>(".textLayer");
  if (!shell || !textLayer) return [];

  const { text, records } = buildSpanRecords(textLayer);
  const normalizedExact = normalizePdfText(exact);
  if (!text || !normalizedExact) return [];

  const start = text
    .toLocaleLowerCase("en-US")
    .indexOf(normalizedExact.toLocaleLowerCase("en-US"));
  if (start < 0) return [];

  const end = start + normalizedExact.length;
  const bounds = shell.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return [];

  return records
    .filter((record) => record.end > start && record.start < end)
    .flatMap((record) =>
      Array.from(record.span.getClientRects())
        .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
        .map((rect) => ({
          x: Math.max(
            0,
            Math.min(1, (rect.left - bounds.left) / bounds.width),
          ),
          y: Math.max(
            0,
            Math.min(1, (rect.top - bounds.top) / bounds.height),
          ),
          width: Math.max(0, Math.min(1, rect.width / bounds.width)),
          height: Math.max(0, Math.min(1, rect.height / bounds.height)),
        })),
    );
}
