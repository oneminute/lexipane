import { useEffect, useState } from "react";
import {
  listReaderNotes,
  updateReaderNoteUserContent,
  type ReaderNote,
} from "../../core/notes/notes";

interface NoteCardProps {
  note: ReaderNote;
  onOpenBook?: (path: string) => void | Promise<void>;
}

function NoteCard({ note, onOpenBook }: NoteCardProps) {
  const [userContent, setUserContent] = useState(note.user_content ?? "");
  const [saveState, setSaveState] =
    useState<"idle" | "saving" | "saved">("idle");

  async function saveUserNote() {
    setSaveState("saving");
    try {
      await updateReaderNoteUserContent(note.id, userContent);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch (error) {
      console.error("Unable to update note", error);
      setSaveState("idle");
    }
  }

  return (
    <article className="notebook-card">
      <header className="notebook-card-header">
        <div>
          <span className="eyebrow">Reading note</span>
          <h2>{note.book_title || "Untitled book"}</h2>
        </div>
        {note.book_path && onOpenBook && (
          <button
            className="ghost-button"
            onClick={() => void onOpenBook(note.book_path!)}
          >
            Open book
          </button>
        )}
      </header>

      {note.source_text && (
        <section className="note-source">
          <span>Source</span>
          <blockquote>{note.source_text}</blockquote>
        </section>
      )}

      {note.ai_content && (
        <section className="note-ai">
          <span>AI explanation</span>
          <div>{note.ai_content}</div>
        </section>
      )}

      <section className="note-user">
        <div className="note-section-heading">
          <span>My notes</span>
          <small>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : ""}
          </small>
        </div>
        <textarea
          rows={4}
          value={userContent}
          placeholder="Add your own understanding, examples, questions, or reminders…"
          onChange={(event) => {
            setUserContent(event.target.value);
            setSaveState("idle");
          }}
        />
        <button
          className="ghost-button"
          disabled={saveState === "saving"}
          onClick={() => void saveUserNote()}
        >
          Save my note
        </button>
      </section>

      <footer className="notebook-card-footer">
        {new Date(note.updated_at).toLocaleString()}
      </footer>
    </article>
  );
}

interface Props {
  onOpenBook?: (path: string) => void | Promise<void>;
}

export function NotebookView({ onOpenBook }: Props) {
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void listReaderNotes()
      .then((items) => {
        if (!cancelled) setNotes(items);
      })
      .catch((error) => {
        console.error("Unable to load notebook", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page notebook-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Notebook</span>
          <h1>Keep what was worth understanding.</h1>
          <p>
            Saved selections keep the original passage and the AI explanation
            separate from your own editable notes.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="library-empty">
          <strong>Loading notebook…</strong>
        </div>
      ) : notes.length === 0 ? (
        <div className="library-empty">
          <strong>No notes yet.</strong>
          <span>
            Select text in a PDF and use Save note in the AI pane.
          </span>
        </div>
      ) : (
        <div className="notebook-list">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpenBook={onOpenBook}
            />
          ))}
        </div>
      )}
    </section>
  );
}
