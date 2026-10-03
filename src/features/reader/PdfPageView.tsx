import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PdfTextAnnotation } from "../../core/annotations/pdfAnnotations";

interface Props {
  document: PDFDocumentProxy;
  annotations?: PdfTextAnnotation[];
  pageNumber: number;
  scale: number;
  onVisible?: (pageNumber: number) => void;
  onTextReady?: (pageNumber: number, text: string) => void;
}

interface PageSize {
  width: number;
  height: number;
}

type TextLayerImagesOption =
  Parameters<TextLayerBuilder["render"]>[0]["images"];

const NO_TEXT_LAYER_IMAGES =
  null as unknown as TextLayerImagesOption;

export function PdfPageView({
  document,
  annotations = [],
  pageNumber,
  scale,
  onVisible,
  onTextReady,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerHostRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [size, setSize] = useState<PageSize | null>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void document
      .getPage(pageNumber)
      .then((nextPage) => {
        if (!cancelled) {
          setPage(nextPage);
        }
      })
      .catch((pageError) => {
        if (!cancelled) {
          setError(
            pageError instanceof Error
              ? pageError.message
              : "Unable to prepare this PDF page.",
          );
        }
      });

    return () => {
      cancelled = true;
      setPage(null);
    };
  }, [document, pageNumber]);

  useEffect(() => {
    if (!page) return;
    const viewport = page.getViewport({ scale });
    setSize({
      width: viewport.width,
      height: viewport.height,
    });
  }, [page, scale]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setNearViewport(Boolean(entry?.isIntersecting));
      },
      {
        rootMargin: "1200px 0px",
        threshold: 0,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
    const canvas = canvasRef.current;
    const textLayerHost = textLayerHostRef.current;

    if (!nearViewport) {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      textLayerHost?.replaceChildren();
      return;
    }

    if (!page || !canvas || !textLayerHost) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayerBuilder | null = null;

    async function renderPage() {
      try {
        setError(null);

        const viewport = page.getViewport({ scale });
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
          images: NO_TEXT_LAYER_IMAGES,
        });

        if (!cancelled) {
          const pageText = (textLayerHost.textContent ?? "")
            .replace(/[\s\u00a0]+/g, " ")
            .trim();
          onTextReady?.(pageNumber, pageText);
        }
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
  }, [nearViewport, onTextReady, page, pageNumber, scale]);

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
        <div className="pdf-page-loading">Preparing page {pageNumber}…</div>
      )}
      {size && nearViewport && !error && !page && (
        <div className="pdf-page-loading">Loading page {pageNumber}…</div>
      )}
      {error && (
        <div className="pdf-page-error">
          <strong>Page {pageNumber} could not be rendered.</strong>
          <span>{error}</span>
        </div>
      )}
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div className="pdf-highlight-layer" aria-hidden="true">
        {annotations.flatMap((annotation) =>
          annotation.anchor.rects.map((rect, index) => (
            <span
              key={annotation.id + ":" + index}
              className={
                annotation.source === "auto"
                  ? "pdf-highlight auto " + annotation.type
                  : "pdf-highlight user"
              }
              style={{
                left: rect.x * 100 + "%",
                top: rect.y * 100 + "%",
                width: rect.width * 100 + "%",
                height: rect.height * 100 + "%",
              }}
            />
          )),
        )}
      </div>
      <div ref={textLayerHostRef} className="pdf-text-layer-host" />
    </div>
  );
}
