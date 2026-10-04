import { readFile } from "@tauri-apps/plugin-fs";
import ePub, {
  type Book,
  type Contents,
  type Location,
  type NavItem,
  type Rendition,
} from "epubjs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EpubTextAnnotation } from "../../core/annotations/epubAnnotations";
import type { DifficultTerm } from "../../core/ai/difficultyService";
import { normalizeTerm } from "../../core/reading/knownTerms";
import type {
  EbookTheme,
  EpubFlowMode,
} from "../../core/reading/ebookPreferences";
import type { ReaderImagePreview } from "./readerImage";
import {
  clearDomSentenceHighlight,
  findDomSentenceByText,
  getDomSentenceCount,
  selectDomSentenceAtPoint,
  selectDomSentenceByIndex,
  setDomSentenceHighlight,
} from "./sentenceNavigation";

export interface EpubMetadataSummary {
  title: string | null;
  author: string | null;
}

export interface EpubOutlineEntry {
  id: string;
  title: string;
  href: string;
  depth: number;
}

export interface EpubSelection {
  text: string;
  context: string;
  cfi: string;
}

export interface EpubSentenceSelection extends EpubSelection {
  sentenceIndex: number;
  sentenceCount: number;
}

export interface SentenceNavigationRequest {
  token: number;
  direction: -1 | 1;
}

export interface EpubProgressNavigationRequest {
  token: number;
  progress: number;
}

export interface EpubActiveSentence {
  cfi: string;
  text: string;
  sentenceIndex: number;
}

interface Props {
  path: string;
  fontScale?: number;
  theme?: EbookTheme;
  flowMode?: EpubFlowMode;
  initialCfi?: string | null;
  navigationTarget?: string | null;
  annotations?: EpubTextAnnotation[];
  autoTerms?: DifficultTerm[];
  activeSentence?: EpubActiveSentence | null;
  sentenceNavigation?: SentenceNavigationRequest | null;
  progressNavigation?: EpubProgressNavigationRequest | null;
  onMetadataReady?: (metadata: EpubMetadataSummary) => void;
  onOutlineReady?: (outline: EpubOutlineEntry[]) => void;
  onCoverReady?: (coverDataUrl: string) => void;
  onRelocated?: (cfi: string, progress: number | null) => void;
  onContextReady?: (cfi: string, context: string) => void;
  onSelection?: (selection: EpubSelection) => void;
  onWordSelection?: (selection: EpubSelection) => void;
  onSentenceSelection?: (selection: EpubSentenceSelection) => void;
  onImageOpen?: (image: ReaderImagePreview) => void;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s\u00a0]+/g, " ").trim();
}

function flattenNavigation(
  items: NavItem[],
  depth = 0,
  prefix = "",
): EpubOutlineEntry[] {
  const result: EpubOutlineEntry[] = [];

  items.forEach((item, index) => {
    const id = prefix + index;
    result.push({
      id,
      title: normalizeText(item.label) || "Untitled section",
      href: item.href,
      depth,
    });

    if (item.subitems?.length) {
      result.push(
        ...flattenNavigation(
          item.subitems,
          depth + 1,
          id + ".",
        ),
      );
    }
  });

  return result;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function themeRules(theme: EbookTheme) {
  if (theme === "dark") {
    return {
      body: {
        "font-family":
          "Georgia, 'Times New Roman', serif !important",
        "line-height": "1.75 !important",
        color: "#e7e5df !important",
        background: "#1f2024 !important",
        padding: "24px 32px !important",
      },
      "p, li": {
        "line-height": "1.75 !important",
      },
      "a": {
        color: "#b8afff !important",
      },
      "::selection": {
        background: "rgba(156, 143, 255, 0.34)",
      },
    };
  }

  if (theme === "sepia") {
    return {
      body: {
        "font-family":
          "Georgia, 'Times New Roman', serif !important",
        "line-height": "1.75 !important",
        color: "#443b2c !important",
        background: "#f4ecd8 !important",
        padding: "24px 32px !important",
      },
      "p, li": {
        "line-height": "1.75 !important",
      },
      "a": {
        color: "#6c5897 !important",
      },
      "::selection": {
        background: "rgba(101, 88, 219, 0.22)",
      },
    };
  }

  return {
    body: {
      "font-family":
        "Georgia, 'Times New Roman', serif !important",
      "line-height": "1.75 !important",
      color: "#282725 !important",
      background: "#fffefa !important",
      padding: "24px 32px !important",
    },
    "p, li": {
      "line-height": "1.75 !important",
    },
    "a": {
      color: "#5549a6 !important",
    },
    "::selection": {
      background: "rgba(101, 88, 219, 0.25)",
    },
  };
}

async function coverUrlToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;

  const response = await fetch(url);
  if (!response.ok) return null;

  const blob = await response.blob();

  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(blob);
  });
}

async function readEpubCover(book: Book): Promise<string | null> {
  const candidate = book as Book & {
    coverUrl?: () => Promise<string | null>;
  };

  if (!candidate.coverUrl) return null;

  try {
    const url = await candidate.coverUrl();
    return url ? coverUrlToDataUrl(url) : null;
  } catch {
    return null;
  }
}

function renderedContents(rendition: Rendition): Contents[] {
  const value = rendition.getContents() as unknown;
  if (Array.isArray(value)) {
    return value as Contents[];
  }

  return value ? [value as Contents] : [];
}

function currentContext(rendition: Rendition): string {
  return normalizeText(
    renderedContents(rendition)
      .map((contents) => contents.document.body?.textContent ?? "")
      .join(" "),
  ).slice(0, 9000);
}

function findExactRange(
  contents: Contents,
  exact: string,
): Range | null {
  const body = contents.document.body;
  if (!body || !exact.trim()) return null;

  const target = exact.toLocaleLowerCase("en-US");
  const walker = contents.document.createTreeWalker(
    body,
    4,
  );

  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? "";
    const index = value.toLocaleLowerCase("en-US").indexOf(target);

    if (index >= 0) {
      const range = contents.document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + exact.length);
      return range;
    }

    node = walker.nextNode();
  }

  return null;
}

function syncUserHighlights(
  rendition: Rendition,
  annotations: EpubTextAnnotation[],
  renderedCfis: Set<string>,
) {
  const activeCfis = new Set(
    annotations.map((annotation) => annotation.anchor.cfi),
  );

  for (const cfi of renderedCfis) {
    if (!activeCfis.has(cfi)) {
      try {
        rendition.annotations.remove(cfi, "highlight");
      } catch (error) {
        console.warn("Unable to remove stale EPUB highlight", cfi, error);
      }
      renderedCfis.delete(cfi);
    }
  }

  for (const annotation of annotations) {
    if (renderedCfis.has(annotation.anchor.cfi)) {
      continue;
    }

    try {
      rendition.annotations.highlight(
        annotation.anchor.cfi,
        { id: annotation.id },
        undefined,
        "lexipane-epub-highlight",
        {
          fill: "#8bb9f2",
          "fill-opacity": "0.32",
          "mix-blend-mode": "multiply",
        },
      );
      renderedCfis.add(annotation.anchor.cfi);
    } catch (error) {
      console.warn(
        "Skipping an EPUB highlight with an invalid CFI",
        annotation.anchor.cfi,
        error,
      );
    }
  }
}

function clearAutoHighlights(
  rendition: Rendition,
  renderedAutoCfis: Map<string, string>,
) {
  for (const cfi of renderedAutoCfis.values()) {
    try {
      rendition.annotations.remove(cfi, "highlight");
    } catch (error) {
      console.warn("Unable to remove EPUB auto highlight", cfi, error);
    }
  }
  renderedAutoCfis.clear();
}

function wireImageZoom(
  contents: Contents,
  onImageOpen?: (image: ReaderImagePreview) => void,
) {
  if (!onImageOpen) return;

  const images = Array.from(
    contents.document.querySelectorAll<HTMLImageElement>("img"),
  );

  for (const image of images) {
    image.style.cursor = "zoom-in";
    image.title = image.title || "Click to enlarge image";

    if (!image.hasAttribute("tabindex")) {
      image.tabIndex = 0;
    }

    const openImage = () => {
      const src = image.currentSrc || image.src;
      if (!src) return;

      onImageOpen({
        src,
        alt: normalizeText(image.alt) || "Book image",
      });
    };

    image.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImage();
    };

    image.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      event.stopPropagation();
      openImage();
    };
  }
}

function syncImageZoom(
  rendition: Rendition,
  onImageOpen?: (image: ReaderImagePreview) => void,
) {
  for (const contents of renderedContents(rendition)) {
    wireImageZoom(contents, onImageOpen);
  }
}

function syncAutoHighlights(
  rendition: Rendition,
  terms: DifficultTerm[],
  renderedAutoCfis: Map<string, string>,
) {
  clearAutoHighlights(rendition, renderedAutoCfis);

  const contentsList = renderedContents(rendition);
  if (contentsList.length === 0) return;

  for (const term of terms) {
    const key = term.type + ":" + normalizeTerm(term.text);

    for (const contents of contentsList) {
      const range = findExactRange(contents, term.text);
      if (!range) continue;

      const cfi = contents.cfiFromRange(range);
      const phrase = term.type === "phrase";

      rendition.annotations.highlight(
        cfi,
        {
          source: "auto",
          term: term.text,
          type: term.type,
        },
        undefined,
        phrase
          ? "lexipane-epub-auto-phrase"
          : "lexipane-epub-auto-word",
        {
          fill: phrase ? "#ffb564" : "#ffe05c",
          "fill-opacity": phrase ? "0.30" : "0.34",
          "mix-blend-mode": "multiply",
        },
      );

      renderedAutoCfis.set(key, cfi);
      break;
    }
  }
}

export function EpubDocumentView({
  path,
  fontScale = 100,
  theme = "light",
  flowMode = "scrolled",
  initialCfi,
  navigationTarget,
  annotations = [],
  autoTerms = [],
  activeSentence = null,
  sentenceNavigation = null,
  progressNavigation = null,
  onMetadataReady,
  onOutlineReady,
  onCoverReady,
  onRelocated,
  onContextReady,
  onSelection,
  onWordSelection,
  onSentenceSelection,
  onImageOpen,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renderedHighlightCfisRef = useRef<Set<string>>(new Set());
  const lastCfiRef = useRef<string | null>(null);
  const lastPathRef = useRef<string | null>(null);
  const renderedAutoCfisRef = useRef<Map<string, string>>(new Map());
  const autoTermsRef = useRef<DifficultTerm[]>(autoTerms);
  const activeSentenceStateRef = useRef<EpubActiveSentence | null>(
    activeSentence,
  );
  const wiredInteractionDocumentsRef = useRef<WeakSet<Document>>(
    new WeakSet(),
  );
  const wordSelectionTimerRef = useRef<number | null>(null);
  const suppressSelectedUntilRef = useRef(0);
  const handledSentenceNavigationRef = useRef(0);
  const handledProgressNavigationRef = useRef(0);
  const pendingSentenceDirectionRef = useRef<-1 | 1 | null>(null);
  const activeSentenceRef = useRef<{
    contents: Contents;
    index: number;
    count: number;
  } | null>(null);
  const onWordSelectionRef = useRef(onWordSelection);
  const onSentenceSelectionRef = useRef(onSentenceSelection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  onWordSelectionRef.current = onWordSelection;
  onSentenceSelectionRef.current = onSentenceSelection;
  activeSentenceStateRef.current = activeSentence;

  const restoreActiveSentenceHighlight = useCallback(
    (rendition: Rendition) => {
      const desired = activeSentenceStateRef.current;
      const contentsList = renderedContents(rendition);

      for (const contents of contentsList) {
        clearDomSentenceHighlight(contents.document);
      }

      if (!desired) {
        activeSentenceRef.current = null;
        return;
      }

      for (const contents of contentsList) {
        let sentence = selectDomSentenceByIndex(
          contents.document,
          desired.sentenceIndex,
        );

        if (
          !sentence ||
          normalizeText(sentence.text) !== normalizeText(desired.text)
        ) {
          sentence = findDomSentenceByText(
            contents.document,
            desired.text,
          );
        }

        if (!sentence) continue;

        setDomSentenceHighlight(contents.document, sentence.range);
        activeSentenceRef.current = {
          contents,
          index: sentence.index,
          count: sentence.count,
        };
        return;
      }
    },
    [],
  );

  const wireReadingInteractions = useCallback((contents: Contents) => {
    const document = contents.document;
    if (wiredInteractionDocumentsRef.current.has(document)) return;

    wiredInteractionDocumentsRef.current.add(document);

    document.addEventListener("mousedown", (event) => {
      if (event.detail >= 3) {
        event.preventDefault();
      }
    });

    document.addEventListener("dblclick", () => {
      if (wordSelectionTimerRef.current !== null) {
        window.clearTimeout(wordSelectionTimerRef.current);
      }

      wordSelectionTimerRef.current = window.setTimeout(() => {
        wordSelectionTimerRef.current = null;

        const selection = contents.window.getSelection();
        const text = normalizeText(selection?.toString());
        if (!selection || selection.rangeCount === 0 || !text) return;

        const range = selection.getRangeAt(0);
        const cfi = contents.cfiFromRange(range);
        const context = normalizeText(
          contents.document.body?.textContent,
        ).slice(0, 9000);

        onWordSelectionRef.current?.({
          text,
          context,
          cfi,
        });
      }, 320);
    });

    document.addEventListener("click", (event) => {
      if (event.detail !== 3) return;

      if (wordSelectionTimerRef.current !== null) {
        window.clearTimeout(wordSelectionTimerRef.current);
        wordSelectionTimerRef.current = null;
      }

      event.preventDefault();

      suppressSelectedUntilRef.current = Date.now() + 700;

      const sentence = selectDomSentenceAtPoint(
        document,
        event.clientX,
        event.clientY,
      );
      if (!sentence) return;

      const previous = activeSentenceRef.current;
      if (previous && previous.contents.document !== document) {
        clearDomSentenceHighlight(previous.contents.document);
      }

      const cfi = contents.cfiFromRange(sentence.range);
      setDomSentenceHighlight(document, sentence.range);
      contents.window.getSelection()?.removeAllRanges();

      activeSentenceRef.current = {
        contents,
        index: sentence.index,
        count: sentence.count,
      };

      onSentenceSelectionRef.current?.({
        text: sentence.text,
        context: sentence.context,
        cfi,
        sentenceIndex: sentence.index,
        sentenceCount: sentence.count,
      });
    });
  }, []);

  const finishPendingSentenceNavigation = useCallback(
    (rendition: Rendition) => {
      const direction = pendingSentenceDirectionRef.current;
      if (direction === null) return;

      const contentsList = renderedContents(rendition);
      if (contentsList.length === 0) return;

      const contents =
        direction > 0
          ? contentsList[0]
          : contentsList[contentsList.length - 1];
      const sentenceCount = getDomSentenceCount(contents.document);
      if (sentenceCount === 0) return;

      const sentenceIndex =
        direction > 0 ? 0 : sentenceCount - 1;
      suppressSelectedUntilRef.current = Date.now() + 700;

      const sentence = selectDomSentenceByIndex(
        contents.document,
        sentenceIndex,
      );
      if (!sentence) return;

      const previous = activeSentenceRef.current;
      if (
        previous &&
        previous.contents.document !== contents.document
      ) {
        clearDomSentenceHighlight(previous.contents.document);
      }

      pendingSentenceDirectionRef.current = null;
      const cfi = contents.cfiFromRange(sentence.range);
      setDomSentenceHighlight(contents.document, sentence.range);
      contents.window.getSelection()?.removeAllRanges();

      activeSentenceRef.current = {
        contents,
        index: sentence.index,
        count: sentence.count,
      };

      onSentenceSelectionRef.current?.({
        text: sentence.text,
        context: sentence.context,
        cfi,
        sentenceIndex: sentence.index,
        sentenceCount: sentence.count,
      });
    },
    [],
  );

  useEffect(() => {
    autoTermsRef.current = autoTerms;

    const rendition = renditionRef.current;
    if (!rendition) return;

    syncAutoHighlights(
      rendition,
      autoTerms,
      renderedAutoCfisRef.current,
    );
  }, [autoTerms]);

  useEffect(() => {
    let cancelled = false;
    let book: Book | null = null;
    let rendition: Rendition | null = null;

    setLoading(true);
    setError(null);
    renderedHighlightCfisRef.current = new Set();
    renderedAutoCfisRef.current = new Map();

    async function openBook() {
      const host = hostRef.current;
      if (!host) return;

      if (lastPathRef.current !== path) {
        lastPathRef.current = path;
        lastCfiRef.current = initialCfi ?? null;
      }

      host.replaceChildren();

      const bytes = await readFile(path);
      if (cancelled) return;

      book = ePub(exactArrayBuffer(bytes));
      bookRef.current = book;

      await book.ready;
      if (cancelled) return;

      const [metadataResult, navigationResult, coverResult] =
        await Promise.allSettled([
          book.loaded.metadata,
          book.loaded.navigation,
          readEpubCover(book),
        ]);

      if (
        metadataResult.status !== "fulfilled" ||
        navigationResult.status !== "fulfilled"
      ) {
        throw new Error("EPUB metadata or navigation could not be loaded.");
      }

      const metadata = metadataResult.value;
      const navigation = navigationResult.value;

      if (cancelled) return;

      onMetadataReady?.({
        title: normalizeText(metadata.title) || null,
        author: normalizeText(metadata.creator) || null,
      });
      onOutlineReady?.(
        flattenNavigation(navigation.toc ?? []),
      );

      if (
        coverResult.status === "fulfilled" &&
        coverResult.value
      ) {
        onCoverReady?.(coverResult.value);
      }

      rendition = book.renderTo(host, {
        width: "100%",
        height: "100%",
        manager: flowMode === "paginated" ? "default" : "continuous",
        flow: flowMode === "paginated" ? "paginated" : "scrolled-doc",
        spread: "none",
      });
      renditionRef.current = rendition;

      rendition.themes.default(themeRules(theme));

      rendition.themes.fontSize(fontScale + "%");

      rendition.on(
        "relocated",
        (location: Location) => {
          const cfi = location.start?.cfi;
          if (!cfi || !rendition) return;

          const percentage =
            typeof location.start.percentage === "number"
              ? location.start.percentage
              : null;

          lastCfiRef.current = cfi;
          onRelocated?.(cfi, percentage);

          window.setTimeout(() => {
            if (cancelled || !rendition) return;

            const context = currentContext(rendition);
            if (context) {
              onContextReady?.(cfi, context);
            }

            syncAutoHighlights(
              rendition,
              autoTermsRef.current,
              renderedAutoCfisRef.current,
            );
            syncImageZoom(rendition, onImageOpen);
            for (const contents of renderedContents(rendition)) {
              wireReadingInteractions(contents);
            }
            finishPendingSentenceNavigation(rendition);
            restoreActiveSentenceHighlight(rendition);
          }, 0);
        },
      );

      rendition.on("rendered", () => {
        window.setTimeout(() => {
          if (!cancelled && rendition) {
            syncImageZoom(rendition, onImageOpen);
            for (const contents of renderedContents(rendition)) {
              wireReadingInteractions(contents);
            }
            finishPendingSentenceNavigation(rendition);
            restoreActiveSentenceHighlight(rendition);
          }
        }, 0);
      });

      rendition.on(
        "selected",
        (cfi: string, contents: Contents) => {
          if (Date.now() < suppressSelectedUntilRef.current) {
            return;
          }

          const text = normalizeText(
            contents.window.getSelection()?.toString(),
          );
          if (!text) return;

          const context = normalizeText(
            contents.document.body?.textContent,
          ).slice(0, 9000);

          onSelection?.({
            text,
            context,
            cfi,
          });
        },
      );

      const requestedCfi =
        lastCfiRef.current || initialCfi || null;

      try {
        await rendition.display(requestedCfi || undefined);
      } catch (displayError) {
        if (!requestedCfi) throw displayError;

        console.warn(
          "Saved EPUB CFI could not be restored; opening at the book start.",
          requestedCfi,
          displayError,
        );
        lastCfiRef.current = null;
        await rendition.display();
      }

      if (cancelled) return;

      syncUserHighlights(
        rendition,
        annotations,
        renderedHighlightCfisRef.current,
      );
      syncAutoHighlights(
        rendition,
        autoTermsRef.current,
        renderedAutoCfisRef.current,
      );
      syncImageZoom(rendition, onImageOpen);
      for (const contents of renderedContents(rendition)) {
        wireReadingInteractions(contents);
      }
      restoreActiveSentenceHighlight(rendition);

      const context = currentContext(rendition);
      const location = rendition.location?.start?.cfi;
      if (context && location) {
        onContextReady?.(location, context);
      }

      setLoading(false);
    }

    void openBook().catch((openError) => {
      if (cancelled) return;
      setLoading(false);
      setError(
        openError instanceof Error
          ? openError.message
          : "Unable to open this EPUB.",
      );
    });

    return () => {
      cancelled = true;
      renditionRef.current = null;
      bookRef.current = null;
      if (rendition) {
        clearAutoHighlights(
          rendition,
          renderedAutoCfisRef.current,
        );
        rendition.destroy();
      }
      book?.destroy();
    };
  }, [
    initialCfi,
    onContextReady,
    flowMode,
    onCoverReady,
    onMetadataReady,
    onOutlineReady,
    onImageOpen,
    onRelocated,
    onSelection,
    path,
    wireReadingInteractions,
    finishPendingSentenceNavigation,
    restoreActiveSentenceHighlight,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    syncUserHighlights(
      rendition,
      annotations,
      renderedHighlightCfisRef.current,
    );
  }, [annotations]);

  useEffect(() => {
    if (!navigationTarget || !renditionRef.current) return;

    void renditionRef.current
      .display(navigationTarget)
      .catch((error) => {
        console.warn(
          "Unable to navigate to EPUB CFI",
          navigationTarget,
          error,
        );
      });
  }, [navigationTarget]);

  useEffect(() => {
    if (
      !sentenceNavigation ||
      sentenceNavigation.token === handledSentenceNavigationRef.current
    ) {
      return;
    }

    handledSentenceNavigationRef.current = sentenceNavigation.token;

    const active = activeSentenceRef.current;
    if (!active) return;

    const nextIndex = active.index + sentenceNavigation.direction;

    if (nextIndex >= 0 && nextIndex < active.count) {
      suppressSelectedUntilRef.current = Date.now() + 700;

      const sentence = selectDomSentenceByIndex(
        active.contents.document,
        nextIndex,
      );
      if (!sentence) return;

      const cfi = active.contents.cfiFromRange(sentence.range);
      setDomSentenceHighlight(
        active.contents.document,
        sentence.range,
      );
      active.contents.window.getSelection()?.removeAllRanges();

      activeSentenceRef.current = {
        contents: active.contents,
        index: sentence.index,
        count: sentence.count,
      };

      onSentenceSelectionRef.current?.({
        text: sentence.text,
        context: sentence.context,
        cfi,
        sentenceIndex: sentence.index,
        sentenceCount: sentence.count,
      });
      return;
    }

    const rendition = renditionRef.current;
    if (!rendition) return;

    pendingSentenceDirectionRef.current =
      sentenceNavigation.direction;
    activeSentenceRef.current = null;

    const navigation =
      sentenceNavigation.direction > 0
        ? rendition.next()
        : rendition.prev();

    void Promise.resolve(navigation)
      .then(() => {
        window.setTimeout(() => {
          const current = renditionRef.current;
          if (current) {
            finishPendingSentenceNavigation(current);
          }
        }, 0);
      })
      .catch((error) => {
        pendingSentenceDirectionRef.current = null;
        console.warn("Unable to move to adjacent EPUB section", error);
      });
  }, [finishPendingSentenceNavigation, sentenceNavigation]);

  useEffect(() => {
    if (
      !progressNavigation ||
      progressNavigation.token === handledProgressNavigationRef.current
    ) {
      return;
    }

    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!book || !rendition) return;

    handledProgressNavigationRef.current = progressNavigation.token;

    const clamped = Math.max(
      0,
      Math.min(1, progressNavigation.progress),
    );

    void (async () => {
      try {
        if (book.locations.length() === 0) {
          await book.locations.generate(1600);
        }

        const cfi = book.locations.cfiFromPercentage(clamped);
        if (cfi) {
          activeSentenceRef.current = null;
          await rendition.display(cfi);
        }
      } catch (error) {
        console.warn("Unable to scrub EPUB progress", error);
      }
    })();
  }, [progressNavigation]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    restoreActiveSentenceHighlight(rendition);
  }, [activeSentence, restoreActiveSentenceHighlight]);

  useEffect(() => {
    const handleResize = () => {
      window.requestAnimationFrame(() => {
        const rendition = renditionRef.current;
        if (rendition) {
          restoreActiveSentenceHighlight(rendition);
        }
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [restoreActiveSentenceHighlight]);

  useEffect(() => {
    renditionRef.current?.themes.fontSize(fontScale + "%");
  }, [fontScale]);

  useEffect(() => {
    renditionRef.current?.themes.default(themeRules(theme));
  }, [theme]);

  return (
    <div
      className={
        "epub-reader-shell ebook-theme-" +
        theme +
        (flowMode === "paginated" ? " paginated" : "")
      }
    >
      {loading && (
        <div className="pdf-state-card epub-loading-card">
          <span className="pdf-spinner" />
          <strong>Opening EPUB…</strong>
          <p>Preparing the reflowable book and its table of contents.</p>
        </div>
      )}

      {error && (
        <div className="pdf-state-card error epub-loading-card">
          <strong>Unable to open this EPUB.</strong>
          <p>{error}</p>
        </div>
      )}

      <div
        ref={hostRef}
        className={
          loading || error
            ? "epub-rendition hidden"
            : "epub-rendition"
        }
      />

      {flowMode === "paginated" && !loading && !error && (
        <div className="epub-page-controls">
          <button
            aria-label="Previous EPUB page"
            onClick={() => void renditionRef.current?.prev()}
          >
            ←
          </button>
          <button
            aria-label="Next EPUB page"
            onClick={() => void renditionRef.current?.next()}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
