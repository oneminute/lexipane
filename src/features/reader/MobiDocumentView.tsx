import { readFile } from "@tauri-apps/plugin-fs";
import {
  initKf8File,
  initMobiFile,
  type Kf8,
  type Kf8TocItem,
  type Mobi,
  type MobiTocItem,
} from "@lingo-reader/mobi-parser";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DifficultTerm } from "../../core/ai/difficultyService";
import type { KindleTextAnnotation } from "../../core/annotations/kindleAnnotations";
import { getBookExtension } from "../../core/books/openBook";
import { normalizeTerm } from "../../core/reading/knownTerms";
import type { EbookTheme } from "../../core/reading/ebookPreferences";
import type { ReaderImagePreview } from "./readerImage";
import {
  getDomSentenceCount,
  selectDomSentenceAtPoint,
  selectDomSentenceByIndex,
} from "./sentenceNavigation";

type KindleParser = Mobi | Kf8;
type KindleTocItem = MobiTocItem | Kf8TocItem;

interface KindleSpineEntry {
  id: string;
}

interface KindleProcessedChapter {
  html: string;
  css: Array<{
    id: string;
    href: string;
  }>;
}

export interface KindleMetadataSummary {
  title: string | null;
  author: string | null;
}

export interface KindleOutlineEntry {
  id: string;
  title: string;
  chapterId: string | null;
  selector: string | null;
  depth: number;
}

export interface KindleSelection {
  text: string;
  context: string;
  chapterId: string;
}

export interface KindleSentenceSelection extends KindleSelection {
  sentenceIndex: number;
  sentenceCount: number;
}

interface SentenceNavigationRequest {
  token: number;
  direction: -1 | 1;
}

interface Props {
  path: string;
  fontScale?: number;
  theme?: EbookTheme;
  initialChapterId?: string | null;
  navigationChapterId?: string | null;
  annotations?: KindleTextAnnotation[];
  autoTerms?: DifficultTerm[];
  sentenceNavigation?: SentenceNavigationRequest | null;
  onMetadataReady?: (metadata: KindleMetadataSummary) => void;
  onOutlineReady?: (outline: KindleOutlineEntry[]) => void;
  onCoverReady?: (coverDataUrl: string) => void;
  onRelocated?: (
    chapterId: string,
    progress: number | null,
  ) => void;
  onContextReady?: (
    chapterId: string,
    context: string,
  ) => void;
  onSelection?: (selection: KindleSelection) => void;
  onWordSelection?: (selection: KindleSelection) => void;
  onSentenceSelection?: (selection: KindleSentenceSelection) => void;
  onImageOpen?: (image: ReaderImagePreview) => void;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s\u00a0]+/g, " ").trim();
}

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();

    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function openParser(
  path: string,
  bytes: Uint8Array,
): Promise<KindleParser> {
  const extension = getBookExtension(path);

  if (extension === "azw3") {
    return initKf8File(bytes);
  }

  if (extension === "azw") {
    try {
      return await initKf8File(bytes);
    } catch {
      return initMobiFile(bytes);
    }
  }

  return initMobiFile(bytes);
}

function flattenToc(
  parser: KindleParser,
  items: KindleTocItem[],
  depth = 0,
  prefix = "",
): KindleOutlineEntry[] {
  const result: KindleOutlineEntry[] = [];

  items.forEach((item, index) => {
    const id = prefix + index;
    const resolved = parser.resolveHref(item.href);

    result.push({
      id,
      title: normalizeText(item.label) || "Untitled section",
      chapterId: resolved?.id ?? null,
      selector: resolved?.selector ?? null,
      depth,
    });

    if (item.children?.length) {
      result.push(
        ...flattenToc(
          parser,
          item.children,
          depth + 1,
          id + ".",
        ),
      );
    }
  });

  return result;
}

function chapterDocument(
  chapter: KindleProcessedChapter,
  theme: EbookTheme,
): string {
  const cssLinks = chapter.css
    .map(
      (part) =>
        '<link rel="stylesheet" href="' +
        part.href.replace(/"/g, "&quot;") +
        '">',
    )
    .join("");

  const palette =
    theme === "dark"
      ? {
          background: "#1f2024",
          text: "#e7e5df",
          link: "#b8afff",
        }
      : theme === "sepia"
        ? {
            background: "#f4ecd8",
            text: "#443b2c",
            link: "#6c5897",
          }
        : {
            background: "#fffefa",
            text: "#282725",
            link: "#5549a6",
          };

  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" ',
    'content="default-src \'none\'; img-src blob: data:; ',
    'media-src blob: data:; style-src \'unsafe-inline\' blob:; ',
    'font-src blob: data:;">',
    cssLinks,
    "<style>",
    "html{background:" + palette.background + ";color:" + palette.text + ";}",
    "body{margin:0;padding:42px 48px;font-family:Georgia,'Times New Roman',serif;",
    "line-height:1.75;overflow-wrap:anywhere;background:" +
      palette.background +
      ";color:" +
      palette.text +
      ";}",
    "img,svg,video{max-width:100%;height:auto;}",
    "a{color:" + palette.link + ";}",
    "::selection{background:rgba(101,88,219,.25);}",
    "mark.lexipane-kindle-user{background:rgba(111,161,235,.32);color:inherit;}",
    "mark.lexipane-kindle-auto-word{background:rgba(255,224,92,.34);color:inherit;}",
    "mark.lexipane-kindle-auto-phrase{background:rgba(255,181,100,.30);color:inherit;}",
    "</style></head><body>",
    chapter.html,
    "</body></html>",
  ].join("");
}

function unwrapMarks(document: Document) {
  const marks = Array.from(
    document.querySelectorAll<HTMLElement>(
      "mark.lexipane-kindle-user, " +
        "mark.lexipane-kindle-auto-word, " +
        "mark.lexipane-kindle-auto-phrase",
    ),
  );

  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;

    parent.replaceChild(
      document.createTextNode(mark.textContent ?? ""),
      mark,
    );
    parent.normalize();
  }
}

function markFirstExact(
  document: Document,
  exact: string,
  className: string,
): boolean {
  const body = document.body;
  if (!body || !exact.trim()) return false;

  const target = exact.toLocaleLowerCase("en-US");
  const walker = document.createTreeWalker(
    body,
    4,
  );

  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      parent &&
      !parent.closest("script,style,mark") &&
      node.nodeValue
    ) {
      const value = node.nodeValue;
      const index = value
        .toLocaleLowerCase("en-US")
        .indexOf(target);

      if (index >= 0) {
        const before = value.slice(0, index);
        const selected = value.slice(index, index + exact.length);
        const after = value.slice(index + exact.length);
        const fragment = document.createDocumentFragment();

        if (before) {
          fragment.append(document.createTextNode(before));
        }

        const mark = document.createElement("mark");
        mark.className = className;
        mark.textContent = selected;
        fragment.append(mark);

        if (after) {
          fragment.append(document.createTextNode(after));
        }

        parent.replaceChild(fragment, node);
        return true;
      }
    }

    node = walker.nextNode();
  }

  return false;
}

function applyMarks(
  document: Document,
  chapterId: string,
  annotations: KindleTextAnnotation[],
  autoTerms: DifficultTerm[],
) {
  unwrapMarks(document);

  for (const annotation of annotations) {
    if (annotation.anchor.chapterId !== chapterId) continue;
    markFirstExact(
      document,
      annotation.selectedText,
      "lexipane-kindle-user",
    );
  }

  const seen = new Set<string>();
  for (const term of autoTerms) {
    const key = normalizeTerm(term.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    markFirstExact(
      document,
      term.text,
      term.type === "phrase"
        ? "lexipane-kindle-auto-phrase"
        : "lexipane-kindle-auto-word",
    );
  }
}

export function MobiDocumentView({
  path,
  fontScale = 100,
  theme = "light",
  initialChapterId,
  navigationChapterId,
  annotations = [],
  autoTerms = [],
  sentenceNavigation = null,
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const parserRef = useRef<KindleParser | null>(null);
  const pendingSelectorRef = useRef<string | null>(null);
  const annotationsRef = useRef(annotations);
  const autoTermsRef = useRef(autoTerms);
  const wordSelectionTimerRef = useRef<number | null>(null);
  const handledSentenceNavigationRef = useRef(0);
  const pendingSentenceDirectionRef = useRef<-1 | 1 | null>(null);
  const activeSentenceRef = useRef<{
    document: Document;
    index: number;
    count: number;
    chapterId: string;
  } | null>(null);
  const onWordSelectionRef = useRef(onWordSelection);
  const onSentenceSelectionRef = useRef(onSentenceSelection);

  const [parser, setParser] = useState<KindleParser | null>(null);
  const [spine, setSpine] = useState<KindleSpineEntry[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [chapterHtml, setChapterHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  annotationsRef.current = annotations;
  autoTermsRef.current = autoTerms;
  onWordSelectionRef.current = onWordSelection;
  onSentenceSelectionRef.current = onSentenceSelection;

  useEffect(() => {
    let cancelled = false;
    let activeParser: KindleParser | null = null;

    setLoading(true);
    setError(null);
    setParser(null);
    setSpine([]);
    setChapterId("");
    setChapterHtml("");

    async function initialize() {
      const bytes = await readFile(path);
      if (cancelled) return;

      activeParser = await openParser(path, bytes);
      if (cancelled) {
        activeParser.destroy();
        return;
      }

      parserRef.current = activeParser;
      setParser(activeParser);

      const metadata = activeParser.getMetadata();
      onMetadataReady?.({
        title: normalizeText(metadata.title) || null,
        author:
          metadata.author?.map(normalizeText).filter(Boolean).join(", ") ||
          null,
      });

      const coverUrl = activeParser.getCoverImage();
      if (coverUrl) {
        const coverDataUrl = await imageUrlToDataUrl(coverUrl);
        if (!cancelled && coverDataUrl) {
          onCoverReady?.(coverDataUrl);
        }
      }

      const nextSpine = activeParser.getSpine() as KindleSpineEntry[];
      setSpine(nextSpine);
      onOutlineReady?.(
        flattenToc(
          activeParser,
          activeParser.getToc() as KindleTocItem[],
        ),
      );

      const desired =
        initialChapterId &&
        nextSpine.some((item) => item.id === initialChapterId)
          ? initialChapterId
          : nextSpine[0]?.id ?? "";

      if (!desired) {
        throw new Error("This book does not contain readable chapters.");
      }

      setChapterId(desired);
      setLoading(false);
    }

    void initialize().catch((openError) => {
      if (cancelled) return;
      setLoading(false);
      setError(
        openError instanceof Error
          ? openError.message
          : "Unable to open this Kindle book.",
      );
    });

    return () => {
      cancelled = true;
      parserRef.current = null;
      activeParser?.destroy();
    };
  }, [
    initialChapterId,
    onCoverReady,
    onMetadataReady,
    onOutlineReady,
    path,
  ]);

  useEffect(() => {
    if (!parser || !chapterId) return;

    const chapter = parser.loadChapter(
      chapterId,
    ) as KindleProcessedChapter | undefined;

    if (!chapter) {
      setError("Unable to load chapter " + chapterId + ".");
      return;
    }

    setChapterHtml(chapterDocument(chapter, theme));

    const index = spine.findIndex((item) => item.id === chapterId);
    const progress =
      index < 0 || spine.length <= 1
        ? null
        : index / (spine.length - 1);

    onRelocated?.(chapterId, progress);
  }, [chapterId, onRelocated, parser, spine, theme]);

  useEffect(() => {
    if (!navigationChapterId || !parser) return;
    if (
      spine.some((item) => item.id === navigationChapterId)
    ) {
      setChapterId(navigationChapterId);
    }
  }, [navigationChapterId, parser, spine]);

  const applyCurrentMarks = useCallback(() => {
    const document = iframeRef.current?.contentDocument;
    if (!document || !chapterId) return;

    applyMarks(
      document,
      chapterId,
      annotationsRef.current,
      autoTermsRef.current,
    );
  }, [chapterId]);

  useEffect(() => {
    applyCurrentMarks();
  }, [annotations, applyCurrentMarks, autoTerms]);

  const handleFrameLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const document = iframe?.contentDocument;
    const frameWindow = iframe?.contentWindow;

    if (!document || !frameWindow || !chapterId || !parser) return;

    document.documentElement.style.fontSize = fontScale + "%";
    applyCurrentMarks();

    const context = normalizeText(document.body?.textContent).slice(
      0,
      9000,
    );
    if (context) {
      onContextReady?.(chapterId, context);
    }

    const pendingSentenceDirection =
      pendingSentenceDirectionRef.current;
    if (pendingSentenceDirection !== null) {
      pendingSentenceDirectionRef.current = null;

      const sentenceCount = getDomSentenceCount(document);
      const sentenceIndex =
        pendingSentenceDirection > 0
          ? 0
          : Math.max(0, sentenceCount - 1);
      const sentence = selectDomSentenceByIndex(
        document,
        sentenceIndex,
      );

      if (sentence) {
        activeSentenceRef.current = {
          document,
          index: sentence.index,
          count: sentence.count,
          chapterId,
        };

        onSentenceSelectionRef.current?.({
          text: sentence.text,
          context: sentence.context,
          chapterId,
          sentenceIndex: sentence.index,
          sentenceCount: sentence.count,
        });
      }
    }

    const pendingSelector = pendingSelectorRef.current;
    if (pendingSelector) {
      pendingSelectorRef.current = null;
      try {
        document
          .querySelector(pendingSelector)
          ?.scrollIntoView({ block: "start" });
      } catch {
        // Invalid selectors from damaged source books are ignored.
      }
    }

    const reportSelection = () => {
      const text = normalizeText(
        frameWindow.getSelection()?.toString(),
      );
      if (!text) return;

      onSelection?.({
        text,
        context: normalizeText(document.body?.textContent).slice(
          0,
          9000,
        ),
        chapterId,
      });
    };

    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>("img"),
    );

    const openImage = (image: HTMLImageElement) => {
      if (!onImageOpen) return;

      const src = image.currentSrc || image.src;
      if (!src) return;

      onImageOpen({
        src,
        alt: normalizeText(image.alt) || "Book image",
      });
    };

    for (const image of images) {
      image.style.cursor = onImageOpen ? "zoom-in" : "";
      image.title = image.title || "Click to enlarge image";

      if (onImageOpen && !image.hasAttribute("tabindex")) {
        image.tabIndex = 0;
      }
    }

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (event.detail >= 3) {
        event.preventDefault();
      }
    };

    const handleDocumentDoubleClick = () => {
      if (wordSelectionTimerRef.current !== null) {
        window.clearTimeout(wordSelectionTimerRef.current);
      }

      wordSelectionTimerRef.current = window.setTimeout(() => {
        wordSelectionTimerRef.current = null;

        const selection = frameWindow.getSelection();
        const text = normalizeText(selection?.toString());
        if (!selection || selection.rangeCount === 0 || !text) return;

        activeSentenceRef.current = null;
        onWordSelectionRef.current?.({
          text,
          context: normalizeText(document.body?.textContent).slice(
            0,
            9000,
          ),
          chapterId,
        });
      }, 320);
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.detail === 3) {
        if (wordSelectionTimerRef.current !== null) {
          window.clearTimeout(wordSelectionTimerRef.current);
          wordSelectionTimerRef.current = null;
        }

        event.preventDefault();

        const sentence = selectDomSentenceAtPoint(
          document,
          event.clientX,
          event.clientY,
        );

        if (sentence) {
          activeSentenceRef.current = {
            document,
            index: sentence.index,
            count: sentence.count,
            chapterId,
          };

          onSentenceSelectionRef.current?.({
            text: sentence.text,
            context: sentence.context,
            chapterId,
            sentenceIndex: sentence.index,
            sentenceCount: sentence.count,
          });
        }
        return;
      }

      const target =
        event.target instanceof Element ? event.target : null;
      const image = target?.closest<HTMLImageElement>("img");

      if (image && onImageOpen) {
        event.preventDefault();
        event.stopPropagation();
        openImage(image);
        return;
      }

      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      const resolved = parser.resolveHref(href);

      event.preventDefault();

      if (!resolved) return;

      pendingSelectorRef.current = resolved.selector || null;
      setChapterId(resolved.id);
    };

    const handleImageKeyDown = (event: KeyboardEvent) => {
      if (!onImageOpen) return;
      if (event.key !== "Enter" && event.key !== " ") return;

      const target =
        event.target instanceof Element ? event.target : null;
      const image = target?.closest<HTMLImageElement>("img");
      if (!image) return;

      event.preventDefault();
      event.stopPropagation();
      openImage(image);
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("mouseup", reportSelection);
    document.addEventListener("keyup", reportSelection);
    document.addEventListener("dblclick", handleDocumentDoubleClick);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleImageKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("mouseup", reportSelection);
      document.removeEventListener("keyup", reportSelection);
      document.removeEventListener("dblclick", handleDocumentDoubleClick);
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleImageKeyDown);
    };
  }, [
    applyCurrentMarks,
    chapterId,
    fontScale,
    onContextReady,
    onImageOpen,
    onSelection,
    parser,
  ]);

  useEffect(() => {
    const document = iframeRef.current?.contentDocument;
    if (document) {
      document.documentElement.style.fontSize = fontScale + "%";
    }
  }, [fontScale]);

  const chapterIndex = useMemo(
    () => spine.findIndex((item) => item.id === chapterId),
    [chapterId, spine],
  );

  useEffect(() => {
    if (
      !sentenceNavigation ||
      sentenceNavigation.token === handledSentenceNavigationRef.current
    ) {
      return;
    }

    handledSentenceNavigationRef.current = sentenceNavigation.token;

    const active = activeSentenceRef.current;
    if (!active || active.chapterId !== chapterId) return;

    const nextIndex = active.index + sentenceNavigation.direction;

    if (nextIndex >= 0 && nextIndex < active.count) {
      const sentence = selectDomSentenceByIndex(
        active.document,
        nextIndex,
      );
      if (!sentence) return;

      activeSentenceRef.current = {
        document: active.document,
        index: sentence.index,
        count: sentence.count,
        chapterId,
      };

      onSentenceSelectionRef.current?.({
        text: sentence.text,
        context: sentence.context,
        chapterId,
        sentenceIndex: sentence.index,
        sentenceCount: sentence.count,
      });
      return;
    }

    const currentIndex = spine.findIndex(
      (item) => item.id === chapterId,
    );
    const adjacent =
      spine[currentIndex + sentenceNavigation.direction];

    if (!adjacent) return;

    pendingSentenceDirectionRef.current =
      sentenceNavigation.direction;
    activeSentenceRef.current = null;
    setChapterId(adjacent.id);
  }, [chapterId, sentenceNavigation, spine]);

  if (error) {
    return (
      <div className="pdf-state-card error">
        <strong>Unable to open this Kindle book.</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (loading || !parser) {
    return (
      <div className="pdf-state-card">
        <span className="pdf-spinner" />
        <strong>Opening Kindle book…</strong>
        <p>Parsing MOBI/KF8 chapters and resources locally.</p>
      </div>
    );
  }

  return (
    <div className={"kindle-reader-shell ebook-theme-" + theme}>
      <div className="kindle-chapter-toolbar">
        <button
          disabled={chapterIndex <= 0}
          onClick={() => {
            const previous = spine[chapterIndex - 1];
            if (previous) setChapterId(previous.id);
          }}
        >
          ← Previous
        </button>
        <span>
          Chapter {chapterIndex + 1} / {spine.length}
        </span>
        <button
          disabled={
            chapterIndex < 0 || chapterIndex >= spine.length - 1
          }
          onClick={() => {
            const next = spine[chapterIndex + 1];
            if (next) setChapterId(next.id);
          }}
        >
          Next →
        </button>
      </div>

      <iframe
        ref={iframeRef}
        className="kindle-rendition"
        title="Kindle book chapter"
        sandbox="allow-same-origin"
        srcDoc={chapterHtml}
        onLoad={handleFrameLoad}
      />
    </div>
  );
}
