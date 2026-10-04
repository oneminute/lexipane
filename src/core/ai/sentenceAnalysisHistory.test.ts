import { describe, expect, it } from "vitest";
import { createSentenceAnalysisKey } from "./sentenceAnalysisHistory";

describe("sentence AI history identity", () => {
  it("is stable for equivalent sentence text whitespace", () => {
    const left = createSentenceAnalysisKey({
      format: "epub",
      container: "chapter-context",
      sentenceIndex: 3,
      text: "This   is a sentence.",
    });
    const right = createSentenceAnalysisKey({
      format: "epub",
      container: "chapter-context",
      sentenceIndex: 3,
      text: "This is a sentence.",
    });

    expect(left).toBe(right);
  });

  it("changes when sentence position or container changes", () => {
    const base = createSentenceAnalysisKey({
      format: "pdf",
      container: "page:4",
      sentenceIndex: 2,
      text: "The same words.",
    });
    const nextSentence = createSentenceAnalysisKey({
      format: "pdf",
      container: "page:4",
      sentenceIndex: 3,
      text: "The same words.",
    });
    const nextPage = createSentenceAnalysisKey({
      format: "pdf",
      container: "page:5",
      sentenceIndex: 2,
      text: "The same words.",
    });

    expect(base).not.toBe(nextSentence);
    expect(base).not.toBe(nextPage);
  });
});
