import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
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
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [aiResult, setAiResult] = useState<AiResultState | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [configuredModel, setConfiguredModel] = useState<string | null>(null);
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved">("idle");

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

    setSelection({
      text,
      context,
      page: selectedPage,
    });
    setAiResult(null);
    setAiError(null);
    setQuestion("");
    setNoteStatus("idle");
  }

  async function runAi(
    mode: ReadingAnalysisMode,
    readerQuestion?: string,
  ) {
    if (!selection || aiBusy) return;

    setAiBusy(true);
    setAiError(null);

    try {
      const result = await analyzeReadingSelection(
        selection,
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
          <div className="document-stage" onMouseUp={captureSelection}>
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
                  Select a word, phrase, or sentence. LexiPane will send the
                  selection together with surrounding page context to your
                  configured local Ollama model.
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
