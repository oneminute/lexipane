import { useCallback, useEffect, useState } from "react";
import { AppSidebar, type AppView } from "./components/AppSidebar";
import { listenForBookDrops } from "./core/books/drop";
import type { ReaderNavigationTarget } from "./core/books/navigation";
import { registerBookFile } from "./core/books/library";
import {
  chooseBookFile,
  isSupportedBookPath,
} from "./core/books/openBook";
import { initializeDatabase } from "./core/db/database";
import { LibraryView } from "./features/library/LibraryView";
import { NotebookView } from "./features/notebook/NotebookView";
import { ReaderErrorBoundary } from "./features/reader/ReaderErrorBoundary";
import { ReaderView } from "./features/reader/ReaderView";
import { ResourceHubView } from "./features/resources/ResourceHubView";
import { initializeResourceTransferRuntime } from "./core/resources/runtime";
import { initializeResourceTransferConcurrency } from "./core/resources/preferences";
import { AiSettingsView } from "./features/settings/AiSettingsView";

export default function App() {
  const [view, setView] = useState<AppView>("library");
  const [activeBookPath, setActiveBookPath] = useState<string | null>(null);
  const [activeNavigationTarget, setActiveNavigationTarget] =
    useState<ReaderNavigationTarget | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);

  useEffect(() => {
    void initializeDatabase().catch((error) => {
      console.error("LexiPane database initialization failed", error);
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      await initializeResourceTransferConcurrency().catch((error) => {
        console.error(
          "Unable to apply resource transfer concurrency",
          error,
        );
      });

      const dispose = await initializeResourceTransferRuntime({
        onLibraryChanged: () => {
          setLibraryRevision((revision) => revision + 1);
        },
      });

      if (cancelled) {
        dispose();
      } else {
        unlisten = dispose;
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const openBookPath = useCallback(
    async (
      path: string,
      target: ReaderNavigationTarget | null = null,
    ) => {
      if (!isSupportedBookPath(path)) return;

      let resolvedPath = path;

      try {
        const registered = await registerBookFile(path);
        if (registered) {
          resolvedPath = registered.file_path;
        }
        setLibraryRevision((revision) => revision + 1);
      } catch (error) {
        console.error("Unable to register book in local library", error);
      }

      setActiveBookPath(resolvedPath);
      setActiveNavigationTarget(target);
      setView("reader");
    },
    [],
  );

  const openBook = useCallback(async () => {
    const path = await chooseBookFile();
    if (!path) return;
    await openBookPath(path);
  }, [openBookPath]);

  useEffect(() => {
    if (view !== "reader") return;

    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listenForBookDrops((path) => {
      void openBookPath(path);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [openBookPath]);

  return (
    <div className="app-shell">
      <AppSidebar activeView={view} onNavigate={setView} onOpenBook={openBook} />

      <main className="main-content">
        {view === "library" && (
          <LibraryView
            onOpenBook={openBook}
            onOpenStoredBook={openBookPath}
            revision={libraryRevision}
          />
        )}
        <div
          className="reader-view-keepalive"
          aria-hidden={view !== "reader"}
          style={{
            display: view === "reader" ? "block" : "none",
            width: "100%",
            height: "100%",
            minHeight: 0,
          }}
        >
          <ReaderErrorBoundary
            onBackToLibrary={() => setView("library")}
          >
            <ReaderView
              bookPath={activeBookPath}
              navigationTarget={activeNavigationTarget}
              onOpenBook={openBook}
              onBackToLibrary={() => setView("library")}
            />
          </ReaderErrorBoundary>
        </div>
        {view === "notebook" && (
          <NotebookView onOpenBook={openBookPath} />
        )}
        {view === "resources" && (
          <ResourceHubView onOpenBook={openBookPath} />
        )}
        {view === "ai" && <AiSettingsView />}
      </main>
    </div>
  );
}
