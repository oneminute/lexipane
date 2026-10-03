interface Props {
  bookPath: string | null;
  onOpenBook: () => void;
  onBackToLibrary: () => void;
}

function fileName(path: string | null) {
  if (!path) return "No book selected";
  return path.split(/[\\/]/).pop() || path;
}

export function ReaderView({ bookPath, onOpenBook, onBackToLibrary }: Props) {
  return (
    <section className="reader-page">
      <header className="reader-toolbar">
        <div className="reader-title">
          <button className="text-button" onClick={onBackToLibrary}>
            ← Library
          </button>
          <span className="toolbar-divider" />
          <div>
            <strong>{fileName(bookPath)}</strong>
            <small>{bookPath ? "Reader shell ready" : "Open a book to begin"}</small>
          </div>
        </div>
        <div className="reader-actions">
          <button className="ghost-button">Region select</button>
          <button className="ghost-button">Notes</button>
          <button className="primary-button compact" onClick={onOpenBook}>
            Open
          </button>
        </div>
      </header>

      <div className="split-reader">
        <section className="document-pane">
          <div className="document-stage">
            <div className="paper">
              <span className="paper-kicker">Reader foundation preview</span>
              <h1>A quiet place for difficult sentences.</h1>
              <p>
                The proposal was ultimately{" "}
                <mark className="auto-word">shelved</mark> after several members{" "}
                <mark className="auto-phrase">raised concerns about</mark> its{" "}
                <mark className="user-term">long-term implications</mark>.
              </p>
              <p>
                Automatic terms, user-selected text, sentence analysis, and region
                captures share one annotation model instead of becoming separate features.
              </p>
              <div className="reader-placeholder">
                {bookPath
                  ? "The PDF document engine is the next implementation slice."
                  : "Choose a book to attach this reader workspace to a real file."}
              </div>
            </div>
          </div>

          <footer className="reader-statusbar">
            <span>Page — / —</span>
            <span>100%</span>
            <span>Continuous</span>
          </footer>
        </section>

        <aside className="ai-pane">
          <header className="ai-pane-header">
            <div>
              <span className="eyebrow">AI Reading</span>
              <strong>Context assistance</strong>
            </div>
            <button className="model-pill">Qwen · Ollama ▾</button>
          </header>

          <div className="ai-scroll">
            <section className="assist-card">
              <span className="assist-type yellow">Word</span>
              <h3>shelved</h3>
              <p>
                <strong>在这里：</strong>搁置、暂缓推进。
              </p>
              <p className="muted">
                Not the literal meaning “put on a shelf.” The plan was stopped or postponed.
              </p>
              <div className="assist-actions">
                <button>Known</button>
                <button>Save note</button>
                <button>Explain more</button>
              </div>
            </section>

            <section className="assist-card">
              <span className="assist-type orange">Phrase</span>
              <h3>raise concerns about</h3>
              <p>
                对某件事提出担忧或质疑，是比 <em>be worried about</em> 更正式的书面表达。
              </p>
            </section>

            <section className="assist-card">
              <span className="assist-type blue">User selection</span>
              <h3>long-term implications</h3>
              <p>某件事情长期可能产生的影响、后果或连带意义。</p>
            </section>
          </div>

          <div className="ask-box">
            <textarea rows={2} placeholder="Ask about the current text…" />
            <button>Ask</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
