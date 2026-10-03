import type { NormalizedRect } from "../../core/annotations/pdfAnnotations";

export interface PdfRegionCapture {
  page: number;
  rect: NormalizedRect;
  text: string;
  imageDataUrl: string | null;
}

function intersects(
  left: number,
  top: number,
  right: number,
  bottom: number,
  other: DOMRect,
): boolean {
  return !(
    other.right < left ||
    other.left > right ||
    other.bottom < top ||
    other.top > bottom
  );
}

export function capturePdfRegion(
  page: number,
  rect: NormalizedRect,
): PdfRegionCapture | null {
  const shell = document.querySelector<HTMLElement>(
    '.pdf-page-shell[data-pdf-page="' + page + '"]',
  );
  if (!shell) return null;

  const bounds = shell.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const left = bounds.left + rect.x * bounds.width;
  const top = bounds.top + rect.y * bounds.height;
  const right = left + rect.width * bounds.width;
  const bottom = top + rect.height * bounds.height;

  const textLayer = shell.querySelector<HTMLElement>(".textLayer");
  const selectedText = textLayer
    ? Array.from(textLayer.querySelectorAll<HTMLSpanElement>("span"))
        .filter((span) => {
          const spanRect = span.getBoundingClientRect();
          return intersects(left, top, right, bottom, spanRect);
        })
        .map((span) => span.textContent ?? "")
        .join(" ")
        .replace(/[\s\u00a0]+/g, " ")
        .trim()
    : "";

  const sourceCanvas = shell.querySelector<HTMLCanvasElement>(
    ".pdf-page-canvas",
  );

  let imageDataUrl: string | null = null;
  if (
    sourceCanvas &&
    sourceCanvas.width > 1 &&
    sourceCanvas.height > 1 &&
    rect.width > 0 &&
    rect.height > 0
  ) {
    const sx = Math.max(0, Math.floor(rect.x * sourceCanvas.width));
    const sy = Math.max(0, Math.floor(rect.y * sourceCanvas.height));
    const sw = Math.max(
      1,
      Math.min(
        sourceCanvas.width - sx,
        Math.ceil(rect.width * sourceCanvas.width),
      ),
    );
    const sh = Math.max(
      1,
      Math.min(
        sourceCanvas.height - sy,
        Math.ceil(rect.height * sourceCanvas.height),
      ),
    );

    const maxDimension = 1400;
    const downscale = Math.min(1, maxDimension / Math.max(sw, sh));
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(sw * downscale));
    output.height = Math.max(1, Math.round(sh * downscale));

    const context = output.getContext("2d");
    if (context) {
      context.drawImage(
        sourceCanvas,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        output.width,
        output.height,
      );
      imageDataUrl = output.toDataURL("image/png");
    }
  }

  return {
    page,
    rect,
    text: selectedText,
    imageDataUrl,
  };
}
