import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  createAutoPdfHighlight,
  createUserPdfHighlight,
  listPdfTextAnnotations,
  removePdfTextAnnotation,
  type NormalizedRect,
  type PdfTextAnnotation,
} from "../../core/annotations/pdfAnnotations";
import {
  detectDifficultTerms,
  type DifficultTerm,
} from "../../core/ai/difficultyService";
import { loadOllamaConfig } from "../../core/ai/ollamaConfig";
import {
  analyzeReadingSelection,
  type ReadingAnalysisMode,
  type ReadingSelection,
} from "../../core/ai/readingService";
import { isPdfPath } from "../../core/books/openBook";
import { updateBookMetadata } from "../../core/books/library";
import { createReaderNote } from "../../core/notes/notes";
import type {
  PdfMetadataSummary,
  PdfOutlineEntry,
} from "../../core/documents/pdf/pdfInfo";
import {
  recordTermFeedback,
  normalizeTerm,
} from "../../core/reading/knownTerms";
import {
  loadReadingLevel,
  type ReadingLevel,
} from "../../core/reading/preferences";
import {
  loadPdfReadingPosition,
  savePdfReadingPosition,
} from "../../core/books/readingPosition";
import { PdfDocumentView } from "./PdfDocumentView";
import { getPdfPageText, locatePdfTextRects } from "./pdfTextDom";
import {
  capturePdfRegion,
  type PdfRegionCapture,
} from "./pdfRegion";

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

interface RegionDragState {
  page: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  pageLeft: number;
  pageTop: number;
  pageWidth: number;
  pageHeight: number;
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
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>("B2");
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [autoTermsByPage, setAutoTermsByPage] =
    useState<Record<number, DifficultTerm[]>>({});
  const [difficultyBusyPage, setDifficultyBusyPage] =
    useState<number | null>(null);
  const [difficultyError, setDifficultyError] = useState<string | null>(null);
  const [pdfMetadata, setPdfMetadata] = useState<PdfMetadataSummary>({
    title: null,
    author: null,
  });
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [regionDrag, setRegionDrag] = useState<RegionDragState | null>(null);
  const [regionCapture, setRegionCapture] = useState<PdfRegionCapture | null>(null);

  const isPdf = isPdfPath(bookPath);

  useEffect(() => {
    void loadOllamaConfig()
      .then((config) => setConfiguredModel(config.model))
      .catch(() => setConfiguredModel(null));

    void loadReadingLevel()
      .then(setReadingLevel)
      .catch(() => setReadingLevel("B2"));
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
    setPageTexts({});
    setAutoTermsByPage({});
    setDifficultyBusyPage(null);
    setDifficultyError(null);
    setPdfMetadata({ title: null, author: null });
    setOutline([]);
    setTocOpen(false);
    setRegionMode(false);
    setRegionDrag(null);
    setRegionCapture(null);

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

  useEffect(() => {
    if (!bookPath || !isPdf || difficultyBusyPage !== null) return;

    const pageText = pageTexts[currentPage] || getPdfPageText(currentPage);
    if (!pageText || pageText.length < 80) return;
    if (Object.prototype.hasOwnProperty.call(autoTermsByPage, currentPage)) {
      return;
    }

    let cancelled = false;
    setDifficultyBusyPage(currentPage);
    setDifficultyError(null);

    void detectDifficultTerms(pageText, readingLevel)
      .then(async (result) => {
        if (cancelled) return;

        setConfiguredModel((current) => result.model || current);

        const createdAnnotations: PdfTextAnnotation[] = [];

        for (const term of result.items) {
          const rects = locatePdfTextRects(currentPage, term.text);
          if (rects.length === 0) continue;

          const created = await createAutoPdfHighlight(
            bookPath,
            currentPage,
            term.text,
            pageText,
            rects,
            term.type,
          );

          if (created) {
            createdAnnotations.push(created);
          }
        }

        if (cancelled) return;

        setAutoTermsByPage((current) => ({
          ...current,
          [currentPage]: result.items,
        }));

        if (createdAnnotations.length > 0) {
          setAnnotations((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            for (const item of createdAnnotations) {
              byId.set(item.id, item);
            }
            return Array.from(byId.values());
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to detect difficult terms", error);
        setAutoTermsByPage((current) => ({
          ...current,
          [currentPage]: [],
        }));
        setDifficultyError(
          error instanceof Error
            ? error.message
            : "Automatic difficulty analysis failed.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setDifficultyBusyPage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    autoTermsByPage,
    bookPath,
    currentPage,
    isPdf,
    pageTexts,
    readingLevel,
  ]);

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

  const currentAutoTerms = autoTermsByPage[currentPage] ?? [];

  const zoomOut = useCallback(() => {
    setScale((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10));
  }, []);

  const handleDocumentLoaded = useCallback((count: number) => {
    setPageCount(count);
  }, []);

  const handlePageTextReady = useCallback(
    (page: number, text: string) => {
      setPageTexts((current) =>
        current[page] === text ? current : { ...current, [page]: text },
      );
    },
    [],
  );

  const handleMetadataReady = useCallback(
    (metadata: PdfMetadataSummary) => {
      setPdfMetadata(metadata);
      if (bookPath) {
        void updateBookMetadata(
          bookPath,
          metadata.title,
          metadata.author,
        ).catch((error) => {
          console.error("Unable to persist PDF metadata", error);
        });
      }
    },
    [bookPath],
  );

  const handleOutlineReady = useCallback((items: PdfOutlineEntry[]) => {
    setOutline(items);
  }, []);

  const jumpToPage = useCallback((page: number) => {
    const element = window.document.querySelector<HTMLElement>(
      '[data-pdf-page="' + page + '"]',
    );
    element?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
    setTocOpen(false);
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

  function beginRegionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!regionMode) return;

    const target = event.target instanceof Element ? event.target : null;
    const shell = target?.closest<HTMLElement>(".pdf-page-shell");
    if (!shell) return;

    const bounds = shell.getBoundingClientRect();
    const page = Number(shell.dataset.pdfPage);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const x = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );

    setRegionCapture(null);
    setRegionDrag({
      page,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      pageLeft: bounds.left,
      pageTop: bounds.top,
      pageWidth: bounds.width,
      pageHeight: bounds.height,
    });
  }

  function moveRegionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!regionMode || !regionDrag) return;

    const shell = window.document.querySelector<HTMLElement>(
      '.pdf-page-shell[data-pdf-page="' + regionDrag.page + '"]',
    );
    if (!shell) return;

    const bounds = shell.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );

    setRegionDrag((current) =>
      current
        ? {
            ...current,
            currentX: x,
            currentY: y,
            pageLeft: bounds.left,
            pageTop: bounds.top,
            pageWidth: bounds.width,
            pageHeight: bounds.height,
          }
        : current,
    );
  }

  function finishRegionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!regionMode || !regionDrag) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const rect: NormalizedRect = {
      x: Math.min(regionDrag.startX, regionDrag.currentX),
      y: Math.min(regionDrag.startY, regionDrag.currentY),
      width: Math.abs(regionDrag.currentX - regionDrag.startX),
      height: Math.abs(regionDrag.currentY - regionDrag.startY),
    };

    const page = regionDrag.page;
    setRegionDrag(null);
    setRegionMode(false);

    if (rect.width < 0.01 || rect.height < 0.01) return;

    const capture = capturePdfRegion(page, rect);
    if (!capture) return;

    setRegionCapture(capture);
    setSelection(null);
    setAiResult(null);
    setAiError(null);
    setQuestion("");
  }

  function explainCapturedRegion() {
    if (!regionCapture) return;

    if (!regionCapture.text) {
      setAiError(
        "This region has no selectable PDF text. OCR/vision routing is not connected yet; the image capture is ready for that next provider layer.",
      );
      return;
    }

    const nextSelection: ActiveReaderSelection = {
      text: regionCapture.text,
      context:
        pageTexts[regionCapture.page] || getPdfPageText(regionCapture.page),
      page: regionCapture.page,
      rects: [regionCapture.rect],
    };

    setSelection(nextSelection);
    void runAi("explain", undefined, nextSelection);
  }

  function captureSelection() {
    if (regionMode) return;

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
    if (regionMode) return;

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
        await recordTermFeedback(selection.text, "difficult");
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

  async function setAutoTermFeedback(
    term: DifficultTerm,
    status: "known" | "suppressed",
  ) {
    await recordTermFeedback(term.text, status);

    const normalized = normalizeTerm(term.text);
    const matching = annotations.filter(
      (annotation) =>
        annotation.source === "auto" &&
        annotation.anchor.page === currentPage &&
        normalizeTerm(annotation.selectedText) === normalized,
    );

    for (const annotation of matching) {
      await removePdfTextAnnotation(annotation.id);
    }

    setAnnotations((items) =>
      items.filter(
        (annotation) =>
          !(
            annotation.source === "auto" &&
            annotation.anchor.page === currentPage &&
            normalizeTerm(annotation.selectedText) === normalized
          ),
      ),
    );

    setAutoTermsByPage((current) => ({
      ...current,
      [currentPage]: (current[currentPage] ?? []).filter(
        (item) => normalizeTerm(item.text) !== normalized,
      ),
    }));
  }

  function explainAutoTerm(term: DifficultTerm) {
    const pageText = pageTexts[currentPage] || getPdfPageText(currentPage);
    const rects = locatePdfTextRects(currentPage, term.text);
    const nextSelection: ActiveReaderSelection = {
      text: term.text,
      context: pageText,
      page: currentPage,
      rects,
    };

    setSelection(nextSelection);
    setAiResult(null);
    setAiError(null);
    void runAi("explain", undefined, nextSelection);
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
            <strong>{pdfMetadata.title || fileName(bookPath)}</strong>
            <small>
              {pdfMetadata.author
                ? pdfMetadata.author + " · "
                : ""}
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
          {isPdf && outline.length > 0 && (
            <button
              className={tocOpen ? "ghost-button active" : "ghost-button"}
              onClick={() => setTocOpen((value) => !value)}
            >
              Contents
            </button>
          )}
          <button
            className={regionMode ? "ghost-button active" : "ghost-button"}
            onClick={() => {
              setRegionMode((value) => !value);
              setRegionDrag(null);
              setRegionCapture(null);
            }}
          >
            {regionMode ? "Cancel region" : "Region select"}
          </button>
          <button className="ghost-button">Notes</button>
          <button className="primary-button compact" onClick={onOpenBook}>
            Open
          </button>
        </div>
      </header>

      <div className="split-reader">
        <section className="document-pane">
          {tocOpen && outline.length > 0 && (
            <aside className="toc-panel">
              <header>
                <div>
                  <span className="eyebrow">Contents</span>
                  <strong>{outline.length} sections</strong>
                </div>
                <button onClick={() => setTocOpen(false)}>×</button>
              </header>
              <div className="toc-list">
                {outline.map((item) => (
                  <button
                    key={item.id}
                    disabled={!item.page}
                    className={
                      item.page === currentPage
                        ? "toc-item current"
                        : "toc-item"
                    }
                    style={{ paddingLeft: 12 + item.depth * 14 }}
                    onClick={() => item.page && jumpToPage(item.page)}
                  >
                    <span>{item.title}</span>
                    {item.page && <small>{item.page}</small>}
                  </button>
                ))}
              </div>
            </aside>
          )}
          <div
            className={regionMode ? "document-stage region-mode" : "document-stage"}
            onMouseUp={captureSelection}
            onDoubleClick={captureSentence}
            onPointerDown={beginRegionSelection}
            onPointerMove={moveRegionSelection}
            onPointerUp={finishRegionSelection}
            onPointerCancel={() => setRegionDrag(null)}
          >
            {regionDrag && (
              <div
                className="region-drag-box"
                style={{
                  left:
                    regionDrag.pageLeft +
                    Math.min(regionDrag.startX, regionDrag.currentX) *
                      regionDrag.pageWidth,
                  top:
                    regionDrag.pageTop +
                    Math.min(regionDrag.startY, regionDrag.currentY) *
                      regionDrag.pageHeight,
                  width:
                    Math.abs(regionDrag.currentX - regionDrag.startX) *
                    regionDrag.pageWidth,
                  height:
                    Math.abs(regionDrag.currentY - regionDrag.startY) *
                    regionDrag.pageHeight,
                }}
              />
            )}
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
                onPageTextReady={handlePageTextReady}
                onMetadataReady={handleMetadataReady}
                onOutlineReady={handleOutlineReady}
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
            <div className="ai-pane-meta">
              <span>{readingLevel} reader</span>
              <button className="model-pill">
                {configuredModel || "Ollama local"} ▾
              </button>
            </div>
          </header>

          <div className="ai-scroll">
            {regionCapture && (
              <section className="assist-card region-capture-card">
                <div className="selection-card-heading">
                  <span className="assist-type blue">Region capture</span>
                  <small>Page {regionCapture.page}</small>
                </div>
                {regionCapture.imageDataUrl && (
                  <img
                    src={regionCapture.imageDataUrl}
                    alt="Selected PDF region"
                  />
                )}
                {regionCapture.text ? (
                  <blockquote>{regionCapture.text}</blockquote>
                ) : (
                  <p className="muted">
                    No selectable text was found in this region. The image is
                    captured and ready for a future OCR/vision route.
                  </p>
                )}
                <div className="assist-actions">
                  <button onClick={explainCapturedRegion}>
                    Explain region
                  </button>
                  <button onClick={() => setRegionCapture(null)}>
                    Clear
                  </button>
                </div>
              </section>
            )}

            <section className="assist-card auto-difficulty-card">
              <div className="auto-difficulty-heading">
                <div>
                  <span className="assist-type yellow">Auto reading help</span>
                  <h3>Page {currentPage}</h3>
                </div>
                <small>{readingLevel}</small>
              </div>

              {difficultyBusyPage === currentPage && (
                <div className="auto-difficulty-loading">
                  <span className="pdf-spinner" />
                  <span>Finding words and phrases that may slow you down…</span>
                </div>
              )}

              {difficultyError && difficultyBusyPage === null && (
                <p className="auto-difficulty-error">{difficultyError}</p>
              )}

              {difficultyBusyPage !== currentPage &&
                currentAutoTerms.length === 0 &&
                !difficultyError && (
                  <p className="muted">
                    No high-value reading obstacles were found on this page.
                  </p>
                )}

              {currentAutoTerms.length > 0 && (
                <div className="auto-term-list">
                  {currentAutoTerms.map((term) => (
                    <article
                      key={term.type + ":" + normalizeTerm(term.text)}
                      className={"auto-term " + term.type}
                    >
                      <div className="auto-term-copy">
                        <div>
                          <strong>{term.text}</strong>
                          <span>
                            {term.type}
                            {term.cefr ? " · " + term.cefr : ""}
                          </span>
                        </div>
                        <p>{term.meaning}</p>
                        {term.reason && <small>{term.reason}</small>}
                      </div>
                      <div className="auto-term-actions">
                        <button onClick={() => explainAutoTerm(term)}>
                          Explain
                        </button>
                        <button
                          onClick={() => void setAutoTermFeedback(term, "known")}
                        >
                          Known
                        </button>
                        <button
                          onClick={() =>
                            void setAutoTermFeedback(term, "suppressed")
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

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
