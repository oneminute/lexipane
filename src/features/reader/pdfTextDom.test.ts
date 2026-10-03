import { describe, expect, it } from "vitest";
import { findBestQuoteOccurrence } from "./pdfTextDom";

describe("findBestQuoteOccurrence", () => {
  it("finds a unique exact quote", () => {
    expect(
      findBestQuoteOccurrence(
        "The proposal was ultimately shelved after debate.",
        "shelved",
      ),
    ).toBe(28);
  });

  it("uses prefix and suffix to disambiguate repeated quotes", () => {
    const page =
      "He raised concerns about cost. Later, she raised concerns about safety.";

    const index = findBestQuoteOccurrence(
      page,
      "raised concerns about",
      "Later, she ",
      " safety",
    );

    expect(index).toBe(page.lastIndexOf("raised concerns about"));
  });

  it("returns -1 when the quote is absent", () => {
    expect(
      findBestQuoteOccurrence("A short page.", "missing phrase"),
    ).toBe(-1);
  });
});
