import { APP_DEFAULTS } from "../../config/appDefaults";
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
  createUserPdfHighlight,
  listPdfTextAnnotations,
  removePdfTextAnnotation,
  updatePdfAnnotationRects,
  type NormalizedRect,
  type PdfTextAnnotation,
} from "../../core/annotations/pdfAnnotations";
import { stableHash } from "../../core/ai/cache";
import {
  createSentenceAnalysisKey,
  resolveSentenceAnalysis,
  type SentenceAnalysisVersion,
} from "../../core/ai/sentenceAnalysisHistory";
import { loadOllamaConfig } from "../../core/ai/ollamaConfig";
import { analyzeRegionImage } from "../../core/ai/regionService";
import type { AiPrivacyMode } from "../../core/ai/privacy";
import type { StructuredReadingAnalysis } from "../../core/ai/readingStructured";
import {
  buildReadingRequestDebug,
  streamReadingSelection,
  type ReadingAnalysisMode,
  type ReadingRequestDebug,
  type ReadingSelection,
} from "../../core/ai/readingService";
import {
  isEpubPath,
  isKindlePath,
  isPdfPath,
} from "../../core/books/openBook";
import {
  createReaderBookmark,
  listReaderBookmarks,
  removeReaderBookmark,
  type ReaderBookmark,
} from "../../core/books/bookmarks";
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
import { createNoteImageAsset } from "../../core/notes/noteAssets";
import {
  getLocalOcrStatus,
  recognizeImageDataUrl,
  type LocalOcrStatus,
} from "../../core/ocr/localOcr";
import type {
  PdfMetadataSummary,
  PdfOutlineEntry,
} from "../../core/documents/pdf/pdfInfo";
import { recordTermFeedback } from "../../core/reading/knownTerms";
import {
  loadReadingLevel,
  loadSentencePrefetchCount,
  type ReadingLevel,
} from "../../core/reading/preferences";
import {
  loadEbookReadingPreferences,
  saveEbookFontScale,
  saveEbookTheme,
  saveEpubFlow,
  type EbookTheme,
  type EpubFlowMode,
} from "../../core/reading/ebookPreferences";
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
  type EpubSentenceSelection,
} from "./EpubDocumentView";
import {
  MobiDocumentView,
  type KindleMetadataSummary,
  type KindleOutlineEntry,
  type KindleSelection,
  type KindleSentenceSelection,
} from "./MobiDocumentView";
import { PdfDocumentView } from "./PdfDocumentView";
import { BookProviderPolicyControl } from "./BookProviderPolicyControl";
import type { ReaderImagePreview } from "./readerImage";
import { AiRequestDebugPanel } from "./AiRequestDebugPanel";
import { StructuredAnalysisView } from "./StructuredAnalysisView";
import { getPdfPageText, locatePdfTextRects } from "./pdfTextDom";
import {
  capturePdfRegion,
  type PdfRegionCapture,
} from "./pdfRegion";
import { segmentSentences } from "./sentenceNavigation";

interface Props {
  active?: boolean;
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
  attemptedSources?: string[];
  cached?: boolean;
  rawResponse?: string;
}

interface ActiveReaderSelection extends ReadingSelection {
  page: number;
  rects: NormalizedRect[];
  kind?: "manual" | "word" | "sentence";
  sentenceIndex?: number;
  sentenceCount?: number;
}

interface ActiveSentenceState extends ActiveReaderSelection {
  kind: "sentence";
  sentenceIndex: number;
  sentenceCount: number;
  sentenceFormat: "pdf" | "epub" | "kindle";
  sentenceContainer: string;
  historyKey: string;
  epubCfi?: string;
  kindleChapterId?: string;
}

interface SentenceNavigationRequest {
  token: number;
  direction: -1 | 1;
}

interface ProgressNavigationRequest {
  token: number;
  progress: number;
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
  active = true,
  bookPath,
  navigationTarget = null,
  onOpenBook,
  onBackToLibrary,
}: Props) {
  const [scale, setScale] = useState(1.1);
  const [epubFontScale, setEpubFontScale] = useState<number>(
    APP_DEFAULTS.reading.ebook.fontScale,
  );
  const [ebookTheme, setEbookTheme] = useState<EbookTheme>(
    APP_DEFAULTS.reading.ebook.theme,
  );
  const [epubFlowMode, setEpubFlowMode] =
    useState<EpubFlowMode>(APP_DEFAULTS.reading.ebook.epubFlow);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [initialPage, setInitialPage] = useState<number | null>(null);
  const [positionLoaded, setPositionLoaded] = useState(false);
  const [selection, setSelection] =
    useState<ActiveReaderSelection | null>(null);
  const [activeSentence, setActiveSentence] =
    useState<ActiveSentenceState | null>(null);
  const [sentenceNavigation, setSentenceNavigation] =
    useState<SentenceNavigationRequest | null>(null);
  const sentenceNavigationTokenRef = useRef(0);
  const [progressNavigation, setProgressNavigation] =
    useState<ProgressNavigationRequest | null>(null);
  const progressNavigationTokenRef = useRef(0);
  const [progressDraft, setProgressDraft] = useState<number | null>(null);
  const [peekOrigin, setPeekOrigin] =
    useState<ReaderNavigationTarget | null>(null);
  const peekOriginRef = useRef<ReaderNavigationTarget | null>(null);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarkStatus, setBookmarkStatus] =
    useState<"idle" | "saving" | "saved">("idle");
  const wordSelectionTimerRef = useRef<number | null>(null);
  const runAiRef = useRef<
    ((
      mode: ReadingAnalysisMode,
      readerQuestion?: string,
      overrideSelection?: ActiveReaderSelection,
    ) => Promise<void>) | null
  >(null);
  const runSentenceAiRef = useRef<
    ((
      sentence: ActiveSentenceState,
      options?: { forceNew?: boolean },
    ) => Promise<void>) | null
  >(null);
  const [aiResult, setAiResult] = useState<AiResultState | null>(null);
  const [sentenceVersions, setSentenceVersions] =
    useState<SentenceAnalysisVersion[]>([]);
  const [sentenceVersionIndex, setSentenceVersionIndex] = useState(-1);
  const sentenceAiRequestTokenRef = useRef(0);
  const [aiRequestDebug, setAiRequestDebug] =
    useState<ReadingRequestDebug | null>(null);
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
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>(
    APP_DEFAULTS.reading.level,
  );
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [pdfMetadata, setPdfMetadata] = useState<PdfMetadataSummary>({
    title: null,
    author: null,
  });
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [regionDrag, setRegionDrag] = useState<RegionDragState | null>(null);
  const [regionCapture, setRegionCapture] = useState<PdfRegionCapture | null>(null);
  const [imagePreview, setImagePreview] =
    useState<ReaderImagePreview | null>(null);
  const [ocrStatus, setOcrStatus] = useState<LocalOcrStatus | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [epubInitialCfi, setEpubInitialCfi] = useState<string | null>(null);
  const [epubCurrentCfi, setEpubCurrentCfi] = useState<string | null>(null);
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
  const epubPositionSaveTimerRef = useRef<number | null>(null);
  const pendingEpubPositionRef = useRef<{
    path: string;
    cfi: string;
    progress: number | null;
  } | null>(null);
  const [kindleInitialChapterId, setKindleInitialChapterId] =
    useState<string | null>(null);
  const [kindleCurrentChapterId, setKindleCurrentChapterId] =
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
  const readerActiveRef = useRef(active);
  const previousReaderActiveRef = useRef(active);
  const lastVisibleReaderTargetRef =
    useRef<ReaderNavigationTarget | null>(null);
  const documentStageRef = useRef<HTMLDivElement | null>(null);
  const pdfScrollTopRef = useRef(0);
  const readerSettingsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const aiSettingsMenuRef = useRef<HTMLDetailsElement | null>(null);

  // Keep event callbacks synchronous with the parent navigation state. This
  // prevents epub.js/IntersectionObserver callbacks caused by display:none
  // layout collapse from overwriting the last real foreground position.
  readerActiveRef.current = active;

  const isPdf = isPdfPath(bookPath);
  const isEpub = isEpubPath(bookPath);
  const isKindle = isKindlePath(bookPath);

  useEffect(() => {
    void loadOllamaConfig()
      .then((config) => setConfiguredModel(config.model))
      .catch(() => setConfiguredModel(null));

    void loadReadingLevel()
      .then(setReadingLevel)
      .catch(() => setReadingLevel(APP_DEFAULTS.reading.level));


    void getLocalOcrStatus()
      .then(setOcrStatus)
      .catch(() =>
        setOcrStatus({
          available: false,
          engine: "Tesseract OCR",
          executable: null,
          message: "Local OCR status could not be determined.",
        }),
      );

    void loadEbookReadingPreferences()
      .then((preferences) => {
        setEpubFontScale(preferences.fontScale);
        setEbookTheme(preferences.theme);
        setEpubFlowMode(preferences.epubFlow);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    lastVisibleReaderTargetRef.current = null;
    pdfScrollTopRef.current = 0;
    setPageCount(0);
    setCurrentPage(1);
    setInitialPage(null);
    setPositionLoaded(false);
    setSelection(null);
    setActiveSentence(null);
    setSentenceNavigation(null);
    setProgressNavigation(null);
    setProgressDraft(null);
    setPeekOrigin(null);
    peekOriginRef.current = null;
    setBookmarks([]);
    setBookmarksOpen(false);
    setBookmarkStatus("idle");
    setAiResult(null);
    setSentenceVersions([]);
    setSentenceVersionIndex(-1);
    setAiRequestDebug(null);
    setAiError(null);
    setQuestion("");
    setNoteStatus("idle");
    setHighlightStatus("idle");
    setPageTexts({});
    setPdfMetadata({ title: null, author: null });
    setOutline([]);
    setTocOpen(false);
    setRegionMode(false);
    setRegionDrag(null);
    setRegionCapture(null);
    setImagePreview(null);
    setEpubInitialCfi(null);
    setEpubCurrentCfi(null);
    setEpubProgress(null);
    setEpubMetadata({ title: null, author: null });
    setEpubOutline([]);
    setEpubNavigationTarget(null);
    setEpubAnnotations([]);
    setEpubSelectionCfi(null);
    setKindleInitialChapterId(null);
    setKindleCurrentChapterId(null);
    setKindleProgress(null);
    setKindleMetadata({ title: null, author: null });
    setKindleOutline([]);
    setKindleNavigationChapterId(null);
    setKindleAnnotations([]);
    setKindleSelectionChapterId(null);
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
          lastVisibleReaderTargetRef.current = {
            kind: "pdf-page",
            page: targetPage,
          };
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
          const targetCfi =
            navigationTarget?.kind === "epub-cfi"
              ? navigationTarget.cfi
              : position?.cfi ?? null;
          setEpubInitialCfi(targetCfi);
          setEpubProgress(position?.progress ?? null);
          if (targetCfi) {
            lastVisibleReaderTargetRef.current = {
              kind: "epub-cfi",
              cfi: targetCfi,
            };
          }
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
          const targetChapterId =
            navigationTarget?.kind === "kindle-chapter"
              ? navigationTarget.chapterId
              : position?.chapterId ?? null;
          setKindleInitialChapterId(targetChapterId);
          setKindleProgress(position?.progress ?? null);
          if (targetChapterId) {
            lastVisibleReaderTargetRef.current = {
              kind: "kindle-chapter",
              chapterId: targetChapterId,
            };
          }
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
    return () => {
      if (epubPositionSaveTimerRef.current !== null) {
        window.clearTimeout(epubPositionSaveTimerRef.current);
        epubPositionSaveTimerRef.current = null;
      }

      const pending = pendingEpubPositionRef.current;
      pendingEpubPositionRef.current = null;
      if (!pending) return;

      void saveEpubReadingPosition(
        pending.path,
        pending.cfi,
        pending.progress,
      ).catch((error) => {
        console.error("Unable to flush EPUB reading position", error);
      });
    };
  }, [bookPath]);

  useEffect(() => {
    let cancelled = false;

    if (!bookPath) {
      setBookmarks([]);
      return () => {
        cancelled = true;
      };
    }

    void listReaderBookmarks(bookPath)
      .then((items) => {
        if (!cancelled) setBookmarks(items);
      })
      .catch((error) => {
        console.error("Unable to load reader bookmarks", error);
        if (!cancelled) setBookmarks([]);
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
        if (!cancelled) {
          setAnnotations(
            items.filter((annotation) => annotation.source !== "auto"),
          );
        }
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

  const currentPdfText = isPdf
    ? pageTexts[currentPage] || getPdfPageText(currentPage)
    : "";
  const currentPdfNeedsOcr =
    isPdf &&
    positionLoaded &&
    pageCount > 0 &&
    currentPdfText.length < 80;

  const readerProgress = useMemo(() => {
    if (isPdf) {
      if (pageCount <= 1) return pageCount === 1 ? 1 : 0;
      return Math.max(
        0,
        Math.min(1, (currentPage - 1) / (pageCount - 1)),
      );
    }

    if (isEpub) {
      return Math.max(0, Math.min(1, epubProgress ?? 0));
    }

    if (isKindle) {
      return Math.max(0, Math.min(1, kindleProgress ?? 0));
    }

    return 0;
  }, [
    currentPage,
    epubProgress,
    isEpub,
    isKindle,
    isPdf,
    kindleProgress,
    pageCount,
  ]);

  const displayedProgress = progressDraft ?? readerProgress;

  const zoomOut = useCallback(() => {
    setScale((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10));
  }, []);

  const epubFontDown = useCallback(() => {
    setEpubFontScale((value) => {
      const next = Math.max(70, value - 10);
      void saveEbookFontScale(next);
      return next;
    });
  }, []);

  const epubFontUp = useCallback(() => {
    setEpubFontScale((value) => {
      const next = Math.min(180, value + 10);
      void saveEbookFontScale(next);
      return next;
    });
  }, []);

  async function changeEbookTheme(theme: EbookTheme) {
    setEbookTheme(theme);
    await saveEbookTheme(theme);
  }

  async function changeEpubFlowMode(flowMode: EpubFlowMode) {
    setEpubFlowMode(flowMode);
    await saveEpubFlow(flowMode);
  }

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

  const handleEpubCoverReady = useCallback(
    (coverDataUrl: string) => {
      if (!bookPath) return;
      void updateBookCover(bookPath, coverDataUrl).catch((error) => {
        console.error("Unable to persist EPUB cover", error);
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

  const scheduleEpubReadingPositionSave = useCallback(
    (path: string, cfi: string, progress: number | null) => {
      pendingEpubPositionRef.current = {
        path,
        cfi,
        progress,
      };

      if (epubPositionSaveTimerRef.current !== null) {
        window.clearTimeout(epubPositionSaveTimerRef.current);
      }

      epubPositionSaveTimerRef.current = window.setTimeout(() => {
        epubPositionSaveTimerRef.current = null;
        const pending = pendingEpubPositionRef.current;
        pendingEpubPositionRef.current = null;

        if (!pending || peekOriginRef.current) return;

        void saveEpubReadingPosition(
          pending.path,
          pending.cfi,
          pending.progress,
        ).catch((error) => {
          console.error("Unable to save EPUB reading position", error);
        });
      }, 600);
    },
    [],
  );

  const handleEpubRelocated = useCallback(
    (cfi: string, progress: number | null) => {
      if (!readerActiveRef.current) return;

      setEpubCurrentCfi(cfi);
      setEpubProgress(progress);
      setProgressDraft(null);
      if (!bookPath || peekOriginRef.current) return;

      lastVisibleReaderTargetRef.current = {
        kind: "epub-cfi",
        cfi,
      };
      scheduleEpubReadingPositionSave(bookPath, cfi, progress);
    },
    [bookPath, scheduleEpubReadingPositionSave],
  );

  const handleEpubSelection = useCallback(
    (selected: EpubSelection) => {
      setEpubSelectionCfi(selected.cfi);
      setSelection({
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
        kind: "manual",
      });
      setAiResult(null);
      setAiError(null);
      setQuestion("");
      setNoteStatus("idle");
      setHighlightStatus("idle");
    },
    [],
  );

  const handleEpubWordSelection = useCallback(
    (selected: EpubSelection) => {
      const nextSelection: ActiveReaderSelection = {
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
        kind: "word",
      };

      setEpubSelectionCfi(selected.cfi);
      applyReaderSelection(nextSelection);
      void runAiRef.current?.("explain", undefined, nextSelection);
    },
    [],
  );

  const handleEpubSentenceSelection = useCallback(
    (selected: EpubSentenceSelection) => {
      const sentenceContainer =
        "context:" + stableHash(selected.context || selected.text);
      const nextSentence: ActiveSentenceState = {
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
        kind: "sentence",
        sentenceIndex: selected.sentenceIndex,
        sentenceCount: selected.sentenceCount,
        sentenceFormat: "epub",
        sentenceContainer,
        historyKey: createSentenceAnalysisKey({
          format: "epub",
          container: sentenceContainer,
          sentenceIndex: selected.sentenceIndex,
          text: selected.text,
        }),
        epubCfi: selected.cfi,
      };

      setEpubSelectionCfi(selected.cfi);
      setActiveSentence(nextSentence);
      applyReaderSelection(nextSentence);
      void runSentenceAiRef.current?.(nextSentence);
    },
    [],
  );

  const handleKindleCoverReady = useCallback(
    (coverDataUrl: string) => {
      if (!bookPath) return;
      void updateBookCover(bookPath, coverDataUrl).catch((error) => {
        console.error("Unable to persist Kindle cover", error);
      });
    },
    [bookPath],
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
      if (!readerActiveRef.current) return;

      setKindleCurrentChapterId(chapterId);
      setKindleProgress(progress);
      setProgressDraft(null);
      if (!bookPath || peekOriginRef.current) return;

      lastVisibleReaderTargetRef.current = {
        kind: "kindle-chapter",
        chapterId,
      };
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

  const handleKindleSelection = useCallback(
    (selected: KindleSelection) => {
      setKindleSelectionChapterId(selected.chapterId);
      setSelection({
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
        kind: "manual",
      });
      setAiResult(null);
      setAiError(null);
      setQuestion("");
      setNoteStatus("idle");
      setHighlightStatus("idle");
    },
    [],
  );

  const handleKindleWordSelection = useCallback(
    (selected: KindleSelection) => {
      const nextSelection: ActiveReaderSelection = {
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
        kind: "word",
      };

      setKindleSelectionChapterId(selected.chapterId);
      applyReaderSelection(nextSelection);
      void runAiRef.current?.("explain", undefined, nextSelection);
    },
    [],
  );

  const handleKindleSentenceSelection = useCallback(
    (selected: KindleSentenceSelection) => {
      const sentenceContainer =
        "chapter:" + selected.chapterId;
      const nextSentence: ActiveSentenceState = {
        text: selected.text,
        context: selected.context,
        page: 0,
        rects: [],
        kind: "sentence",
        sentenceIndex: selected.sentenceIndex,
        sentenceCount: selected.sentenceCount,
        sentenceFormat: "kindle",
        sentenceContainer,
        historyKey: createSentenceAnalysisKey({
          format: "kindle",
          container: sentenceContainer,
          sentenceIndex: selected.sentenceIndex,
          text: selected.text,
        }),
        kindleChapterId: selected.chapterId,
      };

      setKindleSelectionChapterId(selected.chapterId);
      setActiveSentence(nextSentence);
      applyReaderSelection(nextSentence);
      void runSentenceAiRef.current?.(nextSentence);
    },
    [],
  );

  const jumpToPage = useCallback(
    (page: number, behavior: ScrollBehavior = "smooth") => {
      const element = window.document.querySelector<HTMLElement>(
        '[data-pdf-page="' + page + '"]',
      );
      element?.scrollIntoView({
        block: "start",
        behavior,
      });
      setTocOpen(false);
    },
    [],
  );

  const handleCurrentPageChange = useCallback(
    (page: number) => {
      if (!readerActiveRef.current) return;

      setCurrentPage(page);

      if (!bookPath || pageCount < 1 || peekOriginRef.current) return;

      lastVisibleReaderTargetRef.current = {
        kind: "pdf-page",
        page,
      };
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

  async function performLocalOcr(
    capture: PdfRegionCapture,
    useAsPageText = false,
  ): Promise<string> {
    if (!capture.imageDataUrl) {
      throw new Error("No captured image is available for OCR.");
    }

    setOcrBusy(true);
    setAiError(null);

    try {
      const result = await recognizeImageDataUrl(
        capture.imageDataUrl,
        APP_DEFAULTS.ocr.language,
      );
      const text = normalizedText(result.text);

      if (!text) {
        throw new Error(
          "Local OCR completed, but no readable English text was detected.",
        );
      }

      setRegionCapture((current) =>
        current &&
        current.page === capture.page &&
        current.rect.x === capture.rect.x &&
        current.rect.y === capture.rect.y
          ? { ...current, text }
          : current,
      );

      if (useAsPageText) {
        setPageTexts((current) => ({
          ...current,
          [capture.page]: text,
        }));
      }

      setAiResult({
        title: useAsPageText ? "Local OCR · scanned page" : "Local OCR",
        text,
        model: result.engine,
        source: result.engine + " · local",
      });

      return text;
    } finally {
      setOcrBusy(false);
    }
  }

  async function ocrCapturedRegion() {
    if (!regionCapture?.imageDataUrl || ocrBusy) return;

    try {
      await performLocalOcr(regionCapture);
    } catch (error) {
      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : "Local OCR failed.",
      );
    }
  }

  async function ocrCurrentPdfPage() {
    if (!isPdf || ocrBusy) return;

    const capture = capturePdfRegion(currentPage, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    if (!capture?.imageDataUrl) {
      setAiError(
        "The current PDF page is not rendered yet. Scroll the page into view and try OCR again.",
      );
      return;
    }

    setRegionCapture(capture);

    try {
      await performLocalOcr(capture, true);
    } catch (error) {
      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : "Local page OCR failed.",
      );
    }
  }

  async function saveCapturedRegionNote() {
    if (!bookPath || !regionCapture || noteStatus === "saving") return;

    setNoteStatus("saving");

    try {
      const anchorJson = serializeReaderNavigationTarget({
        kind: "pdf-page",
        page: regionCapture.page,
      });
      const sourceText =
        regionCapture.text ||
        "PDF region image · Page " + regionCapture.page;

      const noteId = await createReaderNote(
        bookPath,
        sourceText,
        aiResult?.text ?? null,
        anchorJson,
      );

      if (noteId && regionCapture.imageDataUrl) {
        await createNoteImageAsset(
          noteId,
          regionCapture.imageDataUrl,
        );
      }

      setNoteStatus("saved");
      window.setTimeout(() => setNoteStatus("idle"), 1500);
    } catch (error) {
      console.error("Unable to save PDF region note", error);
      setNoteStatus("idle");
      setAiError(
        error instanceof Error
          ? error.message
          : "Unable to save this region to Notebook.",
      );
    }
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
        analysis: result.analysis,
        source: result.source,
        fallbackUsed: result.fallbackUsed,
        attemptedSources: result.attemptedSources,
      });
    } catch (error) {
      const visionMessage =
        error instanceof Error
          ? error.message
          : "Region image analysis failed.";

      if (!regionCapture.text && regionCapture.imageDataUrl) {
        try {
          await performLocalOcr(regionCapture);
          return;
        } catch (ocrError) {
          setAiResult(null);
          setAiError(
            visionMessage +
              " Local OCR fallback also failed: " +
              (ocrError instanceof Error
                ? ocrError.message
                : "Unknown OCR error."),
          );
        }
      } else {
        setAiResult(null);
        setAiError(visionMessage);
      }
    } finally {
      setAiBusy(false);
    }
  }

  function applyReaderSelection(
    nextSelection: ActiveReaderSelection,
  ) {
    if (nextSelection.kind !== "sentence") {
      sentenceAiRequestTokenRef.current += 1;
      setSentenceVersions([]);
      setSentenceVersionIndex(-1);
    }

    setSelection(nextSelection);
    setAiResult(null);
    setAiError(null);
    setQuestion("");
    setNoteStatus("idle");
    setHighlightStatus("idle");
  }

  function readBrowserPdfSelection(
    kind: ActiveReaderSelection["kind"] = "manual",
  ): ActiveReaderSelection | null {
    if (regionMode) return null;

    const browserSelection = window.getSelection();
    const text = normalizedText(browserSelection?.toString());
    if (!browserSelection || browserSelection.rangeCount === 0 || !text) {
      return null;
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
            }))
        : [];

    return {
      text,
      context,
      page: selectedPage,
      rects,
      kind,
    };
  }

  function captureSelection() {
    const nextSelection = readBrowserPdfSelection("manual");
    if (!nextSelection) return;

    applyReaderSelection(nextSelection);
  }

  function captureWordSelection() {
    const nextSelection = readBrowserPdfSelection("word");
    if (!nextSelection) return;

    applyReaderSelection(nextSelection);
    void runAi("explain", undefined, nextSelection);
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

    let pageText = "";
    let targetStart = 0;
    let targetEnd = 0;

    spans.forEach((span, index) => {
      const value = normalizedText(span.textContent);
      if (!value) return;

      if (pageText) pageText += " ";
      const start = pageText.length;
      pageText += value;
      const end = pageText.length;

      if (index === targetIndex) {
        targetStart = start;
        targetEnd = end;
      }
    });

    if (!pageText || targetEnd <= targetStart) return;

    let targetOffset = Math.min(
      targetEnd - 1,
      targetStart + Math.floor((targetEnd - targetStart) / 2),
    );

    const pointDocument = window.document as Document & {
      caretRangeFromPoint?: (
        x: number,
        y: number,
      ) => Range | null;
    };
    const caretRange = pointDocument.caretRangeFromPoint?.(
      event.clientX,
      event.clientY,
    );

    if (
      caretRange &&
      targetSpan.contains(caretRange.startContainer)
    ) {
      try {
        const prefixRange = window.document.createRange();
        prefixRange.selectNodeContents(targetSpan);
        prefixRange.setEnd(
          caretRange.startContainer,
          caretRange.startOffset,
        );

        const prefixLength = normalizedText(
          prefixRange.toString(),
        ).length;

        targetOffset = Math.min(
          targetEnd - 1,
          targetStart + prefixLength,
        );
      } catch {
        // Fall back to the midpoint of the clicked PDF text span.
      }
    }

    const sentences = segmentSentences(pageText);
    const sentenceIndex = sentences.findIndex(
      (sentence) =>
        targetOffset >= sentence.start &&
        targetOffset < sentence.end,
    );
    const sentence = sentences[sentenceIndex];
    if (!sentence) return;

    const pageValue = Number(pageShell.dataset.pdfPage);
    const selectedPage =
      Number.isInteger(pageValue) && pageValue > 0 ? pageValue : currentPage;
    const rects = locatePdfTextRects(selectedPage, sentence.text);

    const sentenceContainer = "page:" + selectedPage;
    const nextSentence: ActiveSentenceState = {
      text: sentence.text,
      context: pageText,
      page: selectedPage,
      rects,
      kind: "sentence",
      sentenceIndex,
      sentenceCount: sentences.length,
      sentenceFormat: "pdf",
      sentenceContainer,
      historyKey: createSentenceAnalysisKey({
        format: "pdf",
        container: sentenceContainer,
        sentenceIndex,
        text: sentence.text,
      }),
    };

    window.getSelection()?.removeAllRanges();
    setActiveSentence(nextSentence);
    applyReaderSelection(nextSentence);
    void runSentenceAi(nextSentence);
  }

  function activatePdfSentence(
    page: number,
    requestedIndex: number,
    contextHint = "",
  ): boolean {
    const context =
      normalizedText(contextHint) ||
      pageTexts[page] ||
      getPdfPageText(page);
    const sentences = segmentSentences(context);
    if (sentences.length === 0) return false;

    const sentenceIndex =
      requestedIndex < 0
        ? sentences.length - 1
        : Math.min(requestedIndex, sentences.length - 1);
    const sentence = sentences[sentenceIndex];
    if (!sentence) return false;

    const sentenceContainer = "page:" + page;
    const nextSentence: ActiveSentenceState = {
      text: sentence.text,
      context,
      page,
      rects: locatePdfTextRects(page, sentence.text),
      kind: "sentence",
      sentenceIndex,
      sentenceCount: sentences.length,
      sentenceFormat: "pdf",
      sentenceContainer,
      historyKey: createSentenceAnalysisKey({
        format: "pdf",
        container: sentenceContainer,
        sentenceIndex,
        text: sentence.text,
      }),
    };

    setCurrentPage(page);
    setActiveSentence(nextSentence);
    applyReaderSelection(nextSentence);
    void runSentenceAi(nextSentence);
    return true;
  }

  function navigatePdfSentence(direction: -1 | 1) {
    if (!activeSentence) return;

    const context =
      normalizedText(activeSentence.context) ||
      pageTexts[activeSentence.page] ||
      getPdfPageText(activeSentence.page);
    const sentences = segmentSentences(context);
    const nextIndex = activeSentence.sentenceIndex + direction;

    if (
      nextIndex >= 0 &&
      nextIndex < sentences.length &&
      activatePdfSentence(activeSentence.page, nextIndex, context)
    ) {
      return;
    }

    const nextPage = activeSentence.page + direction;
    if (nextPage < 1 || nextPage > pageCount) return;

    const targetIndex = direction > 0 ? 0 : -1;

    if (activatePdfSentence(nextPage, targetIndex)) {
      jumpToPage(nextPage);
      return;
    }

    jumpToPage(nextPage);

    window.setTimeout(() => {
      activatePdfSentence(
        nextPage,
        targetIndex,
        getPdfPageText(nextPage),
      );
    }, 260);
  }

  function navigateSentence(direction: -1 | 1) {
    if (!activeSentence || aiBusy) return;

    if (isPdf) {
      navigatePdfSentence(direction);
      return;
    }

    sentenceNavigationTokenRef.current += 1;
    setSentenceNavigation({
      token: sentenceNavigationTokenRef.current,
      direction,
    });
  }

  function handleDocumentMouseDown(
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (event.detail >= 3 && !regionMode) {
      event.preventDefault();
    }
  }

  function handleDocumentMouseUp(
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (regionMode) return;

    if (event.detail >= 3) {
      if (wordSelectionTimerRef.current !== null) {
        window.clearTimeout(wordSelectionTimerRef.current);
        wordSelectionTimerRef.current = null;
      }

      captureSentence(event);
      return;
    }

    if (event.detail === 2) {
      if (wordSelectionTimerRef.current !== null) {
        window.clearTimeout(wordSelectionTimerRef.current);
      }

      wordSelectionTimerRef.current = window.setTimeout(() => {
        wordSelectionTimerRef.current = null;
        captureWordSelection();
      }, 320);
      return;
    }

    captureSelection();
  }

  function showSentenceVersion(
    versions: SentenceAnalysisVersion[],
    index: number,
  ) {
    const safeIndex = Math.max(
      0,
      Math.min(versions.length - 1, index),
    );
    const version = versions[safeIndex];
    if (!version) return;

    setSentenceVersions(versions);
    setSentenceVersionIndex(safeIndex);
    setConfiguredModel(version.model);
    setAiRequestDebug(version.requestDebug ?? null);
    setAiResult({
      title: "Sentence analysis",
      text: version.text,
      model: version.model,
      analysis: version.analysis,
      source: version.source,
      cached: true,
      rawResponse: version.rawResponse,
    });
    setAiError(null);
  }

  async function prefetchFollowingSentenceAnalyses(
    sentence: ActiveSentenceState,
  ) {
    if (!bookPath) return;
    const activeBookPath = bookPath;

    const configuredPrefetchCount = await loadSentencePrefetchCount()
      .catch(() => APP_DEFAULTS.reading.ai.sentencePrefetchCount);

    if (configuredPrefetchCount <= 0) return;

    let remaining = configuredPrefetchCount;

    async function prefetchContext(
      context: string,
      format: ActiveSentenceState["sentenceFormat"],
      container: string,
      startIndex: number,
      page: number,
    ) {
      const normalizedContext = normalizedText(context);
      if (!normalizedContext || remaining <= 0) return;

      const sentences = segmentSentences(normalizedContext);

      for (
        let sentenceIndex = startIndex;
        sentenceIndex < sentences.length && remaining > 0;
        sentenceIndex += 1
      ) {
        const segment = sentences[sentenceIndex];
        if (!segment) continue;

        const historyKey = createSentenceAnalysisKey({
          format,
          container,
          sentenceIndex,
          text: segment.text,
        });

        try {
          await resolveSentenceAnalysis({
            bookPath: activeBookPath,
            sentenceKey: historyKey,
            selection: {
              text: segment.text,
              context: normalizedContext,
              page,
              bookPath: activeBookPath,
            },
          });
          remaining -= 1;
        } catch (error) {
          console.warn(
            "Unable to pre-generate sentence analysis",
            sentenceIndex,
            error,
          );
          return;
        }
      }
    }

    await prefetchContext(
      sentence.context ?? "",
      sentence.sentenceFormat,
      sentence.sentenceContainer,
      sentence.sentenceIndex + 1,
      sentence.page,
    );

    if (!isPdf || remaining <= 0) return;

    for (
      let page = sentence.page + 1;
      page <= pageCount && remaining > 0;
      page += 1
    ) {
      const context =
        pageTexts[page] || getPdfPageText(page);
      const normalizedContext = normalizedText(context);
      if (!normalizedContext) break;

      await prefetchContext(
        normalizedContext,
        "pdf",
        "page:" + page,
        0,
        page,
      );
    }
  }

  async function runSentenceAi(
    sentence: ActiveSentenceState,
    options: { forceNew?: boolean } = {},
  ) {
    if (!bookPath) return;

    const requestToken = ++sentenceAiRequestTokenRef.current;
    const requestSelection = {
      ...sentence,
      bookPath,
    };
    const requestDebug = buildReadingRequestDebug(
      requestSelection,
      "grammar",
    );

    setAiBusy(true);
    setAiError(null);
    setAiRequestDebug(requestDebug);
    setSentenceVersions([]);
    setSentenceVersionIndex(-1);
    setAiResult({
      title: "Sentence analysis",
      text: "",
      model: configuredModel || "Checking saved analysis…",
    });

    try {
      const resolution = await resolveSentenceAnalysis(
        {
          bookPath,
          sentenceKey: sentence.historyKey,
          selection: requestSelection,
        },
        {
          forceNew: Boolean(options.forceNew),
          onStream: (accumulatedText) => {
            if (sentenceAiRequestTokenRef.current !== requestToken) {
              return;
            }

            setAiResult((current) => ({
              title: "Sentence analysis",
              text: accumulatedText,
              model:
                current?.model ||
                configuredModel ||
                "Generating new version…",
            }));
          },
        },
      );

      if (sentenceAiRequestTokenRef.current !== requestToken) {
        return;
      }

      const index = Math.max(
        0,
        resolution.versions.findIndex(
          (item) => item.id === resolution.version.id,
        ),
      );

      showSentenceVersion(resolution.versions, index);
      void prefetchFollowingSentenceAnalyses(sentence);
    } catch (error) {
      if (sentenceAiRequestTokenRef.current !== requestToken) {
        return;
      }

      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : "Sentence analysis failed.",
      );
    } finally {
      if (sentenceAiRequestTokenRef.current === requestToken) {
        setAiBusy(false);
      }
    }
  }

  runSentenceAiRef.current = runSentenceAi;

  async function runAi(
    mode: ReadingAnalysisMode,
    readerQuestion?: string,
    overrideSelection?: ActiveReaderSelection,
  ) {
    const targetSelection = overrideSelection ?? selection;
    if (!targetSelection || aiBusy) return;

    if (
      mode === "grammar" &&
      targetSelection.kind === "sentence" &&
      activeSentence &&
      normalizedText(targetSelection.text) ===
        normalizedText(activeSentence.text)
    ) {
      await runSentenceAi(activeSentence);
      return;
    }

    sentenceAiRequestTokenRef.current += 1;
    setSentenceVersions([]);
    setSentenceVersionIndex(-1);

    const title =
      mode === "grammar"
        ? "Sentence analysis"
        : mode === "ask"
          ? "Answer"
          : "Context explanation";

    const requestSelection = {
      ...targetSelection,
      bookPath,
    };
    const requestDebug = buildReadingRequestDebug(
      requestSelection,
      mode,
      readerQuestion,
    );

    setAiBusy(true);
    setAiError(null);
    setAiRequestDebug(requestDebug);
    setAiResult({
      title,
      text: "",
      model: configuredModel || "Routing…",
    });

    try {
      const result = await streamReadingSelection(
        requestSelection,
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
      setAiRequestDebug(result.requestDebug);
      setAiResult({
        title,
        text: result.text,
        model: result.model,
        analysis: result.analysis,
        source: result.source,
        fallbackUsed: result.fallbackUsed,
        attemptedSources: result.attemptedSources,
        cached: result.cached,
        rawResponse: result.rawResponse,
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

  runAiRef.current = runAi;

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

  function resetAiPolicyState() {
    setAiResult(null);
    setAiError(null);
  }

  async function changeBookPrivacy(value: string) {
    if (!bookPath) return;

    const mode =
      value === "inherit" ? null : (value as AiPrivacyMode);

    setBookPrivacyMode(mode);

    try {
      await saveBookPrivacyMode(bookPath, mode);

      // Re-evaluate automatic assistance under the new privacy policy.
      resetAiPolicyState();
    } catch (error) {
      console.error("Unable to save book privacy mode", error);
    }
  }

  function currentReaderTarget(): ReaderNavigationTarget | null {
    if (isPdf && currentPage >= 1) {
      return {
        kind: "pdf-page",
        page: currentPage,
      };
    }

    if (isEpub) {
      const cfi = epubCurrentCfi || epubInitialCfi;
      if (cfi) {
        return {
          kind: "epub-cfi",
          cfi,
        };
      }
    }

    if (isKindle) {
      const chapterId =
        kindleCurrentChapterId || kindleInitialChapterId;
      if (chapterId) {
        return {
          kind: "kindle-chapter",
          chapterId,
        };
      }
    }

    return null;
  }

  function bookmarkLabel(
    target: ReaderNavigationTarget,
    progress: number,
  ): string {
    if (target.kind === "pdf-page") {
      return "Page " + target.page;
    }

    return Math.round(progress * 100) + "%";
  }

  function navigateToTarget(
    target: ReaderNavigationTarget,
    behavior: ScrollBehavior = "smooth",
  ) {
    if (target.kind === "pdf-page") {
      setCurrentPage(target.page);
      setInitialPage(target.page);
      jumpToPage(target.page, behavior);
      return;
    }

    if (target.kind === "epub-cfi") {
      setEpubNavigationTarget(target.cfi);
      return;
    }

    setKindleNavigationChapterId(target.chapterId);
  }

  useEffect(() => {
    const wasActive = previousReaderActiveRef.current;
    previousReaderActiveRef.current = active;

    if (wasActive === active) return;

    if (!active) {
      const protectedTarget =
        peekOriginRef.current ??
        lastVisibleReaderTargetRef.current ??
        currentReaderTarget();

      if (protectedTarget) {
        lastVisibleReaderTargetRef.current = protectedTarget;
      }

      // A pending EPUB debounce contains the last foreground relocation.
      // Flush it before display:none can cause epub.js to relayout.
      if (epubPositionSaveTimerRef.current !== null) {
        window.clearTimeout(epubPositionSaveTimerRef.current);
        epubPositionSaveTimerRef.current = null;
      }

      const pending = pendingEpubPositionRef.current;
      pendingEpubPositionRef.current = null;
      if (pending && !peekOriginRef.current) {
        void saveEpubReadingPosition(
          pending.path,
          pending.cfi,
          pending.progress,
        ).catch((error) => {
          console.error(
            "Unable to flush EPUB position while leaving Reader",
            error,
          );
        });
      }

      return;
    }

    if (!positionLoaded) return;

    const target = lastVisibleReaderTargetRef.current;
    if (!target) return;

    const savedPdfScrollTop = pdfScrollTopRef.current;
    let secondFrame = 0;
    let thirdFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      // Allow the keep-alive wrapper to regain non-zero layout first.
      window.dispatchEvent(new Event("resize"));

      if (target.kind === "epub-cfi") {
        // Force a fresh navigation request even if this CFI was also the
        // previous explicit bookmark/TOC destination.
        setEpubNavigationTarget(null);
      } else if (target.kind === "kindle-chapter") {
        setKindleNavigationChapterId(null);
      }

      secondFrame = window.requestAnimationFrame(() => {
        navigateToTarget(target, "auto");

        if (target.kind === "pdf-page") {
          thirdFrame = window.requestAnimationFrame(() => {
            const stage = documentStageRef.current;
            if (stage) {
              stage.scrollTop = savedPdfScrollTop;
            }
          });
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
      if (thirdFrame) {
        window.cancelAnimationFrame(thirdFrame);
      }
    };
  }, [active, positionLoaded]);

  async function addCurrentBookmark() {
    if (!bookPath || bookmarkStatus === "saving") return;

    const target = currentReaderTarget();
    if (!target) return;

    setBookmarkStatus("saving");

    try {
      const created = await createReaderBookmark(
        bookPath,
        target,
        readerProgress,
        bookmarkLabel(target, readerProgress),
      );

      if (created) {
        setBookmarks((items) =>
          [...items, created].sort((a, b) => {
            const progressA = a.progress ?? 2;
            const progressB = b.progress ?? 2;
            return progressA - progressB;
          }),
        );
        setBookmarkStatus("saved");
        window.setTimeout(() => setBookmarkStatus("idle"), 1200);
      } else {
        setBookmarkStatus("idle");
      }
    } catch (error) {
      console.error("Unable to create bookmark", error);
      setBookmarkStatus("idle");
    }
  }

  async function removeBookmark(id: string) {
    try {
      await removeReaderBookmark(id);
      setBookmarks((items) =>
        items.filter((bookmark) => bookmark.id !== id),
      );
    } catch (error) {
      console.error("Unable to remove bookmark", error);
    }
  }

  function openBookmark(bookmark: ReaderBookmark) {
    peekOriginRef.current = null;
    setPeekOrigin(null);
    setProgressDraft(null);
    navigateToTarget(bookmark.target);
    setBookmarksOpen(false);
  }

  function beginProgressScrub() {
    if (peekOriginRef.current) return;

    const target = currentReaderTarget();
    if (!target) return;

    peekOriginRef.current = target;
    setPeekOrigin(target);
  }

  function commitProgressScrub() {
    if (progressDraft === null) return;

    const progress = Math.max(0, Math.min(1, progressDraft));

    if (isPdf) {
      setProgressDraft(null);
      if (pageCount < 1) return;

      const page =
        pageCount <= 1
          ? 1
          : Math.round(progress * (pageCount - 1)) + 1;

      setCurrentPage(page);
      jumpToPage(page);
      return;
    }

    progressNavigationTokenRef.current += 1;
    setProgressNavigation({
      token: progressNavigationTokenRef.current,
      progress,
    });
  }

  function returnToReadingPosition() {
    const target = peekOriginRef.current;
    if (!target) return;

    peekOriginRef.current = null;
    setPeekOrigin(null);
    setProgressDraft(null);
    navigateToTarget(target);
  }

  async function continueFromPeekPosition() {
    if (!bookPath || !peekOriginRef.current) return;

    peekOriginRef.current = null;
    setPeekOrigin(null);

    try {
      if (isPdf && pageCount > 0) {
        await savePdfReadingPosition(
          bookPath,
          currentPage,
          pageCount,
        );
        return;
      }

      if (isEpub && epubCurrentCfi) {
        await saveEpubReadingPosition(
          bookPath,
          epubCurrentCfi,
          epubProgress,
        );
        return;
      }

      if (isKindle && kindleCurrentChapterId) {
        await saveKindleReadingPosition(
          bookPath,
          kindleCurrentChapterId,
          kindleProgress,
        );
      }
    } catch (error) {
      console.error("Unable to commit peek reading position", error);
    }
  }

  const handleReaderImageOpen = useCallback(
    (image: ReaderImagePreview) => {
      setImagePreview(image);
    },
    [],
  );

  useEffect(() => {
    if (!imagePreview) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setImagePreview(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [imagePreview]);

  useEffect(() => {
    // Close transient reader chrome with Escape or when clicking elsewhere.
    // Native <details> keeps keyboard semantics while these handlers prevent
    // stacked menus from obscuring the reading surface.
    const closeMenus = () => {
      readerSettingsMenuRef.current?.removeAttribute("open");
      aiSettingsMenuRef.current?.removeAttribute("open");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenus();
      closeReaderNavigation();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const readingMenu = readerSettingsMenuRef.current;
      const aiMenu = aiSettingsMenuRef.current;

      if (readingMenu?.hasAttribute("open") && !readingMenu.contains(target)) {
        readingMenu.removeAttribute("open");
      }

      if (aiMenu?.hasAttribute("open") && !aiMenu.contains(target)) {
        aiMenu.removeAttribute("open");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !selection) return;
    void runAi("ask", trimmed);
  }

  const hasReaderContents =
    (isPdf && outline.length > 0) ||
    (isEpub && epubOutline.length > 0) ||
    (isKindle && kindleOutline.length > 0);
  const readerNavigationOpen = tocOpen || bookmarksOpen;

  function closeReaderNavigation() {
    setTocOpen(false);
    setBookmarksOpen(false);
  }

  function toggleReaderNavigation() {
    if (readerNavigationOpen) {
      closeReaderNavigation();
      return;
    }

    if (hasReaderContents) {
      setTocOpen(true);
      setBookmarksOpen(false);
    } else {
      setBookmarksOpen(true);
    }
  }

  return (
    <section className="reader-page">
      <header className="reader-toolbar">
        <div className="reader-title">
          <button className="text-button" onClick={onBackToLibrary}>
            ← Library
          </button>
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
          {bookPath && (
            <>
              <button
                className={
                  readerNavigationOpen
                    ? "toolbar-icon-button active"
                    : "toolbar-icon-button"
                }
                type="button"
                aria-label="Contents and bookmarks"
                aria-pressed={readerNavigationOpen}
                title="Contents and bookmarks"
                onClick={toggleReaderNavigation}
              >
                ☰
              </button>
              <button
                className="toolbar-icon-button"
                type="button"
                disabled={!positionLoaded || bookmarkStatus === "saving"}
                aria-label={
                  bookmarkStatus === "saved"
                    ? "Current position bookmarked"
                    : "Bookmark current position"
                }
                title={
                  bookmarkStatus === "saving"
                    ? "Saving bookmark…"
                    : bookmarkStatus === "saved"
                      ? "Bookmarked"
                      : "Bookmark current position"
                }
                onClick={() => void addCurrentBookmark()}
              >
                {bookmarkStatus === "saved" ? "★" : "☆"}
              </button>
            </>
          )}

          {isPdf && (
            <button
              className={regionMode ? "toolbar-text-button active" : "toolbar-text-button"}
              type="button"
              onClick={() => {
                setRegionMode((value) => !value);
                setRegionDrag(null);
                setRegionCapture(null);
              }}
            >
              {regionMode ? "Cancel region" : "Region"}
            </button>
          )}

          {(isPdf || isEpub || isKindle) && (
            <details
              ref={readerSettingsMenuRef}
              className="reader-settings-menu"
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  aiSettingsMenuRef.current?.removeAttribute("open");
                }
              }}
            >
              <summary
                className="toolbar-icon-button"
                aria-label="Reading settings"
                title="Reading settings"
              >
                Aa
              </summary>
              <div className="reader-settings-panel">
                <div className="reader-settings-heading">
                  <strong>Reading settings</strong>
                  <small>Display and reading flow</small>
                </div>

                <div className="reader-setting-group">
                  <span>{isEpub || isKindle ? "Text size" : "Zoom"}</span>
                  <div className="zoom-control">
                    <button
                      type="button"
                      onClick={isEpub || isKindle ? epubFontDown : zoomOut}
                      aria-label={
                        isEpub || isKindle
                          ? "Decrease font size"
                          : "Zoom out"
                      }
                    >
                      −
                    </button>
                    <span>
                      {isEpub || isKindle ? epubFontLabel : zoomLabel}
                    </span>
                    <button
                      type="button"
                      onClick={isEpub || isKindle ? epubFontUp : zoomIn}
                      aria-label={
                        isEpub || isKindle
                          ? "Increase font size"
                          : "Zoom in"
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                {(isEpub || isKindle) && (
                  <label className="reader-display-control">
                    <span>Theme</span>
                    <select
                      value={ebookTheme}
                      onChange={(event) =>
                        void changeEbookTheme(event.target.value as EbookTheme)
                      }
                    >
                      <option value="light">Light</option>
                      <option value="sepia">Sepia</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                )}

                {isEpub && (
                  <label className="reader-display-control">
                    <span>Reading mode</span>
                    <select
                      value={epubFlowMode}
                      onChange={(event) =>
                        void changeEpubFlowMode(
                          event.target.value as EpubFlowMode,
                        )
                      }
                    >
                      <option value="scrolled">Scrolled</option>
                      <option value="paginated">Paginated</option>
                    </select>
                  </label>
                )}
              </div>
            </details>
          )}
        </div>
      </header>

      <div className="split-reader">
        <section className="document-pane">
          {(tocOpen || bookmarksOpen) && (
            <aside className="reader-navigation-panel">
              <header>
                <div>
                  <span className="eyebrow">Navigation</span>
                  <strong>{tocOpen ? "Contents" : "Bookmarks"}</strong>
                </div>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={closeReaderNavigation}
                >
                  ×
                </button>
              </header>

              <div className="reader-navigation-tabs">
                <button
                  type="button"
                  className={tocOpen ? "active" : ""}
                  disabled={!hasReaderContents}
                  onClick={() => {
                    setBookmarksOpen(false);
                    setTocOpen(true);
                  }}
                >
                  Contents
                </button>
                <button
                  type="button"
                  className={bookmarksOpen ? "active" : ""}
                  onClick={() => {
                    setTocOpen(false);
                    setBookmarksOpen(true);
                  }}
                >
                  Bookmarks{bookmarks.length ? " (" + bookmarks.length + ")" : ""}
                </button>
              </div>

              {tocOpen && (
                <div className="reader-navigation-body">
                  {isPdf && outline.length > 0 && (
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
                  )}

                  {isEpub && epubOutline.length > 0 && (
                    <div className="toc-list">
                      {epubOutline.map((item) => (
                        <button
                          key={item.id}
                          className="toc-item"
                          style={{ paddingLeft: 12 + item.depth * 14 }}
                          onClick={() => {
                            setEpubNavigationTarget(item.href);
                            closeReaderNavigation();
                          }}
                        >
                          <span>{item.title}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {isKindle && kindleOutline.length > 0 && (
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
                            closeReaderNavigation();
                          }}
                        >
                          <span>{item.title}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!hasReaderContents && (
                    <p className="reader-navigation-empty">
                      No table of contents is available for this book.
                    </p>
                  )}
                </div>
              )}

              {bookmarksOpen && (
                <div className="reader-navigation-body">
                  {bookmarks.length > 0 ? (
                    <div className="bookmark-list">
                      {bookmarks.map((bookmark) => (
                        <div className="bookmark-item" key={bookmark.id}>
                          <button
                            className="bookmark-jump"
                            onClick={() => openBookmark(bookmark)}
                          >
                            <strong>
                              {bookmark.label ||
                                (bookmark.progress !== null
                                  ? Math.round(bookmark.progress * 100) + "%"
                                  : "Saved place")}
                            </strong>
                            <small>
                              {bookmark.target.kind === "pdf-page"
                                ? "Page " + bookmark.target.page
                                : bookmark.progress !== null
                                  ? Math.round(bookmark.progress * 100) +
                                    "% through book"
                                  : "Saved reading location"}
                            </small>
                          </button>
                          <button
                            className="bookmark-remove"
                            aria-label="Remove bookmark"
                            title="Remove bookmark"
                            onClick={() => void removeBookmark(bookmark.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="reader-navigation-empty">
                      No bookmarks yet. Use ☆ to save the current reading
                      position.
                    </p>
                  )}
                </div>
              )}
            </aside>
          )}

          {activeSentence && (
            <div
              className="sentence-nav-floating"
              role="group"
              aria-label="Sentence navigation"
            >
              <button
                type="button"
                disabled={
                  aiBusy ||
                  (isPdf &&
                    activeSentence.sentenceIndex <= 0 &&
                    activeSentence.page <= 1)
                }
                onClick={() => navigateSentence(-1)}
              >
                ← Previous sentence
              </button>
              <span>
                <strong>Current sentence</strong>
                <small>
                  {activeSentence.sentenceCount
                    ? activeSentence.sentenceIndex + 1 +
                      " / " +
                      activeSentence.sentenceCount
                    : "Selected"}
                </small>
              </span>
              <button
                type="button"
                disabled={
                  aiBusy ||
                  (isPdf &&
                    activeSentence.sentenceIndex >=
                      activeSentence.sentenceCount - 1 &&
                    activeSentence.page >= pageCount)
                }
                onClick={() => navigateSentence(1)}
              >
                Next sentence →
              </button>
            </div>
          )}

          <div
            ref={documentStageRef}
            className={regionMode ? "document-stage region-mode" : "document-stage"}
            onScroll={(event) => {
              if (isPdf && readerActiveRef.current) {
                pdfScrollTopRef.current = event.currentTarget.scrollTop;
              }
            }}
            onMouseDown={handleDocumentMouseDown}
            onMouseUp={handleDocumentMouseUp}
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
                activeSentence={
                  activeSentence && activeSentence.page > 0
                    ? {
                        page: activeSentence.page,
                        rects: activeSentence.rects,
                      }
                    : null
                }
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
                active={active}
                fontScale={epubFontScale}
                theme={ebookTheme}
                flowMode={epubFlowMode}
                initialCfi={epubInitialCfi}
                navigationTarget={epubNavigationTarget}
                annotations={epubAnnotations}
                activeSentence={
                  activeSentence?.epubCfi
                    ? {
                        cfi: activeSentence.epubCfi,
                        text: activeSentence.text,
                        sentenceIndex: activeSentence.sentenceIndex,
                      }
                    : null
                }
                sentenceNavigation={sentenceNavigation}
                progressNavigation={progressNavigation}
                onMetadataReady={handleEpubMetadataReady}
                onOutlineReady={handleEpubOutlineReady}
                onCoverReady={handleEpubCoverReady}
                onRelocated={handleEpubRelocated}
                onSelection={handleEpubSelection}
                onWordSelection={handleEpubWordSelection}
                onSentenceSelection={handleEpubSentenceSelection}
                onImageOpen={handleReaderImageOpen}
              />
            )}

            {bookPath && isKindle && positionLoaded && (
              <MobiDocumentView
                path={bookPath}
                fontScale={epubFontScale}
                theme={ebookTheme}
                initialChapterId={kindleInitialChapterId}
                navigationChapterId={kindleNavigationChapterId}
                annotations={kindleAnnotations}
                activeSentence={
                  activeSentence?.kindleChapterId
                    ? {
                        chapterId: activeSentence.kindleChapterId,
                        text: activeSentence.text,
                        sentenceIndex: activeSentence.sentenceIndex,
                      }
                    : null
                }
                sentenceNavigation={sentenceNavigation}
                progressNavigation={progressNavigation}
                onMetadataReady={handleKindleMetadataReady}
                onOutlineReady={handleKindleOutlineReady}
                onCoverReady={handleKindleCoverReady}
                onRelocated={handleKindleRelocated}
                onSelection={handleKindleSelection}
                onWordSelection={handleKindleWordSelection}
                onSentenceSelection={handleKindleSentenceSelection}
                onImageOpen={handleReaderImageOpen}
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

          {peekOrigin && (
            <div className="reader-peek-banner">
              <div>
                <strong>Temporary browse position</strong>
                <span>
                  Your saved reading position is protected while you look around.
                </span>
              </div>
              <div>
                <button
                  className="ghost-button"
                  onClick={returnToReadingPosition}
                >
                  ↩ Return to reading position
                </button>
                <button
                  className="primary-button compact"
                  onClick={() => void continueFromPeekPosition()}
                >
                  Continue from here
                </button>
              </div>
            </div>
          )}

          <footer className="reader-statusbar">
            {(isPdf || isEpub || isKindle) && positionLoaded && (
              <div className="reader-progress-scrubber">
                <span className="reader-progress-label">
                  {Math.round(displayedProgress * 100)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={Math.round(displayedProgress * 1000)}
                  aria-label="Reading progress"
                  onPointerDown={beginProgressScrub}
                  onChange={(event) => {
                    beginProgressScrub();
                    setProgressDraft(
                      Number(event.target.value) / 1000,
                    );
                  }}
                  onPointerUp={commitProgressScrub}
                  onKeyUp={commitProgressScrub}
                />
              </div>
            )}
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
              {isEpub
                ? epubFlowMode === "paginated"
                  ? "Paginated"
                  : "Scrolled"
                : isKindle
                  ? "Chapter"
                  : "Continuous"}
            </span>
            <span>
              {selection?.kind === "sentence"
                ? "Sentence selected"
                : selection?.kind === "word"
                  ? "Word selected"
                  : selection
                    ? "Selection ready"
                    : "Double-click a word · triple-click a sentence"}
            </span>
          </footer>
        </section>

        <aside className="ai-pane">
          <header className="ai-pane-header">
            <div>
              <span className="eyebrow">AI Reading</span>
              <strong>Sentence & word assistance</strong>
            </div>
            <div className="ai-pane-meta">
              <span>{readingLevel} reader</span>
              <span className="model-pill">
                {configuredModel || "Ollama local"}
              </span>
              {bookPath && (
                <details
                  ref={aiSettingsMenuRef}
                  className="ai-settings-menu"
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      readerSettingsMenuRef.current?.removeAttribute("open");
                    }
                  }}
                >
                  <summary
                    className="ai-settings-trigger"
                    aria-label="AI settings for this book"
                    title="AI settings for this book"
                  >
                    ⚙
                  </summary>
                  <div className="ai-settings-panel">
                    <div className="ai-settings-heading">
                      <strong>AI settings</strong>
                      <small>Settings for this book</small>
                    </div>
                    <label className="book-privacy-control">
                      <span>Privacy</span>
                      <select
                        value={bookPrivacyMode ?? "inherit"}
                        onChange={(event) =>
                          void changeBookPrivacy(event.target.value)
                        }
                      >
                        <option value="inherit">Follow global setting</option>
                        <option value="local-only">Local only</option>
                        <option value="prefer-local">Prefer local</option>
                        <option value="automatic">Automatic</option>
                        <option value="cloud-only">Cloud only</option>
                      </select>
                    </label>
                    <BookProviderPolicyControl
                      bookPath={bookPath}
                      onChanged={resetAiPolicyState}
                    />
                  </div>
                </details>
              )}
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
                    No selectable text was found in this region. Use local OCR
                    to extract text without uploading the image, or use a
                    vision-capable model for visual understanding.
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
                    <>
                      <button
                        disabled={aiBusy || ocrBusy}
                        onClick={() => void ocrCapturedRegion()}
                      >
                        {ocrBusy ? "OCR…" : "OCR locally"}
                      </button>
                      <button
                        disabled={aiBusy || ocrBusy}
                        onClick={() => void analyzeCapturedRegionImage()}
                      >
                        Analyze image
                      </button>
                      <button
                        disabled={aiBusy || noteStatus === "saving"}
                        onClick={() => void saveCapturedRegionNote()}
                      >
                        {noteStatus === "saving"
                          ? "Saving…"
                          : noteStatus === "saved"
                            ? "Saved"
                            : "Save region"}
                      </button>
                    </>
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

            {selection ? (
              <section className="assist-card selected-source-card">
                <div className="selection-card-heading">
                  <span className="assist-type blue">
                    {selection.kind === "sentence"
                      ? "Current sentence"
                      : selection.kind === "word"
                        ? "Selected word"
                        : "Selected text"}
                  </span>
                  {selection.page > 0 && <small>Page {selection.page}</small>}
                </div>
                <blockquote>{selection.text}</blockquote>

                <div className="assist-actions">
                  {selection.kind !== "sentence" && (
                    <button
                      disabled={aiBusy}
                      onClick={() => void runAi("explain")}
                    >
                      Explain
                    </button>
                  )}
                  {selection.kind !== "word" && (
                    <button
                      disabled={aiBusy}
                      onClick={() => void runAi("grammar")}
                    >
                      Analyze sentence
                    </button>
                  )}
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
                      sentenceAiRequestTokenRef.current += 1;
                      setSelection(null);
                      setActiveSentence(null);
                      setSentenceVersions([]);
                      setSentenceVersionIndex(-1);
                      setAiResult(null);
                      setAiRequestDebug(null);
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
                <h3>Choose a sentence or a word while reading.</h3>
                <p>
                  Triple-click a sentence to highlight it and automatically
                  show its translation, structure, notable features, and
                  contextual word meanings. Double-click a word to translate
                  and explain that word in context. Drag-selection is still
                  available for phrases or custom text.
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
                {aiRequestDebug && (
                  <AiRequestDebugPanel
                    debug={aiRequestDebug}
                    model={configuredModel}
                  />
                )}
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

                {selection?.kind === "sentence" &&
                  activeSentence &&
                  sentenceVersions.length > 0 && (
                    <div className="sentence-version-toolbar">
                      <div>
                        <strong>
                          Version {sentenceVersionIndex + 1} /{" "}
                          {sentenceVersions.length}
                        </strong>
                        <small>
                          {sentenceVersions[sentenceVersionIndex]?.createdAt
                            ? new Date(
                                sentenceVersions[
                                  sentenceVersionIndex
                                ].createdAt,
                              ).toLocaleString()
                            : ""}
                        </small>
                      </div>

                      <div>
                        <button
                          type="button"
                          disabled={sentenceVersionIndex <= 0}
                          onClick={() =>
                            showSentenceVersion(
                              sentenceVersions,
                              sentenceVersionIndex - 1,
                            )
                          }
                        >
                          ← Older
                        </button>
                        <button
                          type="button"
                          disabled={
                            sentenceVersionIndex >=
                            sentenceVersions.length - 1
                          }
                          onClick={() =>
                            showSentenceVersion(
                              sentenceVersions,
                              sentenceVersionIndex + 1,
                            )
                          }
                        >
                          Newer →
                        </button>
                        <button
                          type="button"
                          className="primary-button compact"
                          disabled={aiBusy}
                          onClick={() =>
                            void runSentenceAi(activeSentence, {
                              forceNew: true,
                            })
                          }
                        >
                          Regenerate
                        </button>
                      </div>
                    </div>
                  )}

                {aiResult.analysis ? (
                  <StructuredAnalysisView analysis={aiResult.analysis} />
                ) : (
                  <div className="ai-answer-text">{aiResult.text}</div>
                )}

                {aiResult.attemptedSources &&
                  aiResult.attemptedSources.length > 0 && (
                    <details className="route-diagnostics">
                      <summary>Route details</summary>
                      <ol>
                        {aiResult.attemptedSources.map((source, index) => (
                          <li key={index}>{source}</li>
                        ))}
                      </ol>
                    </details>
                  )}

                {aiRequestDebug && (
                  <AiRequestDebugPanel
                    debug={aiRequestDebug}
                    model={aiResult.model}
                    source={aiResult.source}
                    rawResponse={aiResult.rawResponse}
                    cached={Boolean(aiResult.cached)}
                  />
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

      {imagePreview && (
        <div
          className="reader-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged book image"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImagePreview(null);
            }
          }}
        >
          <button
            className="reader-image-lightbox-close"
            type="button"
            aria-label="Close enlarged image"
            onClick={() => setImagePreview(null)}
          >
            ×
          </button>

          <figure className="reader-image-lightbox-figure">
            <img
              src={imagePreview.src}
              alt={imagePreview.alt}
            />
            {imagePreview.alt &&
              imagePreview.alt !== "Book image" && (
                <figcaption>{imagePreview.alt}</figcaption>
              )}
          </figure>
        </div>
      )}
    </section>
  );
}
