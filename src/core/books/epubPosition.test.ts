import { describe, expect, it } from "vitest";
import { parseEpubReadingPosition } from "./epubPosition";

describe("parseEpubReadingPosition", () => {
  it("parses EPUB CFI positions", () => {
    expect(
      parseEpubReadingPosition(
        JSON.stringify({
          version: 1,
          kind: "epub-cfi",
          cfi: "epubcfi(/6/4[chapter]!/4/2/8)",
        }),
        0.42,
      ),
    ).toEqual({
      cfi: "epubcfi(/6/4[chapter]!/4/2/8)",
      progress: 0.42,
    });
  });

  it("rejects malformed locators", () => {
    expect(parseEpubReadingPosition("bad", null)).toBeNull();
    expect(
      parseEpubReadingPosition(
        JSON.stringify({ kind: "pdf-page", page: 2 }),
        null,
      ),
    ).toBeNull();
  });
});
