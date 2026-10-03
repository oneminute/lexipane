import { describe, expect, it } from "vitest";
import {
  parseReaderNavigationTarget,
  serializeReaderNavigationTarget,
} from "./navigation";

describe("reader navigation targets", () => {
  it("round-trips PDF, EPUB, and Kindle targets", () => {
    const targets = [
      { kind: "pdf-page" as const, page: 12 },
      {
        kind: "epub-cfi" as const,
        cfi: "epubcfi(/6/4!/4/2)",
      },
      {
        kind: "kindle-chapter" as const,
        chapterId: "17",
      },
    ];

    for (const target of targets) {
      expect(
        parseReaderNavigationTarget(
          serializeReaderNavigationTarget(target),
        ),
      ).toEqual(target);
    }
  });

  it("rejects malformed targets", () => {
    expect(parseReaderNavigationTarget("bad-json")).toBeNull();
    expect(
      parseReaderNavigationTarget(
        JSON.stringify({ kind: "pdf-page", page: 0 }),
      ),
    ).toBeNull();
    expect(
      parseReaderNavigationTarget(
        JSON.stringify({ kind: "epub-cfi", cfi: "" }),
      ),
    ).toBeNull();
  });
});
