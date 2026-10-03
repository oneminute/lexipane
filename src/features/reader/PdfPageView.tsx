import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { LoadedPdfDocument } from "../../core/documents/pdf/pdfRuntime";

interface Props {
  document: PDFDocumentProxy;
  session: LoadedPdfDocument;
  pageNumber: number;
  scale: number;
  onVisible?: (pageNumber: number) => void;
}

interface PageSize {
  width: number;
  height: number;
}

export function PdfPageView({
  document,
  session,
  pageNumber,
  scale,
  onVisible,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerHostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PageSize | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || !onVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.45) {
          onVisible(pageNumber);
        }
      },
      {
        threshold: [0.45, 0.65, 0.85],
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayerBuilder | null = null;

    async function renderPage() {
      try {
        setError(null);

        const page = await document.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const nextSize = {
          width: viewport.width,
          height: viewport.height,
        };
        setSize(nextSize);

        const canvas = canvasRef.current;
        const textLayerHost = textLayerHostRef.current;
        if (!canvas || !textLayerHost) return;

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";

        renderTask = page.render({
          canvas,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });

        await renderTask.promise;
        if (cancelled) return;

        textLayerHost.replaceChildren();

        textLayer = new TextLayerBuilder({
          pdfPage: page,
          onAppend: (textLayerDiv: HTMLDivElement) => {
            if (!cancelled) {
              textLayerHost.replaceChildren(textLayerDiv);
            }
          },
        });

        await textLayer.render({
          viewport,
          images: session.createEmptyTextLayerImages(viewport, canvas),
        });
      } catch (renderError) {
        if (cancelled) return;

        const name =
          renderError &&
          typeof renderError === "object" &&
          "name" in renderError
            ? String((renderError as { name?: unknown }).name)
            : "";

        if (name === "RenderingCancelledException") return;

        setError(
          renderError instanceof Error
            ? renderError.message
            : "Unable to render this PDF page.",
        );
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, pageNumber, scale, session]);

  return (
    <div
      ref={shellRef}
      className="pdf-page-shell"
      data-pdf-page={pageNumber}
      style={
        size
          ? {
              width: size.width,
              height: size.height,
            }
          : undefined
      }
    >
      {!size && !error && (
        <div className="pdf-page-loading">Loading page {pageNumber}…</div>
      )}
      {error && (
        <div className="pdf-page-error">
          <strong>Page {pageNumber} could not be rendered.</strong>
          <span>{error}</span>
        </div>
      )}
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerHostRef} className="pdf-text-layer-host" />
    </div>
  );
}
