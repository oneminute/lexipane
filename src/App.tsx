import { useCallback, useEffect, useState } from "react";
import { AppSidebar, type AppView } from "./components/AppSidebar";
import { listenForBookDrops } from "./core/books/drop";
import { registerBookFile } from "./core/books/library";
import {
  chooseBookFile,
  isSupportedBookPath,
} from "./core/books/openBook";
import { initializeDatabase } from "./core/db/database";
import { LibraryView } from "./features/library/LibraryView";
import { NotebookView } from "./features/notebook/NotebookView";
import { ReaderView } from "./features/reader/ReaderView";
import { AiSettingsView } from "./features/settings/AiSettingsView";

export default function App() {
  const [view, setView] = useState<AppView>("library");
  const [activeBookPath, setActiveBookPath] = useState<string | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);

  useEffect(() => {
    void initializeDatabase().catch((error) => {
      console.error("LexiPane database initialization failed", error);
    });
  }, []);

  const openBookPath = useCallback(async (path: string) => {
    if (!isSupportedBookPath(path)) return;

    try {
      await registerBookFile(path);
      setLibraryRevision((revision) => revision + 1);
    } catch (error) {
      console.error("Unable to register book in local library", error);
    }

    setActiveBookPath(path);
    setView("reader");
  }, []);

  const openBook = useCallback(async () => {
    const path = await chooseBookFile();
    if (!path) return;
    await openBookPath(path);
  }, [openBookPath]);

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
        {view === "reader" && (
          <ReaderView
            bookPath={activeBookPath}
            onOpenBook={openBook}
            onBackToLibrary={() => setView("library")}
          />
        )}
        {view === "notebook" && (
          <NotebookView onOpenBook={openBookPath} />
        )}
        {view === "ai" && <AiSettingsView />}
      </main>
    </div>
  );
}
