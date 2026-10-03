import { describe, expect, it } from "vitest";
import { parseKindleReadingPosition } from "./kindlePosition";

describe("parseKindleReadingPosition", () => {
  it("parses a chapter locator", () => {
    expect(
      parseKindleReadingPosition(
        JSON.stringify({
          version: 1,
          kind: "kindle-chapter",
          chapterId: "12",
        }),
        0.5,
      ),
    ).toEqual({
      chapterId: "12",
      progress: 0.5,
    });
  });

  it("rejects other locator formats", () => {
    expect(parseKindleReadingPosition("bad", null)).toBeNull();
    expect(
      parseKindleReadingPosition(
        JSON.stringify({
          kind: "epub-cfi",
          cfi: "epubcfi(/6/2)",
        }),
        null,
      ),
    ).toBeNull();
  });
});
