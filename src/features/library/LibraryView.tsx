interface Props {
  onOpenBook: () => void;
}

export function LibraryView({ onOpenBook }: Props) {
  return (
    <section className="page library-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Your books, ready for deeper reading.</h1>
          <p>
            Open a PDF, EPUB, MOBI, AZW, or AZW3 file. Supported formats will
            enter the local library automatically as their document engines land.
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
          PDF first · EPUB and Kindle formats follow through the same document layer
        </span>
      </button>

      <div className="foundation-grid">
        <article className="foundation-card">
          <span className="card-index">01</span>
          <h2>Read without leaving the page</h2>
          <p>
            Contextual vocabulary, phrases and sentence structure live beside the source.
          </p>
        </article>
        <article className="foundation-card">
          <span className="card-index">02</span>
          <h2>Choose your AI</h2>
          <p>
            Local Qwen through Ollama, cloud models, or any OpenAI-compatible endpoint.
          </p>
        </article>
        <article className="foundation-card">
          <span className="card-index">03</span>
          <h2>Build a personal reading model</h2>
          <p>
            Known, removed and manually-added terms teach LexiPane what actually blocks you.
          </p>
        </article>
      </div>
    </section>
  );
}
