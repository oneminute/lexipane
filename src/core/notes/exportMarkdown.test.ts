import { describe, expect, it } from "vitest";
import { notesToMarkdown } from "./exportMarkdown";
import type { ReaderNote } from "./notes";

describe("notesToMarkdown", () => {
  it("keeps source, AI content, user notes, and tags separate", () => {
    const note: ReaderNote = {
      id: "1",
      book_id: "book",
      book_title: "Example Book",
      book_path: "book.epub",
      source_text: "A difficult sentence.",
      ai_content: "AI explanation.",
      user_content: "My note.",
      tags_json: JSON.stringify(["grammar", "chapter 2"]),
      created_at: "2026-10-03T12:00:00.000Z",
      updated_at: "2026-10-03T12:00:00.000Z",
    };

    const markdown = notesToMarkdown([note]);

    expect(markdown).toContain("## Example Book");
    expect(markdown).toContain("> A difficult sentence.");
    expect(markdown).toContain("### AI explanation");
    expect(markdown).toContain("### My notes");
    expect(markdown).toContain("\`grammar\`");
  });
});
