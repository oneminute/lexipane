import { describe, expect, it } from "vitest";
import {
  fallbackStructuredReadingAnalysis,
  formatStructuredReadingAnalysis,
  parseStructuredReadingAnalysis,
} from "./readingStructured";

describe("structured reading analysis", () => {
  it("parses contextual explanations", () => {
    const result = parseStructuredReadingAnalysis(
      JSON.stringify({
        kind: "explanation",
        meaningInContext: "搁置",
        naturalChinese: "这个提案最终被搁置。",
        partOfSpeech: "verb",
        difficulty: "C1",
        keyExpressions: [
          {
            text: "shelved",
            meaning: "搁置",
            note: "这里不是字面上的放到架子上。",
          },
        ],
        usageNotes: ["shelve a proposal 是常见搭配。"],
      }),
      "explain",
    );

    expect(result.kind).toBe("explanation");
    if (result.kind === "explanation") {
      expect(result.meaningInContext).toBe("搁置");
      expect(result.keyExpressions).toHaveLength(1);
    }
  });

  it("parses grammar analysis and formats it for notes", () => {
    const result = parseStructuredReadingAnalysis(
      [
        "```json",
        "{",
        '  "kind":"grammar",',
        '  "naturalChinese":"尽管下着雨，他还是出门了。",',
        '  "meaning":"让步关系。",',
        '  "structure":[{"part":"Although it was raining","role":"让步状语从句","explanation":"提供让步背景"}],',
        '  "grammarPoints":[{"name":"although","explanation":"引导让步状语从句"}],',
        '  "difficultExpressions":[]',
        "}",
        "```",
      ].join("\n"),
      "grammar",
    );

    expect(result.kind).toBe("grammar");
    expect(formatStructuredReadingAnalysis(result)).toContain("although");
  });

  it("accepts common field aliases from local models", () => {
    const result = parseStructuredReadingAnalysis(
      JSON.stringify({
        kind: "grammar",
        translation: "罗马帝国包括了地球上最美好的部分。",
        summary: "描述罗马帝国疆域与文明程度。",
        structure: [],
        grammarPoints: [],
        features: "正式历史叙述语体",
        difficultExpressions: [],
      }),
      "grammar",
    );

    expect(result.kind).toBe("grammar");
    if (result.kind === "grammar") {
      expect(result.naturalChinese).toContain("罗马帝国");
      expect(result.features).toEqual(["正式历史叙述语体"]);
    }
  });

  it("keeps readable text when structured parsing must fall back", () => {
    const result = fallbackStructuredReadingAnalysis(
      "The model answered in prose instead of JSON.",
      "invalid JSON",
    );

    expect(result.kind).toBe("raw");
    expect(formatStructuredReadingAnalysis(result)).toContain(
      "answered in prose",
    );
  });

  it("rejects incomplete structured responses", () => {
    expect(() =>
      parseStructuredReadingAnalysis(
        '{"kind":"answer","keyPoints":[]}',
        "ask",
      ),
    ).toThrow();
  });
});
