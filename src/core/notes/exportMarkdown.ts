import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  parseNoteTags,
  type ReaderNote,
} from "./notes";

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function notesToMarkdown(notes: ReaderNote[]): string {
  const lines: string[] = [
    "# LexiPane Notebook",
    "",
    "Exported from LexiPane.",
    "",
  ];

  for (const note of notes) {
    lines.push(
      "## " + escapeHeading(note.book_title || "Untitled book"),
      "",
    );

    const tags = parseNoteTags(note.tags_json);
    if (tags.length > 0) {
      lines.push(
        "**Tags:** " +
          tags.map((tag) => "\`" + tag + "\`").join(" "),
        "",
      );
    }

    if (note.source_text?.trim()) {
      lines.push("### Source", "");
      for (const line of note.source_text.trim().split(/\r?\n/)) {
        lines.push("> " + line);
      }
      lines.push("");
    }

    if (note.ai_content?.trim()) {
      lines.push(
        "### AI explanation",
        "",
        note.ai_content.trim(),
        "",
      );
    }

    if (note.user_content?.trim()) {
      lines.push(
        "### My notes",
        "",
        note.user_content.trim(),
        "",
      );
    }

    lines.push(
      "_Updated: " + new Date(note.updated_at).toLocaleString() + "_",
      "",
      "---",
      "",
    );
  }

  return lines.join("\n");
}

export async function exportNotesAsMarkdown(
  notes: ReaderNote[],
): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("Notebook export requires the desktop application.");
  }

  const destination = await save({
    title: "Export LexiPane Notebook",
    defaultPath: "lexipane-notebook.md",
    filters: [
      {
        name: "Markdown",
        extensions: ["md"],
      },
    ],
  });

  if (!destination) return null;

  await writeTextFile(destination, notesToMarkdown(notes));
  return destination;
}
