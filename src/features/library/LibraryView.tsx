import { useEffect, useMemo, useState } from "react";
import {
  listLibraryBooks,
  setBookFavorite,
  setBookReadingStatus,
  type LibraryBook,
} from "../../core/books/library";

interface Props {
  onOpenBook: () => void;
  onOpenStoredBook: (path: string) => void | Promise<void>;
  revision: number;
}

type LibraryFilter = "all" | "recent" | "favorites" | "finished";

function formatLabel(format: string) {
  return format.toUpperCase();
}

function progressLabel(progress: number | null) {
  if (progress === null) return "Not started";
  return Math.round(Math.max(0, Math.min(1, progress)) * 100) + "%";
}

export function LibraryView({
  onOpenBook,
  onOpenStoredBook,
  revision,
}: Props) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");

  async function refreshBooks() {
    setBooks(await listLibraryBooks());
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void listLibraryBooks()
      .then((items) => {
        if (!cancelled) setBooks(items);
      })
      .catch((error) => {
        console.error("Unable to load LexiPane library", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [revision]);

  const visibleBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return books.filter((book, index) => {
      if (filter === "favorites" && book.favorite !== 1) return false;
      if (filter === "finished" && book.reading_status !== "finished") {
        return false;
      }
      if (filter === "recent" && index >= 12) return false;

      if (!normalizedQuery) return true;

      return [book.title, book.author, book.format]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [books, filter, query]);

  async function toggleFavorite(book: LibraryBook) {
    await setBookFavorite(book.id, book.favorite !== 1);
    await refreshBooks();
  }

  async function toggleFinished(book: LibraryBook) {
    await setBookReadingStatus(
      book.id,
      book.reading_status === "finished" ? "reading" : "finished",
    );
    await refreshBooks();
  }

  return (
    <section className="page library-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Your books, ready for deeper reading.</h1>
          <p>
            PDF, EPUB, MOBI, AZW, and AZW3 share the same local bookshelf,
            reading progress, annotations, AI assistance, and Notebook.
          </p>
        </div>
        <button className="primary-button" onClick={onOpenBook}>
          Open book
        </button>
      </header>

      <div className="library-toolbar">
        <div className="segmented-control">
          {([
            ["all", "All books"],
            ["recent", "Recent"],
            ["favorites", "Favorites"],
            ["finished", "Finished"],
          ] as Array<[LibraryFilter, string]>).map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          value={query}
          placeholder="Search your library"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <button className="drop-zone" onClick={onOpenBook}>
        <span className="drop-icon">⇩</span>
        <strong>Drop a book here or choose a file</strong>
        <span>
          PDF · EPUB · MOBI · AZW · AZW3
        </span>
      </button>

      <div className="library-section-heading">
        <div>
          <span className="eyebrow">Bookshelf</span>
          <h2>
            {filter === "all"
              ? "Local library"
              : filter === "recent"
                ? "Recently read"
                : filter === "favorites"
                  ? "Favorites"
                  : "Finished"}
          </h2>
        </div>
        <span>
          {loading ? "Loading…" : visibleBooks.length + " books"}
        </span>
      </div>

      {visibleBooks.length > 0 ? (
        <div className="book-grid">
          {visibleBooks.map((book) => (
            <article className="book-card" key={book.id}>
              <button
                className="book-card-open"
                onClick={() => void onOpenStoredBook(book.file_path)}
              >
                <div className="book-cover-placeholder">
                  {book.cover_path?.startsWith("data:image/") ? (
                    <img
                      src={book.cover_path}
                      alt=""
                      className="book-cover-image"
                    />
                  ) : (
                    <>
                      <span>{formatLabel(book.format)}</span>
                      <strong>
                        {(book.title || "Untitled")
                          .slice(0, 1)
                          .toUpperCase()}
                      </strong>
                    </>
                  )}
                </div>

                <div className="book-card-copy">
                  <strong>{book.title || "Untitled"}</strong>
                  <span>
                    {book.author || "Local book"} ·{" "}
                    {formatLabel(book.format)}
                  </span>

                  <div className="book-progress-row">
                    <span>{progressLabel(book.progress)}</span>
                    <div className="book-progress-track">
                      <i
                        style={{
                          width:
                            Math.round(
                              Math.max(
                                0,
                                Math.min(1, book.progress ?? 0),
                              ) * 100,
                            ) + "%",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </button>

              <div className="book-card-actions">
                <button
                  className={book.favorite === 1 ? "active" : ""}
                  aria-label={
                    book.favorite === 1
                      ? "Remove from favorites"
                      : "Add to favorites"
                  }
                  title={
                    book.favorite === 1
                      ? "Remove from favorites"
                      : "Add to favorites"
                  }
                  onClick={() => void toggleFavorite(book)}
                >
                  {book.favorite === 1 ? "★" : "☆"}
                </button>
                <button
                  className={
                    book.reading_status === "finished" ? "active" : ""
                  }
                  title={
                    book.reading_status === "finished"
                      ? "Mark as reading"
                      : "Mark as finished"
                  }
                  onClick={() => void toggleFinished(book)}
                >
                  {book.reading_status === "finished" ? "✓" : "○"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <strong>
            {loading
              ? "Loading your bookshelf…"
              : books.length === 0
                ? "No books yet."
                : "No books match this view."}
          </strong>
          <span>
            {books.length === 0
              ? "Open or drag in a book and LexiPane will remember it here."
              : "Change the filter or search query."}
          </span>
        </div>
      )}
    </section>
  );
}
