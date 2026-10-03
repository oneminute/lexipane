import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  createKindleHighlight,
  listKindleHighlights,
  removeKindleHighlight,
  type KindleTextAnnotation,
} from "../../core/annotations/kindleAnnotations";
import {
  createEpubHighlight,
  listEpubHighlights,
  removeEpubHighlight,
  type EpubTextAnnotation,
} from "../../core/annotations/epubAnnotations";
import {
  createAutoPdfHighlight,
  createUserPdfHighlight,
  listPdfTextAnnotations,
  removePdfTextAnnotation,
  updatePdfAnnotationRects,
  type NormalizedRect,
  type PdfTextAnnotation,
} from "../../core/annotations/pdfAnnotations";
import { stableHash } from "../../core/ai/cache";
import {
  detectDifficultTerms,
  type DifficultTerm,
} from "../../core/ai/difficultyService";
import { loadOllamaConfig } from "../../core/ai/ollamaConfig";
import { analyzeRegionImage } from "../../core/ai/regionService";
import type { AiPrivacyMode } from "../../core/ai/privacy";
import type { StructuredReadingAnalysis } from "../../core/ai/readingStructured";
import {
  streamReadingSelection,
  type ReadingAnalysisMode,
  type ReadingSelection,
} from "../../core/ai/readingService";
import {
  isEpubPath,
  isKindlePath,
  isPdfPath,
} from "../../core/books/openBook";
import {
  serializeReaderNavigationTarget,
  type ReaderNavigationTarget,
} from "../../core/books/navigation";
import {
  updateBookCover,
  updateBookMetadata,
} from "../../core/books/library";
import {
  loadBookPrivacyMode,
  saveBookPrivacyMode,
} from "../../core/books/bookPrivacy";
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
  loadEpubReadingPosition,
  saveEpubReadingPosition,
} from "../../core/books/epubPosition";
import {
  loadKindleReadingPosition,
  saveKindleReadingPosition,
} from "../../core/books/kindlePosition";
import {
  loadPdfReadingPosition,
  savePdfReadingPosition,
} from "../../core/books/readingPosition";
import {
  EpubDocumentView,
  type EpubMetadataSummary,
  type EpubOutlineEntry,
  type EpubSelection,
} from "./EpubDocumentView";
import {
  MobiDocumentView,
  type KindleMetadataSummary,
  type KindleOutlineEntry,
  type KindleSelection,
} from "./MobiDocumentView";
import { PdfDocumentView } from "./PdfDocumentView";
import { StructuredAnalysisView } from "./StructuredAnalysisView";
import { getPdfPageText, locatePdfTextRects } from "./pdfTextDom";
import {
  capturePdfRegion,
  type PdfRegionCapture,
} from "./pdfRegion";

interface Props {
  bookPath: string | null;
  navigationTarget?: ReaderNavigationTarget | null;
  onOpenBook: () => void;
  onBackToLibrary: () => void;
}

interface AiResultState {
  title: string;
  text: string;
  model: string;
  analysis?: StructuredReadingAnalysis;
  source?: string;
  fallbackUsed?: boolean;
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

function rectsApproximatelyEqual(
  a: NormalizedRect[],
  b: NormalizedRect[],
): boolean {
  if (a.length !== b.length) return false;

  const tolerance = 0.0025;
  return a.every((rect, index) => {
    const other = b[index];
    return (
      Math.abs(rect.x - other.x) <= tolerance &&
      Math.abs(rect.y - other.y) <= tolerance &&
      Math.abs(rect.width - other.width) <= tolerance &&
      Math.abs(rect.height - other.height) <= tolerance
    );
  });
}

export function ReaderView({
  bookPath,
  navigationTarget = null,
  onOpenBook,
  onBackToLibrary,
}: Props) {
  const [scale, setScale] = useState(1.1);
  const [epubFontScale, setEpubFontScale] = useState(100);
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
  const [bookPrivacyMode, setBookPrivacyMode] =
    useState<AiPrivacyMode | null>(null);
  const [noteStatus, setNoteStatus] =
    useState<"idle" | "saving" | "saved">("idle");
  const [highlightStatus, setHighlightStatus] =
    useState<"idle" | "saving" | "saved">("idle");
  const [annotations, setAnnotations] = useState<PdfTextAnnotation[]>([]);
  const annotationsRef = useRef<PdfTextAnnotation[]>([]);
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
  const [epubInitialCfi, setEpubInitialCfi] = useState<string | null>(null);
  const [epubProgress, setEpubProgress] = useState<number | null>(null);
  const [epubMetadata, setEpubMetadata] = useState<EpubMetadataSummary>({
    title: null,
    author: null,
  });
  const [epubOutline, setEpubOutline] = useState<EpubOutlineEntry[]>([]);
  const [epubNavigationTarget, setEpubNavigationTarget] =
    useState<string | null>(null);
  const [epubAnnotations, setEpubAnnotations] =
    useState<EpubTextAnnotation[]>([]);
  const [epubSelectionCfi, setEpubSelectionCfi] =
    useState<string | null>(null);
  const [epubContext, setEpubContext] = useState("");
  const [epubContextKey, setEpubContextKey] = useState("");
  const [epubAnalyzedContextKey, setEpubAnalyzedContextKey] = useState("");
  const [epubAutoTerms, setEpubAutoTerms] = useState<DifficultTerm[]>([]);
  const [epubDifficultyBusy, setEpubDifficultyBusy] = useState(false);
  const [epubDifficultyError, setEpubDifficultyError] =
    useState<string | null>(null);
  const [kindleInitialChapterId, setKindleInitialChapterId] =
    useState<string | null>(null);
  const [kindleProgress, setKindleProgress] = useState<number | null>(null);
  const [kindleMetadata, setKindleMetadata] =
    useState<KindleMetadataSummary>({
      title: null,
      author: null,
    });
  const [kindleOutline, setKindleOutline] =
    useState<KindleOutlineEntry[]>([]);
  const [kindleNavigationChapterId, setKindleNavigationChapterId] =
    useState<string | null>(null);
  const [kindleAnnotations, setKindleAnnotations] =
    useState<KindleTextAnnotation[]>([]);
  const [kindleSelectionChapterId, setKindleSelectionChapterId] =
    useState<string | null>(null);
  const [kindleContext, setKindleContext] = useState("");
  const [kindleContextKey, setKindleContextKey] = useState("");
  const [kindleAnalyzedContextKey, setKindleAnalyzedContextKey] =
    useState("");
  const [kindleAutoTerms, setKindleAutoTerms] =
    useState<DifficultTerm[]>([]);
  const [kindleDifficultyBusy, setKindleDifficultyBusy] = useState(false);
  const [kindleDifficultyError, setKindleDifficultyError] =
    useState<string | null>(null);

  const isPdf = isPdfPath(bookPath);
  const isEpub = isEpubPath(bookPath);
  const isKindle = isKindlePath(bookPath);

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
    setEpubInitialCfi(null);
    setEpubProgress(null);
    setEpubMetadata({ title: null, author: null });
    setEpubOutline([]);
    setEpubNavigationTarget(null);
    setEpubAnnotations([]);
    setEpubSelectionCfi(null);
    setEpubContext("");
    setEpubContextKey("");
    setEpubAnalyzedContextKey("");
    setEpubAutoTerms([]);
    setEpubDifficultyBusy(false);
    setEpubDifficultyError(null);
    setKindleInitialChapterId(null);
    setKindleProgress(null);
    setKindleMetadata({ title: null, author: null });
    setKindleOutline([]);
    setKindleNavigationChapterId(null);
    setKindleAnnotations([]);
    setKindleSelectionChapterId(null);
    setKindleContext("");
    setKindleContextKey("");
    setKindleAnalyzedContextKey("");
    setKindleAutoTerms([]);
    setKindleDifficultyBusy(false);
    setKindleDifficultyError(null);
    setBookPrivacyMode(null);

    if (!bookPath) {
      setPositionLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    void loadBookPrivacyMode(bookPath)
      .then((mode) => {
        if (!cancelled) setBookPrivacyMode(mode);
      })
      .catch((error) => {
        console.error("Unable to load book privacy mode", error);
      });

    if (isPdfPath(bookPath)) {
      void loadPdfReadingPosition(bookPath)
        .then((position) => {
          if (cancelled) return;
          const targetPage =
            navigationTarget?.kind === "pdf-page"
              ? navigationTarget.page
              : position?.page ?? 1;
          setInitialPage(targetPage);
          setCurrentPage(targetPage);
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
    } else if (isEpubPath(bookPath)) {
      void loadEpubReadingPosition(bookPath)
        .then((position) => {
          if (cancelled) return;
          setEpubInitialCfi(
            navigationTarget?.kind === "epub-cfi"
              ? navigationTarget.cfi
              : position?.cfi ?? null,
          );
          setEpubProgress(position?.progress ?? null);
        })
        .catch((error) => {
          console.error("Unable to restore EPUB reading position", error);
        })
        .finally(() => {
          if (!cancelled) {
            setPositionLoaded(true);
          }
        });
    } else if (isKindlePath(bookPath)) {
      void loadKindleReadingPosition(bookPath)
        .then((position) => {
          if (cancelled) return;
          setKindleInitialChapterId(
            navigationTarget?.kind === "kindle-chapter"
              ? navigationTarget.chapterId
              : position?.chapterId ?? null,
          );
          setKindleProgress(position?.progress ?? null);
        })
        .catch((error) => {
          console.error("Unable to restore Kindle reading position", error);
        })
        .finally(() => {
          if (!cancelled) {
            setPositionLoaded(true);
          }
        });
    } else {
      setPositionLoaded(true);
    }

    return () => {
      cancelled = true;
    };
  }, [bookPath, navigationTarget]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

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
    let cancelled = false;

    if (!bookPath || !isEpubPath(bookPath)) {
      setEpubAnnotations([]);
      return () => {
        cancelled = true;
      };
    }

    void listEpubHighlights(bookPath)
      .then((items) => {
        if (!cancelled) setEpubAnnotations(items);
      })
      .catch((error) => {
        console.error("Unable to load EPUB annotations", error);
        if (!cancelled) setEpubAnnotations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [bookPath]);

  useEffect(() => {
    let cancelled = false;

    if (!bookPath || !isKindlePath(bookPath)) {
      setKindleAnnotations([]);
      return () => {
        cancelled = true;
      };
    }

    void listKindleHighlights(bookPath)
      .then((items) => {
        if (!cancelled) setKindleAnnotations(items);
      })
      .catch((error) => {
        console.error("Unable to load Kindle annotations", error);
        if (!cancelled) setKindleAnnotations([]);
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

    void detectDifficultTerms(pageText, readingLevel, bookPath)
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

  useEffect(() => {
    if (
      !bookPath ||
      !isEpub ||
      !epubContext ||
      epubContext.length < 80 ||
      !epubContextKey ||
      epubContextKey === epubAnalyzedContextKey ||
      epubDifficultyBusy
    ) {
      return;
    }

    let cancelled = false;
    const analysisKey = epubContextKey;

    setEpubAnalyzedContextKey(analysisKey);
    setEpubDifficultyBusy(true);
    setEpubDifficultyError(null);

    void detectDifficultTerms(epubContext, readingLevel, bookPath)
      .then((result) => {
        if (cancelled) return;

        setConfiguredModel((current) => result.model || current);
        setEpubAutoTerms(result.items);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to detect EPUB difficult terms", error);
        setEpubAutoTerms([]);
        setEpubDifficultyError(
          error instanceof Error
            ? error.message
            : "Automatic EPUB difficulty analysis failed.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setEpubDifficultyBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bookPath,
    epubAnalyzedContextKey,
    epubContext,
    epubContextKey,
    epubDifficultyBusy,
    isEpub,
    readingLevel,
  ]);

  useEffect(() => {
    if (
      !bookPath ||
      !isKindle ||
      !kindleContext ||
      kindleContext.length < 80 ||
      !kindleContextKey ||
      kindleContextKey === kindleAnalyzedContextKey ||
      kindleDifficultyBusy
    ) {
      return;
    }

    let cancelled = false;
    const analysisKey = kindleContextKey;

    setKindleAnalyzedContextKey(analysisKey);
    setKindleDifficultyBusy(true);
    setKindleDifficultyError(null);

    void detectDifficultTerms(kindleContext, readingLevel, bookPath)
      .then((result) => {
        if (cancelled) return;

        setConfiguredModel((current) => result.model || current);
        setKindleAutoTerms(result.items);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to detect Kindle difficult terms", error);
        setKindleAutoTerms([]);
        setKindleDifficultyError(
          error instanceof Error
            ? error.message
            : "Automatic Kindle difficulty analysis failed.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setKindleDifficultyBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bookPath,
    isKindle,
    kindleAnalyzedContextKey,
    kindleContext,
    kindleContextKey,
    kindleDifficultyBusy,
    readingLevel,
  ]);

  const zoomLabel = useMemo(
    () => Math.round(scale * 100) + "%",
    [scale],
  );

  const epubFontLabel = epubFontScale + "%";

  const currentPageAnnotations = useMemo(
    () =>
      annotations.filter(
        (annotation) => annotation.anchor.page === currentPage,
      ),
    [annotations, currentPage],
  );

  const currentAutoTerms = isEpub
    ? epubAutoTerms
    : isKindle
      ? kindleAutoTerms
      : autoTermsByPage[currentPage] ?? [];

  const zoomOut = useCallback(() => {
    setScale((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10));
  }, []);

  const epubFontDown = useCallback(() => {
    setEpubFontScale((value) => Math.max(70, value - 10));
  }, []);

  const epubFontUp = useCallback(() => {
    setEpubFontScale((value) => Math.min(180, value + 10));
  }, []);

  const handleDocumentLoaded = useCallback((count: number) => {
    setPageCount(count);
  }, []);

  const handlePageTextReady = useCallback(
    (page: number, text: string) => {
      setPageTexts((current) =>
        current[page] === text ? current : { ...current, [page]: text },
      );

      const pageAnnotations = annotationsRef.current.filter(
        (annotation) => annotation.anchor.page === page,
      );
      if (pageAnnotations.length === 0) return;

      const repaired = new Map<string, NormalizedRect[]>();

      for (const annotation of pageAnnotations) {
        const rects = locatePdfTextRects(
          page,
          annotation.anchor.exact,
          annotation.anchor.prefix,
          annotation.anchor.suffix,
        );

        if (
          rects.length > 0 &&
          !rectsApproximatelyEqual(rects, annotation.anchor.rects)
        ) {
          repaired.set(annotation.id, rects);
          void updatePdfAnnotationRects(annotation.id, rects).catch(
            (error) => {
              console.error("Unable to repair PDF annotation anchor", error);
            },
          );
        }
      }

      if (repaired.size > 0) {
        setAnnotations((current) => {
          const next = current.map((annotation) => {
            const rects = repaired.get(annotation.id);
            return rects
              ? {
                  ...annotation,
                  anchor: {
                    ...annotation.anchor,
                    rects,
                  },
                }
              : annotation;
          });
          annotationsRef.current = next;
          return next;
        });
      }
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

  const handlePdfCoverReady = useCallback(
    (coverDataUrl: string) => {
      if (!bookPath) return;
      void updateBookCover(bookPath, coverDataUrl).catch((error) => {
        console.error("Unable to persist PDF cover", error);
      });
    },
    [bookPath],
  );

  const handleEpubMetadataReady = useCallback(
    (metadata: EpubMetadataSummary) => {
      setEpubMetadata(metadata);
      if (bookPath) {
        void updateBookMetadata(
          bookPath,
          metadata.title,
          metadata.author,
        ).catch((error) => {
          console.error("Unable to persist EPUB metadata", error);
        });
      }
    },
    [bookPath],
  );

  const handleEpubOutlineReady = useCallback(
    (items: EpubOutlineEntry[]) => {
      setEpubOutline(items);
    },
    [],
  );

  const handleEpubRelocated = useCallback(
    (cfi: string, progress: number | null) => {
      setEpubProgress(progress);
      if (!bookPath) return;

      void saveEpubReadingPosition(bookPath, cfi, progress).catch(
        (error) => {
          console.error("Unable to save EPUB reading position", error);
        },
      );
    },
    [bookPath],
  );

  const handleEpubContextReady = useCallback(
    (_cfi: string, context: string) => {
      const normalized = normalizedText(context).slice(0, 9000);
      if (!normalized) return;

      const key = stableHash(normalized);
      setEpubContext((current) =>
        current === normalized ? current : normalized,
      );
      setEpubContextKey((current) =>
        current === key ? current : key,
      );
    },
    [],
  );

  const handleEpubSelection = useCallback(
    (selected: EpubSelection) => {
      setEpubSelectionCfi(selected.cfi);
      const normalizedContext = normalizedText(selected.context).slice(0, 9000);
      if (normalizedContext) {
        setEpubContext(normalizedContext);
        setEpubContextKey(stableHash(normalizedContext));
      }
      setSelection({
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
      });
      setAiResult(null);
      setAiError(null);
      setQuestion("");
      setNoteStatus("idle");
      setHighlightStatus("idle");
    },
    [],
  );

  const handleKindleMetadataReady = useCallback(
    (metadata: KindleMetadataSummary) => {
      setKindleMetadata(metadata);
      if (bookPath) {
        void updateBookMetadata(
          bookPath,
          metadata.title,
          metadata.author,
        ).catch((error) => {
          console.error("Unable to persist Kindle metadata", error);
        });
      }
    },
    [bookPath],
  );

  const handleKindleOutlineReady = useCallback(
    (items: KindleOutlineEntry[]) => {
      setKindleOutline(items);
    },
    [],
  );

  const handleKindleRelocated = useCallback(
    (chapterId: string, progress: number | null) => {
      setKindleProgress(progress);
      if (!bookPath) return;

      void saveKindleReadingPosition(
        bookPath,
        chapterId,
        progress,
      ).catch((error) => {
        console.error("Unable to save Kindle reading position", error);
      });
    },
    [bookPath],
  );

  const handleKindleContextReady = useCallback(
    (_chapterId: string, context: string) => {
      const normalized = normalizedText(context).slice(0, 9000);
      if (!normalized) return;

      const key = stableHash(normalized);
      setKindleContext((current) =>
        current === normalized ? current : normalized,
      );
      setKindleContextKey((current) =>
        current === key ? current : key,
      );
    },
    [],
  );

  const handleKindleSelection = useCallback(
    (selected: KindleSelection) => {
      setKindleSelectionChapterId(selected.chapterId);

      const normalizedContext = normalizedText(
        selected.context,
      ).slice(0, 9000);
      if (normalizedContext) {
        setKindleContext(normalizedContext);
        setKindleContextKey(stableHash(normalizedContext));
      }

      setSelection({
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
      });
      setAiResult(null);
      setAiError(null);
      setQuestion("");
      setNoteStatus("idle");
      setHighlightStatus("idle");
    },
    [],
  );

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
        "No selectable PDF text was found in this region. Use Analyze image with a vision-capable Ollama model.",
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

  async function analyzeCapturedRegionImage() {
    if (!regionCapture?.imageDataUrl || aiBusy) return;

    setAiBusy(true);
    setAiError(null);

    try {
      const result = await analyzeRegionImage(
        regionCapture.imageDataUrl,
        pageTexts[regionCapture.page] || getPdfPageText(regionCapture.page),
        undefined,
        bookPath,
      );

      setConfiguredModel(result.model);
      setAiResult({
        title: "Region / image analysis",
        text: result.text,
        model: result.model,
      });
    } catch (error) {
      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : "Region image analysis failed.",
      );
    } finally {
      setAiBusy(false);
    }
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

    const title =
      mode === "grammar"
        ? "Grammar & structure"
        : mode === "ask"
          ? "Answer"
          : "Context explanation";

    setAiBusy(true);
    setAiError(null);
    setAiResult({
      title,
      text: "",
      model: configuredModel || "Routing…",
    });

    try {
      const result = await streamReadingSelection(
        {
          ...targetSelection,
          bookPath,
        },
        mode,
        readerQuestion,
        (accumulatedText) => {
          setAiResult((current) => ({
            title,
            text: accumulatedText,
            model: current?.model || configuredModel || "Structuring…",
          }));
        },
      );

      setConfiguredModel(result.model);
      setAiResult({
        title,
        text: result.text,
        model: result.model,
        analysis: result.analysis,
        source: result.source,
        fallbackUsed: result.fallbackUsed,
      });
    } catch (error) {
      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : "AI analysis failed.",
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function saveCurrentHighlight() {
    if (
      !bookPath ||
      !selection ||
      highlightStatus === "saving"
    ) {
      return;
    }

    setHighlightStatus("saving");
    try {
      if (isEpub) {
        if (!epubSelectionCfi) {
          setHighlightStatus("idle");
          return;
        }

        const created = await createEpubHighlight(
          bookPath,
          epubSelectionCfi,
          selection.text,
          selection.context ?? "",
        );

        if (created) {
          await recordTermFeedback(selection.text, "difficult");
          setEpubAnnotations((items) => [
            ...items.filter((item) => item.id !== created.id),
            created,
          ]);
          setHighlightStatus("saved");
          window.setTimeout(() => setHighlightStatus("idle"), 1500);
          return;
        }

        setHighlightStatus("idle");
        return;
      }

      if (isKindle) {
        if (!kindleSelectionChapterId) {
          setHighlightStatus("idle");
          return;
        }

        const created = await createKindleHighlight(
          bookPath,
          kindleSelectionChapterId,
          selection.text,
          selection.context ?? "",
        );

        if (created) {
          await recordTermFeedback(selection.text, "difficult");
          setKindleAnnotations((items) => [
            ...items.filter((item) => item.id !== created.id),
            created,
          ]);
          setHighlightStatus("saved");
          window.setTimeout(() => setHighlightStatus("idle"), 1500);
          return;
        }

        setHighlightStatus("idle");
        return;
      }

      if (!isPdf || selection.rects.length === 0) {
        setHighlightStatus("idle");
        return;
      }

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
      console.error("Unable to save reading highlight", error);
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

  async function removeEpubSavedHighlight(annotationId: string) {
    try {
      await removeEpubHighlight(annotationId);
      setEpubAnnotations((items) =>
        items.filter((annotation) => annotation.id !== annotationId),
      );
    } catch (error) {
      console.error("Unable to remove EPUB highlight", error);
    }
  }

  async function removeKindleSavedHighlight(annotationId: string) {
    try {
      await removeKindleHighlight(annotationId);
      setKindleAnnotations((items) =>
        items.filter((annotation) => annotation.id !== annotationId),
      );
    } catch (error) {
      console.error("Unable to remove Kindle highlight", error);
    }
  }

  async function setAutoTermFeedback(
    term: DifficultTerm,
    status: "known" | "suppressed",
  ) {
    await recordTermFeedback(term.text, status);

    const normalized = normalizeTerm(term.text);

    if (isEpub) {
      setEpubAutoTerms((items) =>
        items.filter(
          (item) => normalizeTerm(item.text) !== normalized,
        ),
      );
      return;
    }

    if (isKindle) {
      setKindleAutoTerms((items) =>
        items.filter(
          (item) => normalizeTerm(item.text) !== normalized,
        ),
      );
      return;
    }
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
    if (isEpub) {
      const nextSelection: ActiveReaderSelection = {
        text: term.text,
        context: epubContext,
        page: 0,
        rects: [],
      };

      setEpubSelectionCfi(null);
      setSelection(nextSelection);
      setAiResult(null);
      setAiError(null);
      void runAi("explain", undefined, nextSelection);
      return;
    }

    if (isKindle) {
      const nextSelection: ActiveReaderSelection = {
        text: term.text,
        context: kindleContext,
        page: 0,
        rects: [],
      };

      setKindleSelectionChapterId(null);
      setSelection(nextSelection);
      setAiResult(null);
      setAiError(null);
      void runAi("explain", undefined, nextSelection);
      return;
    }

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

    let noteTarget: ReaderNavigationTarget | null = null;

    if (isEpub && epubSelectionCfi) {
      noteTarget = {
        kind: "epub-cfi",
        cfi: epubSelectionCfi,
      };
    } else if (isKindle && kindleSelectionChapterId) {
      noteTarget = {
        kind: "kindle-chapter",
        chapterId: kindleSelectionChapterId,
      };
    } else if (isPdf && selection.page >= 1) {
      noteTarget = {
        kind: "pdf-page",
        page: selection.page,
      };
    }

    setNoteStatus("saving");
    try {
      await createReaderNote(
        bookPath,
        selection.text,
        aiResult?.text ?? null,
        serializeReaderNavigationTarget(noteTarget),
      );
      setNoteStatus("saved");
      window.setTimeout(() => setNoteStatus("idle"), 1500);
    } catch (error) {
      console.error("Unable to save reading note", error);
      setNoteStatus("idle");
    }
  }

  async function changeBookPrivacy(value: string) {
    if (!bookPath) return;

    const mode =
      value === "inherit" ? null : (value as AiPrivacyMode);

    setBookPrivacyMode(mode);

    try {
      await saveBookPrivacyMode(bookPath, mode);

      // Re-evaluate automatic assistance under the new privacy policy.
      setAutoTermsByPage({});
      setEpubAutoTerms([]);
      setEpubAnalyzedContextKey("");
      setKindleAutoTerms([]);
      setKindleAnalyzedContextKey("");
      setAiResult(null);
      setAiError(null);
    } catch (error) {
      console.error("Unable to save book privacy mode", error);
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
            <strong>
              {(isEpub
                ? epubMetadata.title
                : isKindle
                  ? kindleMetadata.title
                  : pdfMetadata.title) || fileName(bookPath)}
            </strong>
            <small>
              {(isEpub
                ? epubMetadata.author
                : isKindle
                  ? kindleMetadata.author
                  : pdfMetadata.author)
                ? (isEpub
                    ? epubMetadata.author
                    : isKindle
                      ? kindleMetadata.author
                      : pdfMetadata.author) + " · "
                : ""}
              {isPdf
                ? pageCount > 0
                  ? pageCount + " pages"
                  : "Opening PDF…"
                : isEpub
                  ? epubProgress !== null
                    ? Math.round(epubProgress * 100) + "% read"
                    : "EPUB"
                  : isKindle
                    ? kindleProgress !== null
                      ? Math.round(kindleProgress * 100) + "% read"
                      : "MOBI / Kindle"
                    : bookPath
                    ? "Format saved · reader engine pending"
                    : "Open a book to begin"}
            </small>
          </div>
        </div>

        <div className="reader-actions">
          {(isPdf || isEpub || isKindle) && (
            <div className="zoom-control">
              <button
                onClick={isEpub || isKindle ? epubFontDown : zoomOut}
                aria-label={isEpub || isKindle ? "Decrease font size" : "Zoom out"}
              >
                −
              </button>
              <span>{isEpub || isKindle ? epubFontLabel : zoomLabel}</span>
              <button
                onClick={isEpub || isKindle ? epubFontUp : zoomIn}
                aria-label={isEpub || isKindle ? "Increase font size" : "Zoom in"}
              >
                +
              </button>
            </div>
          )}
          {((isPdf && outline.length > 0) ||
            (isEpub && epubOutline.length > 0) ||
            (isKindle && kindleOutline.length > 0)) && (
            <button
              className={tocOpen ? "ghost-button active" : "ghost-button"}
              onClick={() => setTocOpen((value) => !value)}
            >
              Contents
            </button>
          )}
          {isPdf && (
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
          )}
          {bookPath && (
            <label
              className="book-privacy-control"
              title="Override the global AI privacy policy for this book"
            >
              <span>Privacy</span>
              <select
                value={bookPrivacyMode ?? "inherit"}
                onChange={(event) =>
                  void changeBookPrivacy(event.target.value)
                }
              >
                <option value="inherit">Global</option>
                <option value="local-only">Local only</option>
                <option value="prefer-local">Prefer local</option>
                <option value="automatic">Automatic</option>
                <option value="cloud-only">Cloud only</option>
              </select>
            </label>
          )}
          <button className="ghost-button">Notes</button>
          <button className="primary-button compact" onClick={onOpenBook}>
            Open
          </button>
        </div>
      </header>

      <div className="split-reader">
        <section className="document-pane">
          {tocOpen && isPdf && outline.length > 0 && (
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

          {tocOpen && isEpub && epubOutline.length > 0 && (
            <aside className="toc-panel">
              <header>
                <div>
                  <span className="eyebrow">Contents</span>
                  <strong>{epubOutline.length} sections</strong>
                </div>
                <button onClick={() => setTocOpen(false)}>×</button>
              </header>
              <div className="toc-list">
                {epubOutline.map((item) => (
                  <button
                    key={item.id}
                    className="toc-item"
                    style={{ paddingLeft: 12 + item.depth * 14 }}
                    onClick={() => {
                      setEpubNavigationTarget(item.href);
                      setTocOpen(false);
                    }}
                  >
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            </aside>
          )}
          {tocOpen && isKindle && kindleOutline.length > 0 && (
            <aside className="toc-panel">
              <header>
                <div>
                  <span className="eyebrow">Contents</span>
                  <strong>{kindleOutline.length} sections</strong>
                </div>
                <button onClick={() => setTocOpen(false)}>×</button>
              </header>
              <div className="toc-list">
                {kindleOutline.map((item) => (
                  <button
                    key={item.id}
                    disabled={!item.chapterId}
                    className="toc-item"
                    style={{ paddingLeft: 12 + item.depth * 14 }}
                    onClick={() => {
                      if (item.chapterId) {
                        setKindleNavigationChapterId(item.chapterId);
                      }
                      setTocOpen(false);
                    }}
                  >
                    <span>{item.title}</span>
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
                onCoverReady={handlePdfCoverReady}
              />
            )}

            {bookPath && isEpub && positionLoaded && (
              <EpubDocumentView
                path={bookPath}
                fontScale={epubFontScale}
                initialCfi={epubInitialCfi}
                navigationTarget={epubNavigationTarget}
                annotations={epubAnnotations}
                autoTerms={epubAutoTerms}
                onMetadataReady={handleEpubMetadataReady}
                onOutlineReady={handleEpubOutlineReady}
                onRelocated={handleEpubRelocated}
                onContextReady={handleEpubContextReady}
                onSelection={handleEpubSelection}
              />
            )}

            {bookPath && isKindle && positionLoaded && (
              <MobiDocumentView
                path={bookPath}
                fontScale={epubFontScale}
                initialChapterId={kindleInitialChapterId}
                navigationChapterId={kindleNavigationChapterId}
                annotations={kindleAnnotations}
                autoTerms={kindleAutoTerms}
                onMetadataReady={handleKindleMetadataReady}
                onOutlineReady={handleKindleOutlineReady}
                onRelocated={handleKindleRelocated}
                onContextReady={handleKindleContextReady}
                onSelection={handleKindleSelection}
              />
            )}

            {bookPath && (isPdf || isEpub || isKindle) && !positionLoaded && (
              <div className="pdf-state-card">
                <span className="pdf-spinner" />
                <strong>Restoring reading position…</strong>
              </div>
            )}

            {bookPath && !isPdf && !isEpub && !isKindle && (
              <div className="reader-empty-state">
                <span className="eyebrow">Document engine</span>
                <h1>This book is in your library.</h1>
                <p>
                  PDF, EPUB, MOBI and AZW/AZW3 use their own format-native
                  document engines behind the same annotation, notebook and
                  AI architecture.
                </p>
              </div>
            )}
          </div>

          <footer className="reader-statusbar">
            <span>
              {isEpub
                ? epubProgress !== null
                  ? Math.round(epubProgress * 100) + "% read"
                  : "EPUB"
                : isKindle
                  ? kindleProgress !== null
                    ? Math.round(kindleProgress * 100) + "% read"
                    : "Kindle"
                  : "Page " +
                  (pageCount ? currentPage : "—") +
                  " / " +
                  (pageCount || "—")}
            </span>
            <span>{isEpub || isKindle ? epubFontLabel : zoomLabel}</span>
            <span>
              {isEpub ? "EPUB CFI" : isKindle ? "Chapter" : "Continuous"}
            </span>
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
                  {regionCapture.text && (
                    <button
                      disabled={aiBusy}
                      onClick={explainCapturedRegion}
                    >
                      Explain text
                    </button>
                  )}
                  {regionCapture.imageDataUrl && (
                    <button
                      disabled={aiBusy}
                      onClick={() => void analyzeCapturedRegionImage()}
                    >
                      Analyze image
                    </button>
                  )}
                  <button
                    disabled={aiBusy}
                    onClick={() => setRegionCapture(null)}
                  >
                    Clear
                  </button>
                </div>
              </section>
            )}

            <section className="assist-card auto-difficulty-card">
              <div className="auto-difficulty-heading">
                <div>
                  <span className="assist-type yellow">Auto reading help</span>
                  <h3>
                    {isEpub
                      ? "Current EPUB section"
                      : isKindle
                        ? "Current Kindle chapter"
                        : "Page " + currentPage}
                  </h3>
                </div>
                <small>{readingLevel}</small>
              </div>

              {(isEpub
                ? epubDifficultyBusy
                : isKindle
                  ? kindleDifficultyBusy
                  : difficultyBusyPage === currentPage) && (
                <div className="auto-difficulty-loading">
                  <span className="pdf-spinner" />
                  <span>Finding words and phrases that may slow you down…</span>
                </div>
              )}

              {(isEpub
                ? epubDifficultyError
                : isKindle
                  ? kindleDifficultyError
                  : difficultyError) &&
                (isEpub
                  ? !epubDifficultyBusy
                  : isKindle
                    ? !kindleDifficultyBusy
                    : difficultyBusyPage === null) && (
                  <p className="auto-difficulty-error">
                    {isEpub
                      ? epubDifficultyError
                      : isKindle
                        ? kindleDifficultyError
                        : difficultyError}
                  </p>
                )}

              {(isEpub
                ? !epubDifficultyBusy
                : isKindle
                  ? !kindleDifficultyBusy
                  : difficultyBusyPage !== currentPage) &&
                currentAutoTerms.length === 0 &&
                !(isEpub
                  ? epubDifficultyError
                  : isKindle
                    ? kindleDifficultyError
                    : difficultyError) && (
                  <p className="muted">
                    No high-value reading obstacles were found in the current
                    reading context.
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
                      (isEpub
                        ? !epubSelectionCfi
                        : isKindle
                          ? !kindleSelectionChapterId
                          : selection.rects.length === 0) ||
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
                      setEpubSelectionCfi(null);
                      setKindleSelectionChapterId(null);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </section>
            ) : (
              <section className="assist-card reader-ai-empty">
                <span className="assist-type yellow">Reading context</span>
                <h3>Select text while reading.</h3>
                <p>
                  Select a word, phrase, or sentence for contextual help.
                  In PDF, double-click inside a sentence to run grammar
                  analysis automatically.
                </p>
              </section>
            )}

            {aiBusy && (
              <section className="assist-card ai-progress-card">
                <span className="pdf-spinner" />
                <div>
                  <strong>Analyzing with your configured AI route…</strong>
                  <p>
                    Privacy mode and task routing determine whether this stays
                    local or uses a configured cloud provider.
                  </p>
                </div>
              </section>
            )}

            {aiError && (
              <section className="assist-card ai-error-card">
                <span className="assist-type orange">AI error</span>
                <h3>The configured AI route could not complete the request.</h3>
                <p>{aiError}</p>
                <p className="muted">
                  Open AI & Models to verify the selected provider, model,
                  credentials, privacy mode, and task route.
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
                  <small>
                    {aiResult.source || aiResult.model}
                    {aiResult.fallbackUsed ? " · fallback" : ""}
                  </small>
                </div>
                {aiResult.analysis ? (
                  <StructuredAnalysisView analysis={aiResult.analysis} />
                ) : (
                  <div className="ai-answer-text">{aiResult.text}</div>
                )}
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

            {isEpub && epubAnnotations.length > 0 && (
              <section className="assist-card page-highlights-card">
                <span className="assist-type blue">EPUB highlights</span>
                <h3>{epubAnnotations.length} saved in this book</h3>
                <div className="page-highlight-list">
                  {epubAnnotations.slice(-12).reverse().map((annotation) => (
                    <div key={annotation.id}>
                      <span>{annotation.selectedText}</span>
                      <button
                        onClick={() =>
                          void removeEpubSavedHighlight(annotation.id)
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {isKindle && kindleAnnotations.length > 0 && (
              <section className="assist-card page-highlights-card">
                <span className="assist-type blue">Kindle highlights</span>
                <h3>{kindleAnnotations.length} saved in this book</h3>
                <div className="page-highlight-list">
                  {kindleAnnotations.slice(-12).reverse().map((annotation) => (
                    <div key={annotation.id}>
                      <span>{annotation.selectedText}</span>
                      <button
                        onClick={() =>
                          void removeKindleSavedHighlight(annotation.id)
                        }
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
