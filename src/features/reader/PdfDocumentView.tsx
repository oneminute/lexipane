import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PdfTextAnnotation } from "../../core/annotations/pdfAnnotations";
import {
  loadPdfFromPath,
  type LoadedPdfDocument,
} from "../../core/documents/pdf/pdfRuntime";
import { PdfPageView } from "./PdfPageView";

interface Props {
  path: string;
  scale: number;
  initialPage?: number | null;
  annotations?: PdfTextAnnotation[];
  onDocumentLoaded?: (pageCount: number) => void;
  onCurrentPageChange?: (pageNumber: number) => void;
  onPageTextReady?: (pageNumber: number, text: string) => void;
}

export function PdfDocumentView({
  path,
  scale,
  initialPage,
  annotations = [],
  onDocumentLoaded,
  onCurrentPageChange,
  onPageTextReady,
}: Props) {
  const [session, setSession] = useState<LoadedPdfDocument | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedSession: LoadedPdfDocument | null = null;

    setSession(null);
    setDocument(null);
    setLoading(true);
    setError(null);

    void loadPdfFromPath(path)
      .then((nextSession) => {
        loadedSession = nextSession;
        if (cancelled) {
          void nextSession.destroy();
          return;
        }

        setSession(nextSession);
        setDocument(nextSession.document);
        setLoading(false);
        onDocumentLoaded?.(nextSession.document.numPages);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setLoading(false);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to open this PDF.",
        );
      });

    return () => {
      cancelled = true;
      if (loadedSession) {
        void loadedSession.destroy();
      }
    };
  }, [onDocumentLoaded, path]);

  useEffect(() => {
    if (!document || !initialPage || initialPage <= 1) return;

    const page = Math.min(initialPage, document.numPages);
    let frame1 = 0;
    let frame2 = 0;

    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        const element = window.document.querySelector<HTMLElement>(
          '[data-pdf-page="' + page + '"]',
        );
        element?.scrollIntoView({
          block: "start",
          behavior: "auto",
        });
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [document, initialPage]);

  const pageNumbers = useMemo(() => {
    if (!document) return [];
    return Array.from({ length: document.numPages }, (_, index) => index + 1);
  }, [document]);

  if (loading) {
    return (
      <div className="pdf-state-card">
        <span className="pdf-spinner" />
        <strong>Opening PDF…</strong>
        <p>LexiPane is reading the local file and preparing the document.</p>
      </div>
    );
  }

  if (error || !document || !session) {
    return (
      <div className="pdf-state-card error">
        <strong>Unable to open this PDF.</strong>
        <p>{error ?? "The PDF document was not available."}</p>
      </div>
    );
  }

  return (
    <div className="pdf-document">
      {pageNumbers.map((pageNumber) => (
        <PdfPageView
          key={pageNumber}
          document={document}
          annotations={annotations.filter(
            (annotation) => annotation.anchor.page === pageNumber,
          )}
          pageNumber={pageNumber}
          scale={scale}
          onVisible={onCurrentPageChange}
          onTextReady={onPageTextReady}
        />
      ))}
    </div>
  );
}
