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

interface Props {
  path: string;
  fontScale?: number;
  initialChapterId?: string | null;
  navigationChapterId?: string | null;
  annotations?: KindleTextAnnotation[];
  autoTerms?: DifficultTerm[];
  onMetadataReady?: (metadata: KindleMetadataSummary) => void;
  onOutlineReady?: (outline: KindleOutlineEntry[]) => void;
  onRelocated?: (
    chapterId: string,
    progress: number | null,
  ) => void;
  onContextReady?: (
    chapterId: string,
    context: string,
  ) => void;
  onSelection?: (selection: KindleSelection) => void;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s\u00a0]+/g, " ").trim();
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
): string {
  const cssLinks = chapter.css
    .map(
      (part) =>
        '<link rel="stylesheet" href="' +
        part.href.replace(/"/g, "&quot;") +
        '">',
    )
    .join("");

  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" ',
    'content="default-src \'none\'; img-src blob: data:; ',
    'media-src blob: data:; style-src \'unsafe-inline\' blob:; ',
    'font-src blob: data:;">',
    cssLinks,
    "<style>",
    "html{background:#fffefa;color:#282725;}",
    "body{margin:0;padding:42px 48px;font-family:Georgia,'Times New Roman',serif;",
    "line-height:1.75;overflow-wrap:anywhere;}",
    "img,svg,video{max-width:100%;height:auto;}",
    "a{color:#5549a6;}",
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
    document.querySelectorAll<HTMLMarkElement>(
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
  initialChapterId,
  navigationChapterId,
  annotations = [],
  autoTerms = [],
  onMetadataReady,
  onOutlineReady,
  onRelocated,
  onContextReady,
  onSelection,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const parserRef = useRef<KindleParser | null>(null);
  const pendingSelectorRef = useRef<string | null>(null);
  const annotationsRef = useRef(annotations);
  const autoTermsRef = useRef(autoTerms);

  const [parser, setParser] = useState<KindleParser | null>(null);
  const [spine, setSpine] = useState<KindleSpineEntry[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [chapterHtml, setChapterHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  annotationsRef.current = annotations;
  autoTermsRef.current = autoTerms;

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

    setChapterHtml(chapterDocument(chapter));

    const index = spine.findIndex((item) => item.id === chapterId);
    const progress =
      index < 0 || spine.length <= 1
        ? null
        : index / (spine.length - 1);

    onRelocated?.(chapterId, progress);
  }, [chapterId, onRelocated, parser, spine]);

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

    const handleLink = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      const resolved = parser.resolveHref(href);

      event.preventDefault();

      if (!resolved) return;

      pendingSelectorRef.current = resolved.selector || null;
      setChapterId(resolved.id);
    };

    document.addEventListener("mouseup", reportSelection);
    document.addEventListener("keyup", reportSelection);
    document.addEventListener("click", handleLink);

    return () => {
      document.removeEventListener("mouseup", reportSelection);
      document.removeEventListener("keyup", reportSelection);
      document.removeEventListener("click", handleLink);
    };
  }, [
    applyCurrentMarks,
    chapterId,
    fontScale,
    onContextReady,
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
    <div className="kindle-reader-shell">
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
