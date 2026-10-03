import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfMetadataSummary {
  title: string | null;
  author: string | null;
}

export interface PdfOutlineEntry {
  id: string;
  title: string;
  page: number | null;
  depth: number;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readPdfMetadata(
  document: PDFDocumentProxy,
): Promise<PdfMetadataSummary> {
  const metadata = await document.getMetadata();
  const info = metadata.info as Record<string, unknown>;

  return {
    title: nonEmptyString(info.Title),
    author: nonEmptyString(info.Author),
  };
}

export async function readPdfOutline(
  document: PDFDocumentProxy,
): Promise<PdfOutlineEntry[]> {
  const outline = await document.getOutline();
  if (!outline) return [];

  const result: PdfOutlineEntry[] = [];

  async function walk(
    items: typeof outline,
    depth: number,
    path: string,
  ): Promise<void> {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      let page: number | null = null;

      try {
        const destination =
          typeof item.dest === "string"
            ? await document.getDestination(item.dest)
            : item.dest;

        if (Array.isArray(destination) && destination.length > 0) {
          const pageRef = destination[0] as Parameters<
            PDFDocumentProxy["getPageIndex"]
          >[0];
          page = (await document.getPageIndex(pageRef)) + 1;
        }
      } catch {
        page = null;
      }

      const id = path + index;
      result.push({
        id,
        title: item.title?.trim() || "Untitled section",
        page,
        depth,
      });

      if (item.items?.length) {
        await walk(item.items, depth + 1, id + ".");
      }
    }
  }

  await walk(outline, 0, "");
  return result;
}


export async function createPdfCoverDataUrl(
  document: PDFDocumentProxy,
  targetWidth = 220,
): Promise<string | null> {
  try {
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, targetWidth / Math.max(1, base.width));
    const viewport = page.getViewport({ scale });

    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));

    const task = page.render({
      canvas,
      viewport,
    });
    await task.promise;

    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return null;
  }
}
