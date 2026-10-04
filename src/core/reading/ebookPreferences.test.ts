import { describe, expect, it } from "vitest";
import {
  normalizeEbookFontScale,
  normalizeEbookTheme,
  normalizeEpubFlow,
} from "./ebookPreferences";

describe("ebook reading preferences", () => {
  it("clamps and rounds font scale", () => {
    expect(normalizeEbookFontScale(63)).toBe(70);
    expect(normalizeEbookFontScale(117)).toBe(120);
    expect(normalizeEbookFontScale(999)).toBe(180);
  });

  it("normalizes theme and EPUB flow", () => {
    expect(normalizeEbookTheme("sepia")).toBe("sepia");
    expect(normalizeEbookTheme("unknown")).toBe("light");
    expect(normalizeEpubFlow("paginated")).toBe("paginated");
    expect(normalizeEpubFlow("other")).toBe("scrolled");
  });
});
