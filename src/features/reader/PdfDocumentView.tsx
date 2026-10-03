import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { loadPdfFromPath } from "../../core/documents/pdf/pdfRuntime";
import { PdfPageView } from "./PdfPageView";

interface Props {
  path: string;
  scale: number;
  onDocumentLoaded?: (pageCount: number) => void;
  onCurrentPageChange?: (pageNumber: number) => void;
}

export function PdfDocumentView({
  path,
  scale,
  onDocumentLoaded,
  onCurrentPageChange,
}: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;

    setDocument(null);
    setLoading(true);
    setError(null);

    void loadPdfFromPath(path)
      .then((pdf) => {
        loadedDocument = pdf;
        if (cancelled) {
          void pdf.destroy();
          return;
        }

        setDocument(pdf);
        setLoading(false);
        onDocumentLoaded?.(pdf.numPages);
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
      if (loadedDocument) {
        void loadedDocument.destroy();
      }
    };
  }, [onDocumentLoaded, path]);

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

  if (error || !document) {
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
          pageNumber={pageNumber}
          scale={scale}
          onVisible={onCurrentPageChange}
        />
      ))}
    </div>
  );
}
