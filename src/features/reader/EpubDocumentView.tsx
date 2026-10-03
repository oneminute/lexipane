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
  initialCfi?: string | null;
  navigationTarget?: string | null;
  annotations?: EpubTextAnnotation[];
  onMetadataReady?: (metadata: EpubMetadataSummary) => void;
  onOutlineReady?: (outline: EpubOutlineEntry[]) => void;
  onRelocated?: (cfi: string, progress: number | null) => void;
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

function syncHighlights(
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

export function EpubDocumentView({
  path,
  initialCfi,
  navigationTarget,
  annotations = [],
  onMetadataReady,
  onOutlineReady,
  onRelocated,
  onSelection,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renderedHighlightCfisRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let book: Book | null = null;
    let rendition: Rendition | null = null;

    setLoading(true);
    setError(null);
    renderedHighlightCfisRef.current = new Set();

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
          "font-size": "18px !important",
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

      rendition.on(
        "relocated",
        (location: Location) => {
          const cfi = location.start?.cfi;
          if (!cfi) return;

          const percentage =
            typeof location.start.percentage === "number"
              ? location.start.percentage
              : null;

          onRelocated?.(cfi, percentage);
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

      syncHighlights(
        rendition,
        annotations,
        renderedHighlightCfisRef.current,
      );

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
      rendition?.destroy();
      book?.destroy();
    };
  }, [
    initialCfi,
    onMetadataReady,
    onOutlineReady,
    onRelocated,
    onSelection,
    path,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    syncHighlights(
      rendition,
      annotations,
      renderedHighlightCfisRef.current,
    );
  }, [annotations]);

  useEffect(() => {
    if (!navigationTarget || !renditionRef.current) return;
    void renditionRef.current.display(navigationTarget);
  }, [navigationTarget]);

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
