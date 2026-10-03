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

function commonSuffixLength(a: string, b: string): number {
  let count = 0;
  const limit = Math.min(a.length, b.length);

  while (
    count < limit &&
    a[a.length - 1 - count] === b[b.length - 1 - count]
  ) {
    count += 1;
  }

  return count;
}

function commonPrefixLength(a: string, b: string): number {
  let count = 0;
  const limit = Math.min(a.length, b.length);

  while (count < limit && a[count] === b[count]) {
    count += 1;
  }

  return count;
}

export function findBestQuoteOccurrence(
  pageText: string,
  exact: string,
  prefix = "",
  suffix = "",
): number {
  const page = normalizePdfText(pageText).toLocaleLowerCase("en-US");
  const quote = normalizePdfText(exact).toLocaleLowerCase("en-US");
  const quotePrefix = normalizePdfText(prefix).toLocaleLowerCase("en-US");
  const quoteSuffix = normalizePdfText(suffix).toLocaleLowerCase("en-US");

  if (!page || !quote) return -1;

  const occurrences: number[] = [];
  let searchFrom = 0;

  while (searchFrom <= page.length - quote.length) {
    const index = page.indexOf(quote, searchFrom);
    if (index < 0) break;
    occurrences.push(index);
    searchFrom = index + Math.max(1, quote.length);
  }

  if (occurrences.length === 0) return -1;
  if (occurrences.length === 1) return occurrences[0];

  let bestIndex = occurrences[0];
  let bestScore = -1;

  for (const index of occurrences) {
    const before = page.slice(
      Math.max(0, index - Math.max(quotePrefix.length, 120)),
      index,
    );
    const after = page.slice(
      index + quote.length,
      index + quote.length + Math.max(quoteSuffix.length, 120),
    );

    const prefixScore = quotePrefix
      ? commonSuffixLength(before, quotePrefix)
      : 0;
    const suffixScore = quoteSuffix
      ? commonPrefixLength(after, quoteSuffix)
      : 0;
    const score = prefixScore * 2 + suffixScore * 2;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function locatePdfTextRects(
  page: number,
  exact: string,
  prefix = "",
  suffix = "",
): NormalizedRect[] {
  const shell = pageShell(page);
  const textLayer = shell?.querySelector<HTMLElement>(".textLayer");
  if (!shell || !textLayer) return [];

  const { text, records } = buildSpanRecords(textLayer);
  const normalizedExact = normalizePdfText(exact);
  if (!text || !normalizedExact) return [];

  const start = findBestQuoteOccurrence(
    text,
    normalizedExact,
    prefix,
    suffix,
  );
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
