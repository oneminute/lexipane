import { describe, expect, it } from "vitest";
import { segmentSentences } from "./sentenceNavigation";

describe("sentence segmentation", () => {
  it("keeps punctuation with each sentence", () => {
    expect(
      segmentSentences("The first sentence is here. The second one follows! Is this the third?"),
    ).toEqual([
      {
        text: "The first sentence is here.",
        start: 0,
        end: 27,
      },
      {
        text: "The second one follows!",
        start: 28,
        end: 51,
      },
      {
        text: "Is this the third?",
        start: 52,
        end: 70,
      },
    ]);
  });

  it("normalizes whitespace before segmenting", () => {
    expect(
      segmentSentences("One sentence.\n\nTwo   sentences."),
    ).toEqual([
      {
        text: "One sentence.",
        start: 0,
        end: 13,
      },
      {
        text: "Two sentences.",
        start: 14,
        end: 28,
      },
    ]);
  });

  it("returns an empty list for blank text", () => {
    expect(segmentSentences("   \n\t ")).toEqual([]);
  });
});
