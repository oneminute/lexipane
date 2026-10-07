import { describe, expect, it } from "vitest";
import {
  clampReaderScrollTop,
  shouldAcceptReaderRelocation,
} from "./readerResume";

describe("reader resume helpers", () => {
  it("keeps a valid saved scroll offset", () => {
    expect(clampReaderScrollTop(420, 1800, 700)).toBe(420);
  });

  it("clamps scroll offsets after the viewport or content size changes", () => {
    expect(clampReaderScrollTop(1500, 1800, 700)).toBe(1100);
    expect(clampReaderScrollTop(-40, 1800, 700)).toBe(0);
    expect(clampReaderScrollTop(Number.NaN, 1800, 700)).toBe(0);
  });

  it("rejects relocation events while hidden or while restoring", () => {
    expect(shouldAcceptReaderRelocation(true, false)).toBe(true);
    expect(shouldAcceptReaderRelocation(false, false)).toBe(false);
    expect(shouldAcceptReaderRelocation(true, true)).toBe(false);
    expect(shouldAcceptReaderRelocation(false, true)).toBe(false);
  });
});
