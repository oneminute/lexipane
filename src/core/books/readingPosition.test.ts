import { describe, expect, it } from "vitest";
import { parsePdfReadingPosition } from "./readingPosition";

describe("parsePdfReadingPosition", () => {
  it("parses a valid versioned PDF page locator", () => {
    expect(
      parsePdfReadingPosition(
        JSON.stringify({ version: 1, kind: "pdf-page", page: 12 }),
        0.25,
      ),
    ).toEqual({ page: 12, progress: 0.25 });
  });

  it("rejects malformed and non-PDF locators", () => {
    expect(parsePdfReadingPosition("not-json", null)).toBeNull();
    expect(
      parsePdfReadingPosition(
        JSON.stringify({ kind: "epub-cfi", page: 2 }),
        null,
      ),
    ).toBeNull();
    expect(
      parsePdfReadingPosition(
        JSON.stringify({ kind: "pdf-page", page: 0 }),
        null,
      ),
    ).toBeNull();
  });
});
