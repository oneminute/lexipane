import { readFile } from "@tauri-apps/plugin-fs";
import ePub, {
  type Book,
  type Contents,
  type Location,
  type NavItem,
  type Rendition,
} from "epubjs";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { EpubTextAnnotation } from "../../core/annotations/epubAnnotations";
import type { DifficultTerm } from "../../core/ai/difficultyService";
import { normalizeTerm } from "../../core/reading/knownTerms";

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

interface Props {
  path: string;
  fontScale?: number;
  initialCfi?: string | null;
  navigationTarget?: string | null;
  annotations?: EpubTextAnnotation[];
  autoTerms?: DifficultTerm[];
  onMetadataReady?: (metadata: EpubMetadataSummary) => void;
  onOutlineReady?: (outline: EpubOutlineEntry[]) => void;
  onRelocated?: (cfi: string, progress: number | null) => void;
  onContextReady?: (cfi: string, context: string) => void;
  onSelection?: (selection: EpubSelection) => void;
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
      rendition.annotations.remove(cfi, "highlight");
      renderedCfis.delete(cfi);
    }
  }

  for (const annotation of annotations) {
    if (renderedCfis.has(annotation.anchor.cfi)) {
      continue;
    }

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
  }
}

function clearAutoHighlights(
  rendition: Rendition,
  renderedAutoCfis: Map<string, string>,
) {
  for (const cfi of renderedAutoCfis.values()) {
    rendition.annotations.remove(cfi, "highlight");
  }
  renderedAutoCfis.clear();
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
  initialCfi,
  navigationTarget,
  annotations = [],
  autoTerms = [],
  onMetadataReady,
  onOutlineReady,
  onRelocated,
  onContextReady,
  onSelection,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renderedHighlightCfisRef = useRef<Set<string>>(new Set());
  const renderedAutoCfisRef = useRef<Map<string, string>>(new Map());
  const autoTermsRef = useRef<DifficultTerm[]>(autoTerms);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      host.replaceChildren();

      const bytes = await readFile(path);
      if (cancelled) return;

      book = ePub(exactArrayBuffer(bytes));
      bookRef.current = book;

      await book.ready;
      if (cancelled) return;

      const [metadata, navigation] = await Promise.all([
        book.loaded.metadata,
        book.loaded.navigation,
      ]);

      if (cancelled) return;

      onMetadataReady?.({
        title: normalizeText(metadata.title) || null,
        author: normalizeText(metadata.creator) || null,
      });
      onOutlineReady?.(
        flattenNavigation(navigation.toc ?? []),
      );

      rendition = book.renderTo(host, {
        width: "100%",
        height: "100%",
        manager: "continuous",
        flow: "scrolled-doc",
        spread: "none",
      });
      renditionRef.current = rendition;

      rendition.themes.default({
        body: {
          "font-family":
            "Georgia, 'Times New Roman', serif !important",
          "line-height": "1.75 !important",
          color: "#282725 !important",
          padding: "24px 32px !important",
        },
        "p, li": {
          "line-height": "1.75 !important",
        },
        "::selection": {
          background: "rgba(101, 88, 219, 0.25)",
        },
      });

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
          }, 0);
        },
      );

      rendition.on(
        "selected",
        (cfi: string, contents: Contents) => {
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

      await rendition.display(initialCfi || undefined);
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
    onMetadataReady,
    onOutlineReady,
    onRelocated,
    onSelection,
    path,
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
    void renditionRef.current.display(navigationTarget);
  }, [navigationTarget]);

  useEffect(() => {
    renditionRef.current?.themes.fontSize(fontScale + "%");
  }, [fontScale]);

  return (
    <div className="epub-reader-shell">
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
    </div>
  );
}
