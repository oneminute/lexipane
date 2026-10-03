import { useEffect, useMemo, useState } from "react";
import {
  parseReaderNavigationTarget,
  type ReaderNavigationTarget,
} from "../../core/books/navigation";
import { exportNotesAsMarkdown } from "../../core/notes/exportMarkdown";
import {
  deleteReaderNote,
  listReaderNotes,
  parseNoteTags,
  updateReaderNoteTags,
  updateReaderNoteUserContent,
  type ReaderNote,
} from "../../core/notes/notes";

interface NoteCardProps {
  note: ReaderNote;
  onOpenBook?: (
    path: string,
    target?: ReaderNavigationTarget | null,
  ) => void | Promise<void>;
  onDelete: (noteId: string) => void;
}

function NoteCard({ note, onOpenBook, onDelete }: NoteCardProps) {
  const [userContent, setUserContent] = useState(note.user_content ?? "");
  const [tagsText, setTagsText] = useState(
    parseNoteTags(note.tags_json).join(", "),
  );
  const [saveState, setSaveState] =
    useState<"idle" | "saving" | "saved">("idle");

  async function saveUserNote() {
    setSaveState("saving");
    try {
      const tags = tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      await Promise.all([
        updateReaderNoteUserContent(note.id, userContent),
        updateReaderNoteTags(note.id, tags),
      ]);

      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch (error) {
      console.error("Unable to update note", error);
      setSaveState("idle");
    }
  }

  async function removeNote() {
    if (!window.confirm("Delete this notebook entry?")) return;

    try {
      await deleteReaderNote(note.id);
      onDelete(note.id);
    } catch (error) {
      console.error("Unable to delete note", error);
    }
  }

  return (
    <article className="notebook-card">
      <header className="notebook-card-header">
        <div>
          <span className="eyebrow">Reading note</span>
          <h2>{note.book_title || "Untitled book"}</h2>
        </div>
        <div className="notebook-card-actions">
          {note.book_path && onOpenBook && (
            <button
              className="ghost-button"
              onClick={() =>
                void onOpenBook(
                  note.book_path!,
                  parseReaderNavigationTarget(note.anchor_json),
                )
              }
            >
              Open book
            </button>
          )}
          <button className="danger-button" onClick={() => void removeNote()}>
            Delete
          </button>
        </div>
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

        <label className="note-tags-field">
          <span>Tags</span>
          <input
            value={tagsText}
            placeholder="grammar, idiom, chapter 3"
            onChange={(event) => {
              setTagsText(event.target.value);
              setSaveState("idle");
            }}
          />
          <small>Separate tags with commas.</small>
        </label>

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
  onOpenBook?: (
    path: string,
    target?: ReaderNavigationTarget | null,
  ) => void | Promise<void>;
}

export function NotebookView({ onOpenBook }: Props) {
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

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

  const filteredNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return notes;

    return notes.filter((note) => {
      const haystack = [
        note.book_title,
        note.source_text,
        note.ai_content,
        note.user_content,
        ...parseNoteTags(note.tags_json),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();

      return haystack.includes(normalized);
    });
  }, [notes, query]);

  async function exportNotebook() {
    if (filteredNotes.length === 0 || exporting) return;

    setExporting(true);
    setExportMessage("");

    try {
      const destination = await exportNotesAsMarkdown(filteredNotes);
      setExportMessage(
        destination
          ? "Exported to " + destination
          : "",
      );
    } catch (error) {
      setExportMessage(
        error instanceof Error
          ? error.message
          : "Unable to export notebook.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="page notebook-page">
      <header className="page-header notebook-header">
        <div>
          <span className="eyebrow">Notebook</span>
          <h1>Keep what was worth understanding.</h1>
          <p>
            Saved selections keep the original passage and the AI explanation
            separate from your own editable notes.
          </p>
        </div>
        <div className="notebook-header-actions">
          <input
            className="search-input notebook-search"
            value={query}
            placeholder="Search notes, books, or tags"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="primary-button"
            disabled={filteredNotes.length === 0 || exporting}
            onClick={() => void exportNotebook()}
          >
            {exporting ? "Exporting…" : "Export Markdown"}
          </button>
        </div>
      </header>

      {exportMessage && (
        <p className="notebook-export-message">{exportMessage}</p>
      )}

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
      ) : filteredNotes.length === 0 ? (
        <div className="library-empty">
          <strong>No matching notes.</strong>
          <span>Try another search term or tag.</span>
        </div>
      ) : (
        <div className="notebook-list">
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpenBook={onOpenBook}
              onDelete={(noteId) =>
                setNotes((items) =>
                  items.filter((item) => item.id !== noteId),
                )
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
