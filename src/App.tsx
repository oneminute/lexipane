import { useEffect, useState } from "react";
import { AppSidebar, type AppView } from "./components/AppSidebar";
import { chooseBookFile } from "./core/books/openBook";
import { initializeDatabase } from "./core/db/database";
import { LibraryView } from "./features/library/LibraryView";
import { ReaderView } from "./features/reader/ReaderView";
import { AiSettingsView } from "./features/settings/AiSettingsView";

export default function App() {
  const [view, setView] = useState<AppView>("library");
  const [activeBookPath, setActiveBookPath] = useState<string | null>(null);

  useEffect(() => {
    void initializeDatabase().catch((error) => {
      console.error("LexiPane database initialization failed", error);
    });
  }, []);

  async function openBook() {
    const path = await chooseBookFile();
    if (!path) return;

    setActiveBookPath(path);
    setView("reader");
  }

  return (
    <div className="app-shell">
      <AppSidebar activeView={view} onNavigate={setView} onOpenBook={openBook} />

      <main className="main-content">
        {view === "library" && <LibraryView onOpenBook={openBook} />}
        {view === "reader" && (
          <ReaderView
            bookPath={activeBookPath}
            onOpenBook={openBook}
            onBackToLibrary={() => setView("library")}
          />
        )}
        {view === "notebook" && (
          <section className="page page-centered">
            <div className="empty-card">
              <span className="eyebrow">Notebook</span>
              <h1>Your reading knowledge, in one place.</h1>
              <p>
                Vocabulary, phrases, sentence analyses, region captures, AI
                explanations, and your own notes will appear here.
              </p>
              <span className="status-chip">Foundation ready · persistence next</span>
            </div>
          </section>
        )}
        {view === "ai" && <AiSettingsView />}
      </main>
    </div>
  );
}
