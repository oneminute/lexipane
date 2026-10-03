import { useEffect, useState } from "react";
import {
  listLibraryBooks,
  type LibraryBook,
} from "../../core/books/library";

interface Props {
  onOpenBook: () => void;
  onOpenStoredBook: (path: string) => void | Promise<void>;
  revision: number;
}

function formatLabel(format: string) {
  return format.toUpperCase();
}

export function LibraryView({
  onOpenBook,
  onOpenStoredBook,
  revision,
}: Props) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="page library-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Your books, ready for deeper reading.</h1>
          <p>
            PDF is now connected to the real reader. EPUB and Kindle-family
            formats already enter the library and will plug into the same
            document layer next.
          </p>
        </div>
        <button className="primary-button" onClick={onOpenBook}>
          Open book
        </button>
      </header>

      <div className="library-toolbar">
        <div className="segmented-control">
          <button className="selected">All books</button>
          <button>Recent</button>
          <button>Favorites</button>
          <button>Finished</button>
        </div>
        <input className="search-input" placeholder="Search your library" />
      </div>

      <button className="drop-zone" onClick={onOpenBook}>
        <span className="drop-icon">⇩</span>
        <strong>Drop a book here or choose a file</strong>
        <span>
          PDF can be read now · EPUB, MOBI and AZW support is staged behind the
          same document abstraction
        </span>
      </button>

      <div className="library-section-heading">
        <div>
          <span className="eyebrow">Bookshelf</span>
          <h2>Local library</h2>
        </div>
        <span>{loading ? "Loading…" : books.length + " books"}</span>
      </div>

      {books.length > 0 ? (
        <div className="book-grid">
          {books.map((book) => (
            <button
              className="book-card"
              key={book.id}
              onClick={() => onOpenStoredBook(book.file_path)}
            >
              <div className="book-cover-placeholder">
                <span>{formatLabel(book.format)}</span>
                <strong>{(book.title || "Untitled").slice(0, 1).toUpperCase()}</strong>
              </div>
              <div className="book-card-copy">
                <strong>{book.title || "Untitled"}</strong>
                <span>
                  {book.author || "Local book"} · {formatLabel(book.format)}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <strong>{loading ? "Loading your bookshelf…" : "No books yet."}</strong>
          <span>
            Open or drag in a book and LexiPane will remember it here.
          </span>
        </div>
      )}
    </section>
  );
}
