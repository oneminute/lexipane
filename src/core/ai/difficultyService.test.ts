import { describe, expect, it } from "vitest";
import { parseDifficultyPayload } from "./difficultyService";

describe("parseDifficultyPayload", () => {
  const page =
    "The proposal was ultimately shelved after members raised concerns about its long-term implications.";

  it("keeps valid exact terms and phrases", () => {
    const result = parseDifficultyPayload(
      {
        items: [
          {
            text: "shelved",
            type: "word",
            cefr: "C1",
            meaning: "搁置",
            confidence: 0.9,
          },
          {
            text: "raised concerns about",
            type: "phrase",
            meaning: "对……提出担忧",
            confidence: 0.8,
          },
        ],
      },
      page,
    );

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("shelved");
    expect(result[1].type).toBe("phrase");
  });

  it("rejects hallucinated text and malformed items", () => {
    const result = parseDifficultyPayload(
      {
        items: [
          { text: "nonexistent", type: "word", meaning: "x" },
          { text: "shelved", type: "other", meaning: "x" },
          { text: "shelved", type: "word" },
        ],
      },
      page,
    );

    expect(result).toHaveLength(0);
  });
});
