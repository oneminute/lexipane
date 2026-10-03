import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PdfTextAnnotation } from "../../core/annotations/pdfAnnotations";
import {
  createPdfCoverDataUrl,
  readPdfMetadata,
  readPdfOutline,
  type PdfMetadataSummary,
  type PdfOutlineEntry,
} from "../../core/documents/pdf/pdfInfo";
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
  onMetadataReady?: (metadata: PdfMetadataSummary) => void;
  onOutlineReady?: (outline: PdfOutlineEntry[]) => void;
  onCoverReady?: (coverDataUrl: string) => void;
}

export function PdfDocumentView({
  path,
  scale,
  initialPage,
  annotations = [],
  onDocumentLoaded,
  onCurrentPageChange,
  onPageTextReady,
  onMetadataReady,
  onOutlineReady,
  onCoverReady,
}: Props) {
  const [session, setSession] = useState<LoadedPdfDocument | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordReason, setPasswordReason] = useState<number | null>(null);
  const passwordResolverRef = useRef<
    ((password: string | null) => void) | null
  >(null);

  const requestPassword = useCallback(
    (reason: number) =>
      new Promise<string | null>((resolve) => {
        passwordResolverRef.current = resolve;
        setPasswordReason(reason);
        setPasswordValue("");
      }),
    [],
  );

  function completePassword(password: string | null) {
    const resolve = passwordResolverRef.current;
    passwordResolverRef.current = null;
    setPasswordReason(null);
    setPasswordValue("");
    resolve?.(password);
  }

  useEffect(() => {
    let cancelled = false;
    let loadedSession: LoadedPdfDocument | null = null;

    setSession(null);
    setDocument(null);
    setLoading(true);
    setError(null);
    setPasswordReason(null);
    setPasswordValue("");

    void loadPdfFromPath(path, requestPassword)
      .then(async (nextSession) => {
        loadedSession = nextSession;
        if (cancelled) {
          await nextSession.destroy();
          return;
        }

        setSession(nextSession);
        setDocument(nextSession.document);
        setLoading(false);
        onDocumentLoaded?.(nextSession.document.numPages);

        const [metadataResult, outlineResult, coverResult] =
          await Promise.allSettled([
            readPdfMetadata(nextSession.document),
            readPdfOutline(nextSession.document),
            createPdfCoverDataUrl(nextSession.document),
          ]);

        if (cancelled) return;

        if (metadataResult.status === "fulfilled") {
          onMetadataReady?.(metadataResult.value);
        }

        if (outlineResult.status === "fulfilled") {
          onOutlineReady?.(outlineResult.value);
        }

        if (
          coverResult.status === "fulfilled" &&
          coverResult.value
        ) {
          onCoverReady?.(coverResult.value);
        }
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
      if (passwordResolverRef.current) {
        passwordResolverRef.current(null);
        passwordResolverRef.current = null;
      }
      if (loadedSession) {
        void loadedSession.destroy();
      }
    };
  }, [
    onDocumentLoaded,
    onCoverReady,
    onMetadataReady,
    onOutlineReady,
    path,
    requestPassword,
  ]);

  useEffect(() => {
    if (!document || !initialPage || initialPage <= 1) return;

    const page = Math.min(initialPage, document.numPages);
    const timeout = window.setTimeout(() => {
      const element = window.document.querySelector<HTMLElement>(
        '[data-pdf-page="' + page + '"]',
      );
      element?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [document, initialPage]);

  const pageNumbers = useMemo(() => {
    if (!document) return [];
    return Array.from({ length: document.numPages }, (_, index) => index + 1);
  }, [document]);

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, PdfTextAnnotation[]>();

    for (const annotation of annotations) {
      const page = annotation.anchor.page;
      const current = map.get(page) ?? [];
      current.push(annotation);
      map.set(page, current);
    }

    return map;
  }, [annotations]);

  if (passwordReason !== null) {
    return (
      <form
        className="pdf-state-card pdf-password-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (passwordValue) {
            completePassword(passwordValue);
          }
        }}
      >
        <span className="eyebrow">Protected PDF</span>
        <strong>
          {passwordReason === 2
            ? "That password did not work."
            : "This PDF requires a password."}
        </strong>
        <p>
          Enter the document password. LexiPane uses it only to unlock this
          local PDF and does not save it.
        </p>
        <input
          autoFocus
          type="password"
          value={passwordValue}
          placeholder="PDF password"
          onChange={(event) => setPasswordValue(event.target.value)}
        />
        <div className="pdf-password-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => completePassword(null)}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={!passwordValue}
          >
            Unlock
          </button>
        </div>
      </form>
    );
  }

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
          annotations={annotationsByPage.get(pageNumber) ?? []}
          pageNumber={pageNumber}
          scale={scale}
          onVisible={onCurrentPageChange}
          onTextReady={onPageTextReady}
        />
      ))}
    </div>
  );
}
