import { useCallback, useEffect, useMemo, useState } from "react";
import { isPdfPath } from "../../core/books/openBook";
import {
  loadPdfReadingPosition,
  savePdfReadingPosition,
} from "../../core/books/readingPosition";
import { PdfDocumentView } from "./PdfDocumentView";

interface Props {
  bookPath: string | null;
  onOpenBook: () => void;
  onBackToLibrary: () => void;
}

function fileName(path: string | null) {
  if (!path) return "No book selected";
  return path.split(/[\\/]/).pop() || path;
}

export function ReaderView({
  bookPath,
  onOpenBook,
  onBackToLibrary,
}: Props) {
  const [scale, setScale] = useState(1.1);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [initialPage, setInitialPage] = useState<number | null>(null);
  const [positionLoaded, setPositionLoaded] = useState(false);
  const [selectedText, setSelectedText] = useState("");

  const isPdf = isPdfPath(bookPath);

  useEffect(() => {
    let cancelled = false;

    setPageCount(0);
    setCurrentPage(1);
    setInitialPage(null);
    setPositionLoaded(false);
    setSelectedText("");

    if (!bookPath || !isPdfPath(bookPath)) {
      setPositionLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    void loadPdfReadingPosition(bookPath)
      .then((position) => {
        if (cancelled) return;
        setInitialPage(position?.page ?? 1);
        setCurrentPage(position?.page ?? 1);
      })
      .catch((error) => {
        console.error("Unable to restore PDF reading position", error);
        if (!cancelled) {
          setInitialPage(1);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPositionLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookPath]);

  const zoomLabel = useMemo(
    () => Math.round(scale * 100) + "%",
    [scale],
  );

  const zoomOut = useCallback(() => {
    setScale((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10));
  }, []);

  const handleDocumentLoaded = useCallback((count: number) => {
    setPageCount(count);
  }, []);

  const handleCurrentPageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);

      if (!bookPath || pageCount < 1) return;

      void savePdfReadingPosition(bookPath, page, pageCount).catch((error) => {
        console.error("Unable to save PDF reading position", error);
      });
    },
    [bookPath, pageCount],
  );

  function captureSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (text) {
      setSelectedText(text);
    }
  }

  return (
    <section className="reader-page">
      <header className="reader-toolbar">
        <div className="reader-title">
          <button className="text-button" onClick={onBackToLibrary}>
            ← Library
          </button>
          <span className="toolbar-divider" />
          <div>
            <strong>{fileName(bookPath)}</strong>
            <small>
              {isPdf
                ? pageCount > 0
                  ? pageCount + " pages"
                  : "Opening PDF…"
                : bookPath
                  ? "Format saved · reader engine pending"
                  : "Open a book to begin"}
            </small>
          </div>
        </div>

        <div className="reader-actions">
          {isPdf && (
            <div className="zoom-control">
              <button onClick={zoomOut} aria-label="Zoom out">
                −
              </button>
              <span>{zoomLabel}</span>
              <button onClick={zoomIn} aria-label="Zoom in">
                +
              </button>
            </div>
          )}
          <button className="ghost-button">Region select</button>
          <button className="ghost-button">Notes</button>
          <button className="primary-button compact" onClick={onOpenBook}>
            Open
          </button>
        </div>
      </header>

      <div className="split-reader">
        <section className="document-pane">
          <div className="document-stage" onMouseUp={captureSelection}>
            {!bookPath && (
              <div className="reader-empty-state">
                <span className="eyebrow">Reader</span>
                <h1>Open or drop a book to begin.</h1>
                <p>
                  PDF files render directly inside LexiPane. Your text remains
                  selectable so it can feed the annotation and AI layers next.
                </p>
                <button className="primary-button" onClick={onOpenBook}>
                  Choose a book
                </button>
              </div>
            )}

            {bookPath && isPdf && positionLoaded && (
              <PdfDocumentView
                path={bookPath}
                scale={scale}
                initialPage={initialPage}
                onDocumentLoaded={handleDocumentLoaded}
                onCurrentPageChange={handleCurrentPageChange}
              />
            )}

            {bookPath && isPdf && !positionLoaded && (
              <div className="pdf-state-card">
                <span className="pdf-spinner" />
                <strong>Restoring reading position…</strong>
              </div>
            )}

            {bookPath && !isPdf && (
              <div className="reader-empty-state">
                <span className="eyebrow">Document engine</span>
                <h1>This book is in your library.</h1>
                <p>
                  PDF is the first live engine. EPUB, MOBI and AZW/AZW3 will
                  attach to this exact reader shell without changing the
                  annotation, notebook or AI architecture.
                </p>
              </div>
            )}
          </div>

          <footer className="reader-statusbar">
            <span>
              Page {pageCount ? currentPage : "—"} / {pageCount || "—"}
            </span>
            <span>{zoomLabel}</span>
            <span>Continuous</span>
            <span>{selectedText ? "Selection ready" : "Select text for AI"}</span>
          </footer>
        </section>

        <aside className="ai-pane">
          <header className="ai-pane-header">
            <div>
              <span className="eyebrow">AI Reading</span>
              <strong>Context assistance</strong>
            </div>
            <button className="model-pill">Qwen · Ollama ▾</button>
          </header>

          <div className="ai-scroll">
            {selectedText ? (
              <section className="assist-card selected-source-card">
                <span className="assist-type blue">Selected text</span>
                <h3>Ready for contextual analysis</h3>
                <blockquote>{selectedText}</blockquote>
                <p className="muted">
                  The PDF text layer is live. The next AI slice will turn this
                  selection into word, phrase and sentence analysis without
                  copying it out of the reader.
                </p>
                <div className="assist-actions">
                  <button>Explain</button>
                  <button>Analyze grammar</button>
                  <button>Save note</button>
                  <button onClick={() => setSelectedText("")}>Clear</button>
                </div>
              </section>
            ) : (
              <section className="assist-card reader-ai-empty">
                <span className="assist-type yellow">Reading context</span>
                <h3>Select text on the PDF.</h3>
                <p>
                  LexiPane can now render a real PDF with a selectable text
                  layer. Select a word, phrase or sentence to prepare it for
                  contextual AI assistance.
                </p>
              </section>
            )}
          </div>

          <div className="ask-box">
            <textarea
              rows={2}
              placeholder={
                selectedText
                  ? "Ask about the selected text…"
                  : "Select text or ask about the current page…"
              }
            />
            <button>Ask</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
