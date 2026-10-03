import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  createUserPdfHighlight,
  listPdfTextAnnotations,
  removePdfTextAnnotation,
  type NormalizedRect,
  type PdfTextAnnotation,
} from "../../core/annotations/pdfAnnotations";
import { loadOllamaConfig } from "../../core/ai/ollamaConfig";
import {
  analyzeReadingSelection,
  type ReadingAnalysisMode,
  type ReadingSelection,
} from "../../core/ai/readingService";
import { isPdfPath } from "../../core/books/openBook";
import { createReaderNote } from "../../core/notes/notes";
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

interface AiResultState {
  title: string;
  text: string;
  model: string;
}

interface ActiveReaderSelection extends ReadingSelection {
  page: number;
  rects: NormalizedRect[];
}

function fileName(path: string | null) {
  if (!path) return "No book selected";
  return path.split(/[\\/]/).pop() || path;
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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
  const [selection, setSelection] =
    useState<ActiveReaderSelection | null>(null);
  const [aiResult, setAiResult] = useState<AiResultState | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [configuredModel, setConfiguredModel] = useState<string | null>(null);
  const [noteStatus, setNoteStatus] =
    useState<"idle" | "saving" | "saved">("idle");
  const [highlightStatus, setHighlightStatus] =
    useState<"idle" | "saving" | "saved">("idle");
  const [annotations, setAnnotations] = useState<PdfTextAnnotation[]>([]);

  const isPdf = isPdfPath(bookPath);

  useEffect(() => {
    void loadOllamaConfig()
      .then((config) => setConfiguredModel(config.model))
      .catch(() => setConfiguredModel(null));
  }, []);

  useEffect(() => {
    let cancelled = false;

    setPageCount(0);
    setCurrentPage(1);
    setInitialPage(null);
    setPositionLoaded(false);
    setSelection(null);
    setAiResult(null);
    setAiError(null);
    setQuestion("");
    setNoteStatus("idle");
    setHighlightStatus("idle");

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

  useEffect(() => {
    let cancelled = false;

    if (!bookPath || !isPdfPath(bookPath)) {
      setAnnotations([]);
      return () => {
        cancelled = true;
      };
    }

    void listPdfTextAnnotations(bookPath)
      .then((items) => {
        if (!cancelled) setAnnotations(items);
      })
      .catch((error) => {
        console.error("Unable to load PDF annotations", error);
        if (!cancelled) setAnnotations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [bookPath]);

  const zoomLabel = useMemo(
    () => Math.round(scale * 100) + "%",
    [scale],
  );

  const currentPageAnnotations = useMemo(
    () =>
      annotations.filter(
        (annotation) => annotation.anchor.page === currentPage,
      ),
    [annotations, currentPage],
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
    const browserSelection = window.getSelection();
    const text = normalizedText(browserSelection?.toString());
    if (!browserSelection || browserSelection.rangeCount === 0 || !text) {
      return;
    }

    const range = browserSelection.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonElement =
      commonNode.nodeType === 1
        ? (commonNode as Element)
        : commonNode.parentElement;
    const pageShell = commonElement?.closest<HTMLElement>(".pdf-page-shell");
    const context = normalizedText(
      pageShell?.querySelector<HTMLElement>(".textLayer")?.textContent,
    );
    const pageValue = Number(pageShell?.dataset.pdfPage);
    const selectedPage =
      Number.isInteger(pageValue) && pageValue > 0 ? pageValue : currentPage;

    const pageBounds = pageShell?.getBoundingClientRect();
    const rects: NormalizedRect[] =
      pageShell && pageBounds && pageBounds.width > 0 && pageBounds.height > 0
        ? Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
            .map((rect) => ({
              x: Math.max(0, Math.min(1, (rect.left - pageBounds.left) / pageBounds.width)),
              y: Math.max(0, Math.min(1, (rect.top - pageBounds.top) / pageBounds.height)),
              width: Math.max(0, Math.min(1, rect.width / pageBounds.width)),
              height: Math.max(0, Math.min(1, rect.height / pageBounds.height)),
            }))
        : [];

    setSelection({
      text,
      context,
      page: selectedPage,
      rects,
    });
    setAiResult(null);
    setAiError(null);
    setQuestion("");
    setNoteStatus("idle");
    setHighlightStatus("idle");
  }

  function captureSentence(event: ReactMouseEvent<HTMLDivElement>) {
    const targetElement =
      event.target instanceof Element ? event.target : null;
    const targetSpan = targetElement?.closest<HTMLSpanElement>(
      ".textLayer span",
    );
    const pageShell = targetElement?.closest<HTMLElement>(".pdf-page-shell");
    const textLayer = pageShell?.querySelector<HTMLElement>(".textLayer");

    if (!targetSpan || !pageShell || !textLayer) return;

    const spans = Array.from(
      textLayer.querySelectorAll<HTMLSpanElement>("span"),
    );
    const targetIndex = spans.indexOf(targetSpan);
    if (targetIndex < 0) return;

    const records: Array<{
      span: HTMLSpanElement;
      start: number;
      end: number;
    }> = [];

    let pageText = "";
    let targetOffset = 0;

    spans.forEach((span, index) => {
      const value = normalizedText(span.textContent);
      if (!value) return;

      if (pageText) pageText += " ";
      const start = pageText.length;
      pageText += value;
      const end = pageText.length;

      records.push({ span, start, end });
      if (index === targetIndex) {
        targetOffset = Math.min(end - 1, start + Math.floor(value.length / 2));
      }
    });

    if (!pageText) return;

    const sentenceRegex = /[^.!?]+(?:[.!?]+["')\]]*|$)/g;
    let match: RegExpExecArray | null;
    let sentenceStart = 0;
    let sentenceEnd = pageText.length;
    let sentenceText = pageText;

    while ((match = sentenceRegex.exec(pageText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (targetOffset >= start && targetOffset <= end) {
        sentenceStart = start;
        sentenceEnd = end;
        sentenceText = normalizedText(match[0]);
        break;
      }

      if (match[0].length === 0) {
        sentenceRegex.lastIndex += 1;
      }
    }

    if (!sentenceText) return;

    const pageBounds = pageShell.getBoundingClientRect();
    const rects: NormalizedRect[] =
      pageBounds.width > 0 && pageBounds.height > 0
        ? records
            .filter(
              (record) =>
                record.end >= sentenceStart && record.start <= sentenceEnd,
            )
            .flatMap((record) =>
              Array.from(record.span.getClientRects()).map((rect) => ({
                x: Math.max(
                  0,
                  Math.min(1, (rect.left - pageBounds.left) / pageBounds.width),
                ),
                y: Math.max(
                  0,
                  Math.min(1, (rect.top - pageBounds.top) / pageBounds.height),
                ),
                width: Math.max(
                  0,
                  Math.min(1, rect.width / pageBounds.width),
                ),
                height: Math.max(
                  0,
                  Math.min(1, rect.height / pageBounds.height),
                ),
              })),
            )
        : [];

    const pageValue = Number(pageShell.dataset.pdfPage);
    const selectedPage =
      Number.isInteger(pageValue) && pageValue > 0 ? pageValue : currentPage;

    const nextSelection: ActiveReaderSelection = {
      text: sentenceText,
      context: pageText,
      page: selectedPage,
      rects,
    };

    window.getSelection()?.removeAllRanges();
    setSelection(nextSelection);
    setAiResult(null);
    setAiError(null);
    setQuestion("");
    setNoteStatus("idle");
    setHighlightStatus("idle");

    void runAi("grammar", undefined, nextSelection);
  }

  async function runAi(
    mode: ReadingAnalysisMode,
    readerQuestion?: string,
    overrideSelection?: ActiveReaderSelection,
  ) {
    const targetSelection = overrideSelection ?? selection;
    if (!targetSelection || aiBusy) return;

    setAiBusy(true);
    setAiError(null);

    try {
      const result = await analyzeReadingSelection(
        targetSelection,
        mode,
        readerQuestion,
      );

      setConfiguredModel(result.model);
      setAiResult({
        title:
          mode === "grammar"
            ? "Grammar & structure"
            : mode === "ask"
              ? "Answer"
              : "Context explanation",
        text: result.text,
        model: result.model,
      });
    } catch (error) {
      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : "Local AI analysis failed.",
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function saveCurrentHighlight() {
    if (
      !bookPath ||
      !selection ||
      selection.rects.length === 0 ||
      highlightStatus === "saving"
    ) {
      return;
    }

    setHighlightStatus("saving");
    try {
      const created = await createUserPdfHighlight(
        bookPath,
        selection.page,
        selection.text,
        selection.context ?? "",
        selection.rects,
      );

      if (created) {
        setAnnotations((items) => [
          ...items.filter((item) => item.id !== created.id),
          created,
        ]);
        setHighlightStatus("saved");
        window.setTimeout(() => setHighlightStatus("idle"), 1500);
      } else {
        setHighlightStatus("idle");
      }
    } catch (error) {
      console.error("Unable to save PDF highlight", error);
      setHighlightStatus("idle");
    }
  }

  async function removeHighlight(annotationId: string) {
    try {
      await removePdfTextAnnotation(annotationId);
      setAnnotations((items) =>
        items.filter((annotation) => annotation.id !== annotationId),
      );
    } catch (error) {
      console.error("Unable to remove PDF highlight", error);
    }
  }

  async function saveCurrentNote() {
    if (!bookPath || !selection || noteStatus === "saving") return;

    setNoteStatus("saving");
    try {
      await createReaderNote(
        bookPath,
        selection.text,
        aiResult?.text ?? null,
      );
      setNoteStatus("saved");
      window.setTimeout(() => setNoteStatus("idle"), 1500);
    } catch (error) {
      console.error("Unable to save reading note", error);
      setNoteStatus("idle");
    }
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !selection) return;
    void runAi("ask", trimmed);
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
          <div
            className="document-stage"
            onMouseUp={captureSelection}
            onDoubleClick={captureSentence}
          >
            {!bookPath && (
              <div className="reader-empty-state">
                <span className="eyebrow">Reader</span>
                <h1>Open or drop a book to begin.</h1>
                <p>
                  PDF files render directly inside LexiPane. Your text remains
                  selectable so it can feed the annotation and AI layers.
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
                annotations={annotations}
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
            <span>{selection ? "Selection ready" : "Select text for AI"}</span>
          </footer>
        </section>

        <aside className="ai-pane">
          <header className="ai-pane-header">
            <div>
              <span className="eyebrow">AI Reading</span>
              <strong>Context assistance</strong>
            </div>
            <button className="model-pill">
              {configuredModel || "Ollama local"} ▾
            </button>
          </header>

          <div className="ai-scroll">
            {selection ? (
              <section className="assist-card selected-source-card">
                <div className="selection-card-heading">
                  <span className="assist-type blue">Selected text</span>
                  {selection.page && <small>Page {selection.page}</small>}
                </div>
                <blockquote>{selection.text}</blockquote>
                <div className="assist-actions">
                  <button
                    disabled={aiBusy}
                    onClick={() => void runAi("explain")}
                  >
                    Explain
                  </button>
                  <button
                    disabled={aiBusy}
                    onClick={() => void runAi("grammar")}
                  >
                    Analyze grammar
                  </button>
                  <button
                    disabled={
                      aiBusy ||
                      selection.rects.length === 0 ||
                      highlightStatus === "saving"
                    }
                    onClick={() => void saveCurrentHighlight()}
                  >
                    {highlightStatus === "saving"
                      ? "Highlighting…"
                      : highlightStatus === "saved"
                        ? "Highlighted"
                        : "Highlight"}
                  </button>
                  <button
                    disabled={aiBusy || noteStatus === "saving"}
                    onClick={() => void saveCurrentNote()}
                  >
                    {noteStatus === "saving"
                      ? "Saving…"
                      : noteStatus === "saved"
                        ? "Saved"
                        : "Save note"}
                  </button>
                  <button
                    disabled={aiBusy}
                    onClick={() => {
                      setSelection(null);
                      setAiResult(null);
                      setAiError(null);
                      setNoteStatus("idle");
                      setHighlightStatus("idle");
                    }}
                  >
                    Clear
                  </button>
                </div>
              </section>
            ) : (
              <section className="assist-card reader-ai-empty">
                <span className="assist-type yellow">Reading context</span>
                <h3>Select text on the PDF.</h3>
                <p>
                  Select a word or phrase for contextual help. Double-click
                  inside a PDF sentence to select that sentence and run grammar
                  analysis automatically.
                </p>
              </section>
            )}

            {aiBusy && (
              <section className="assist-card ai-progress-card">
                <span className="pdf-spinner" />
                <div>
                  <strong>Analyzing locally…</strong>
                  <p>Nothing from this request is being sent to a cloud model.</p>
                </div>
              </section>
            )}

            {aiError && (
              <section className="assist-card ai-error-card">
                <span className="assist-type orange">Local AI error</span>
                <h3>Ollama could not complete the request.</h3>
                <p>{aiError}</p>
                <p className="muted">
                  Open AI & Models to verify that Ollama is running and a model
                  is installed.
                </p>
              </section>
            )}

            {aiResult && !aiBusy && (
              <section className="assist-card ai-answer-card">
                <div className="ai-answer-heading">
                  <div>
                    <span className="assist-type yellow">AI analysis</span>
                    <h3>{aiResult.title}</h3>
                  </div>
                  <small>{aiResult.model}</small>
                </div>
                <div className="ai-answer-text">{aiResult.text}</div>
              </section>
            )}

            {currentPageAnnotations.length > 0 && (
              <section className="assist-card page-highlights-card">
                <span className="assist-type blue">Page highlights</span>
                <h3>{currentPageAnnotations.length} saved on this page</h3>
                <div className="page-highlight-list">
                  {currentPageAnnotations.map((annotation) => (
                    <div key={annotation.id}>
                      <span>{annotation.selectedText}</span>
                      <button
                        onClick={() => void removeHighlight(annotation.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <form className="ask-box" onSubmit={submitQuestion}>
            <textarea
              rows={2}
              value={question}
              disabled={!selection || aiBusy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                selection
                  ? "Ask about the selected text…"
                  : "Select text before asking a question…"
              }
            />
            <button
              type="submit"
              disabled={!selection || !question.trim() || aiBusy}
            >
              Ask
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
